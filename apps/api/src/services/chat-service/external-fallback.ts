/**
 * ============================================================
 * 채팅 provider dispatch — 외부 실패 시 로컬 폴백
 * ============================================================
 *
 * 스트리밍 루프 본체(external-provider)에서 **재시도 정책만** 분리한 계층
 * (파일 크기 가드 + 책임 분리). 소비처는 이 모듈의 streamFromExternalProvider 를
 * 채팅 dispatch 단일 진입점으로 사용한다.
 *
 * @module services/chat-service/external-fallback
 */
import type { ChatMessageRequest } from '../chat-service-types';
import type { ResolvedProvider } from '../../providers/provider-router';
import { servedModelLabel } from './provider-gate';
import { EXTERNAL_CHAT_FALLBACK } from '../../config/runtime-limits';
import { getConfig } from '../../config/env';
import { createLogger } from '../../utils/logger';
import {
    runExternalStream,
    type ExternalProviderDeps,
    type StreamFromExternalContext,
} from './external-provider';

// 소비처(ChatService)가 dispatch 진입점 한 곳에서 타입까지 가져오도록 재노출
export type { ExternalProviderDeps, StreamFromExternalContext };

const logger = createLogger('ChatExternalProvider');

/**
 * 외부 provider 실패 시 로컬 기본 모델로 1회 폴백하는 래퍼.
 *
 * 배경: 역할(role) 경로에는 4xx 로컬 강등이 있었지만 **채팅 경로에는 없었다**.
 * 기본 모델을 외부로 두면 구독 한도(429)·세션 만료(401)에 그 대화가 통째로
 * 에러로 죽었다 (2026-07-26 점검에서 확인).
 *
 * 안전 조건 — 아래를 모두 만족할 때만 폴백한다:
 *   ① 외부 provider 였을 것 (로컬 실패는 폴백해도 같은 결과)
 *   ② **아직 사용자에게 토큰을 한 글자도 내보내지 않았을 것** — 스트리밍 도중
 *      교체하면 앞부분과 이어지지 않는 답변이 섞인다
 *   ③ 사용자 중단(abort)이 아닐 것
 *   ④ 재시도가 의미 있는 실패일 것 (인증·한도·모델부재·업스트림 오류)
 */
async function shouldFallbackToLocal(err: unknown, req: ChatMessageRequest): Promise<boolean> {
    if (!EXTERNAL_CHAT_FALLBACK.ENABLED) return false;
    if (req.abortSignal?.aborted) return false;

    const status = (err as { status?: number; statusCode?: number })?.status
        ?? (err as { statusCode?: number })?.statusCode;
    if (typeof status === 'number') {
        // 400(우리가 던진 vision 게이트 등 요청 자체 문제)은 재시도 무의미 — 제외
        if (status === 400) return false;
        if (status >= 401 && status < 600) return true;
    }
    const code = (err as { code?: string })?.code;
    return !!code && EXTERNAL_CHAT_FALLBACK.RETRYABLE_CODES.includes(code);
}

/**
 * 채팅 provider dispatch 진입점 (로컬 포함 단일 경로).
 * 외부 실패 시 위 조건에서 로컬 기본 모델로 1회 재시도한다.
 */
export async function streamFromExternalProvider(
    deps: ExternalProviderDeps,
    resolved: ResolvedProvider,
    req: ChatMessageRequest,
    onToken: (token: string, thinking?: string) => void,
    ctx: StreamFromExternalContext = {},
): Promise<string> {
    let emittedVisibleToken = false;
    const trackedOnToken = (token: string, thinking?: string): void => {
        if (token) emittedVisibleToken = true;
        onToken(token, thinking);
    };

    try {
        return await runExternalStream(deps, resolved, req, trackedOnToken, ctx);
    } catch (err) {
        if (resolved.providerId === 'local-llm' || emittedVisibleToken) throw err;
        if (!(await shouldFallbackToLocal(err, req))) throw err;
        if (!deps.providerRouter) throw err;

        const localFullId = `local-llm:${getConfig().llmDefaultModel}`;
        let localResolved: ResolvedProvider;
        try {
            localResolved = await deps.providerRouter.resolve(localFullId, {
                ...(req.userId ? { userId: String(req.userId) } : {}),
                ...(req.userRole ? { userRole: req.userRole } : {}),
            });
        } catch (resolveErr) {
            logger.warn(`로컬 폴백 해석 실패 — 원본 오류 전파: ${resolveErr instanceof Error ? resolveErr.message : resolveErr}`);
            throw err;
        }

        logger.warn(
            `외부 provider 실패 → 로컬 폴백: ${resolved.fullId} → ${localFullId} `
            + `(${err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120)})`,
        );
        // 사용자 고지 — 폴백은 대화를 살리지만, 알리지 않으면 "선택한 모델이 답했다"고
        // 오인한다(실측: Ollama Cloud 403 후 로컬이 답했는데 표시가 없었음).
        deps.onSystemEvent?.({
            type: 'model_fallback',
            message: `선택한 모델(${resolved.fullId})이 응답하지 않아 기본 모델로 답변했습니다.`,
            metadata: {
                from: resolved.fullId,
                to: localFullId,
                reason: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
            },
        });
        // 실제로 답하는 모델이 바뀌었다 — 배지 고지와 같은 이유로 응답의 model 도 갱신한다.
        req.onServedModel?.(servedModelLabel(localResolved));
        return runExternalStream(deps, localResolved, req, onToken, ctx);
    }
}
