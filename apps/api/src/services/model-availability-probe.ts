/**
 * ============================================================
 * 외부 모델 가용성 프로브 — 카탈로그 일괄 점검
 * ============================================================
 *
 * provider 의 `/v1/models` 는 **계정 권한과 무관하게 전체 카탈로그**를 반환한다.
 * 실측(2026-07-26): Ollama Cloud 18종 중 10종이 403 "requires a subscription",
 * NVIDIA 무료티어는 계정별 404. 셀렉터에는 다 보이는데 고르면 실패했다.
 *
 * 이 모듈은 등록된 모델을 최소 요청(max_tokens=1)으로 찔러 사용 가능 여부를
 * `external_model_availability`(083)에 기록한다. 목록 API 가 이를 읽어 제외한다.
 *
 * 판정 원칙 — **일시 오류로 모델을 죽이지 않는다**:
 *   - 사용 불가: 403(구독/권한) · 404(계정에 없음) · 400(모델 거부)
 *   - 사용 가능: 2xx
 *   - 판정 보류: 타임아웃 · 5xx · 429(한도) — 기록하지 않음(다음 프로브에서 재판정)
 *
 * @module services/model-availability-probe
 */
import { parallelBatch } from '../workflow/graph-engine';
import { ExternalKeysRepository } from '../data/repositories/external-keys-repo';
import { createExternalProviderInstance, buildOAuthSessionPersist } from '../providers/provider-router';
import { ProviderError } from '../providers/provider-errors';
import { MODEL_AVAILABILITY_PROBE } from '../config/runtime-limits';
import { createLogger } from '../utils/logger';
import { MODEL_PROBE } from '../config/model-defaults';

const logger = createLogger('ModelAvailabilityProbe');

export interface ProbeResult {
    providerId: string;
    total: number;
    usable: number;
    unusable: number;
    /** 타임아웃·5xx·429 등으로 판정하지 못한 수 (기록 안 함) */
    inconclusive: number;
    unusableModels: Array<{ modelId: string; reason: string }>;
}

/** ProviderError code → 모델 자체가 못 쓰이는 상황인지 판정 */
const UNUSABLE_CODES: ReadonlySet<string> = new Set([
    'SUBSCRIPTION_REQUIRED',
    'MODEL_ACCESS_RESTRICTED',
    'MODEL_NOT_FOUND',
    'NOT_SUPPORTED',
    'INVALID_MODEL_ID',
]);
/** 모델 문제가 아니라 계정/일시 상황 — 판정 보류 */
const INCONCLUSIVE_CODES: ReadonlySet<string> = new Set([
    'QUOTA_EXCEEDED',
    'INSUFFICIENT_CREDIT',
    'INVALID_API_KEY',
    'UPSTREAM_ERROR',
]);

/**
 * 한 provider 의 등록 모델을 일괄 점검한다.
 * 실패해도 예외를 던지지 않으며, 판정된 것만 DB 에 반영한다.
 */
export async function probeProviderModels(
    userId: string,
    providerId: string,
    repo: ExternalKeysRepository,
    opts: { modelIds?: string[]; concurrency?: number } = {},
): Promise<ProbeResult> {
    const keyRow = await repo.getByUserAndProvider(userId, providerId);
    if (!keyRow) throw new ProviderError('MISSING_API_KEY', `'${providerId}' 키 미등록`);
    const plaintext = await repo.decryptKey(userId, providerId);
    if (!plaintext) throw new ProviderError('MISSING_API_KEY', `'${providerId}' 키 복호화 실패`);

    const provider = createExternalProviderInstance(
        keyRow,
        plaintext,
        keyRow.authMethod === 'oauth' ? buildOAuthSessionPersist(repo, userId, providerId) : undefined,
    );

    const modelIds = opts.modelIds?.length
        ? opts.modelIds
        : (await provider.listModels()).map((m) => m.id);

    const result: ProbeResult = {
        providerId, total: modelIds.length, usable: 0, unusable: 0, inconclusive: 0, unusableModels: [],
    };
    if (modelIds.length === 0) return result;

    logger.info(`[Probe] ${providerId} 모델 ${modelIds.length}종 점검 시작 (user=${userId})`);

    await parallelBatch(modelIds, async (modelId: string) => {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), MODEL_AVAILABILITY_PROBE.TIMEOUT_MS);
        timer.unref?.();
        try {
            await provider.streamChat(
                { messages: [{ role: 'user', content: 'hi' }], modelId, maxTokens: MODEL_PROBE.MAX_TOKENS, abortSignal: ac.signal },
                {},
            );
            result.usable++;
            await repo.markModelAvailability({ userId, providerId, modelId, usable: true, reason: null });
        } catch (err) {
            const code = err instanceof ProviderError ? err.code : 'UPSTREAM_ERROR';
            const msg = err instanceof Error ? err.message : String(err);
            if (UNUSABLE_CODES.has(code)) {
                result.unusable++;
                result.unusableModels.push({ modelId, reason: `${code}: ${msg.slice(0, 120)}` });
                await repo.markModelAvailability({
                    userId, providerId, modelId, usable: false, reason: `${code}: ${msg}`,
                });
            } else if (INCONCLUSIVE_CODES.has(code) || ac.signal.aborted) {
                // 계정/일시 문제 — 모델을 죽이지 않는다
                result.inconclusive++;
            } else {
                result.inconclusive++;
            }
        } finally {
            clearTimeout(timer);
        }
        return null;
    }, { concurrency: opts.concurrency ?? MODEL_AVAILABILITY_PROBE.CONCURRENCY });

    logger.info(
        `[Probe] ${providerId} 완료 — 사용가능 ${result.usable} / 불가 ${result.unusable} / 보류 ${result.inconclusive}`,
    );
    return result;
}
