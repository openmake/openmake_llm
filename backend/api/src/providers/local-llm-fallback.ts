/**
 * ============================================================
 * LocalLLMProvider Per-Request Fallback Helper
 * ============================================================
 *
 * LocalLLMProvider.streamChat 호출이 backend connectivity 문제로
 * 실패한 경우:
 *   1. 카탈로그에서 실패 모델 demote (available=false + reason)
 *   2. 같은 role (chat) 의 다른 가용 model 선택
 *   3. provider 가 1회 retry — 본 helper 는 retry 자체는 안 하고
 *      pure 함수로 "다음 모델 ID" 만 반환
 *
 * 운영 시나리오:
 *   - startup probe 후 backend 가 down (vLLM OOM 등) — runtime polling
 *     (5분 주기) 이 감지하기 전 사용자 호출 발생
 *   - 본 fallback 이 즉시 다른 모델로 우회 + 카탈로그 갱신
 *   - polling 이 다음 cycle 에서 추가 검증 (UP/DOWN 로깅)
 *
 * 위치 근거:
 *   - getLocalModels (config) + helper 자체만 의존 — service layer 미참조
 *   - LocalLLMProvider 가 dynamic import 로 catch 경로에서만 로드
 *
 * @module providers/local-llm-fallback
 */
import { createLogger } from '../utils/logger';
import { getLocalModels, reprobeSingleModel, type LocalModelEntry } from '../config/local-models';
import { getConfig } from '../config/env';

const logger = createLogger('LocalLLMFallback');

/**
 * 호출 실패 패턴 — backend connectivity 문제로 fallback 시도할 가치 있는 에러.
 * 사용자 의도적 abort / quota 초과 등은 fallback 안 함.
 */
function isFallbackableError(err: unknown): { ok: boolean; reason: string } {
    const msg = err instanceof Error ? err.message : String(err);
    if (/FAST_FAIL_TIMEOUT/i.test(msg)) {
        return { ok: true, reason: 'fast-fail-timeout' };
    }
    if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|fetch failed|UPSTREAM_ERROR/i.test(msg)) {
        return { ok: true, reason: 'connection-error' };
    }
    if (/HTTP 5\d\d|status 5\d\d|InternalServerError|status: 500|status: 502|status: 503|status: 504/i.test(msg)) {
        return { ok: true, reason: 'http-5xx' };
    }
    return { ok: false, reason: msg.slice(0, 80) };
}

/**
 * 카탈로그에서 같은 role 의 다른 가용 model 1개 선택. exclude id 는 제외.
 */
function pickFallbackModel(role: 'chat' | 'embedding', excludeId: string): LocalModelEntry | null {
    const candidates = getLocalModels().filter(
        m => m.role === role && m.id !== excludeId && m.available !== false,
    );
    if (candidates.length === 0) return null;
    return candidates[0];
}

/**
 * 결과: fallback 가능 시 `{ fallbackModelId }`, 불가능 시 `null`.
 *
 * 부수효과:
 *   - 실패 모델을 카탈로그에서 demote (available=false, unavailableReason 설정)
 *   - logger.warn 으로 demote 사실 기록
 *
 * @param failedModelId 실패한 model id (provider 가 호출한 modelId)
 * @param err           실패 원인 (Error 또는 임의 값)
 * @returns             fallback 모델 정보 또는 null (재시도 안 함)
 */
export function tryFallbackAfterFailure(
    failedModelId: string,
    err: unknown,
): { fallbackModelId: string } | null {
    const check = isFallbackableError(err);
    if (!check.ok) {
        return null;  // 사용자 abort / quota / 알 수 없는 에러 — fallback 안 함
    }

    // 1) 카탈로그 demote
    const catalog = getLocalModels();
    const failedEntry = catalog.find(m => m.id === failedModelId);
    if (failedEntry) {
        failedEntry.available = false;
        failedEntry.unavailableReason = `runtime: ${check.reason}`;
        logger.warn(`demote ${failedModelId} — ${check.reason}`);

        // 1-a) Fire-and-forget single-model re-probe — backend 즉시 회복 케이스 (운영자 재기동,
        //      일시적 slow 후 회복) 의 false-positive 회복을 polling cycle (5분) 보다 빨리 감지.
        //      user-response 크리티컬 경로 영향 0 (await 안 함).
        try {
            const cfg = getConfig();
            void reprobeSingleModel(failedModelId, cfg.llmBaseUrl, cfg.llmApiKey)
                .catch(e => logger.debug(`[Reprobe ${failedModelId}] error: ${e instanceof Error ? e.message : e}`));
        } catch (cfgErr) {
            // getConfig 가 cold-init 미완 등으로 실패해도 fallback 자체는 진행
            logger.debug(`[Reprobe] getConfig 실패 — reprobe skip: ${cfgErr instanceof Error ? cfgErr.message : cfgErr}`);
        }
    }

    // 2) chat 외 (embedding) 은 dim 다를 위험 — fallback 안 함
    const role = failedEntry?.role || 'chat';
    if (role !== 'chat') {
        return null;
    }

    // 3) 같은 role 다른 가용 model 찾기
    const fallback = pickFallbackModel('chat', failedModelId);
    if (!fallback) {
        logger.warn(`${failedModelId} 실패, fallback 가용 모델 없음`);
        return null;
    }

    return { fallbackModelId: fallback.id };
}
