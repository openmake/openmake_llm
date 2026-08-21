/**
 * 외부 provider 모델 접근 불가 판정 영속화 — external-provider.ts 에서 분리 (600줄 CI 가드).
 *
 * provider 카탈로그에는 있으나 이 계정으로는 못 쓰는 모델(Ollama Cloud 구독 전용 403,
 * NVIDIA 계정별 404 등)을 목록에서 걸러내기 위해 실패를 기록한다. 일시적 실패
 * (한도·인증·업스트림 장애)는 모델 자체 문제가 아니므로 기록하지 않는다 — 잘못 기록하면
 * 멀쩡한 모델이 목록에서 사라진다.
 *
 * @module services/chat-service/external-model-availability
 */
import { createLogger } from '../../utils/logger';
import type { ResolvedProvider } from '../../providers/provider-router';
import type { ExternalProviderDeps } from './external-provider-types';

const logger = createLogger('ChatExternalProvider');

/** 목록에서 제외할 근거가 되는 실패 코드 — 일시 오류(타임아웃·5xx)는 제외한다. */
const UNUSABLE_ERROR_CODES: ReadonlySet<string> = new Set([
    'SUBSCRIPTION_REQUIRED',
    'MODEL_NOT_FOUND',
    'NOT_SUPPORTED',
]);

/**
 * 접근 불가 모델을 영속화 (fire-and-forget).
 * 일시적 실패(한도·인증·업스트림 장애)는 모델 자체 문제가 아니므로 기록하지 않는다 —
 * 잘못 기록하면 멀쩡한 모델이 목록에서 사라진다.
 */
export function markModelUnusableFireAndForget(
    deps: ExternalProviderDeps,
    userId: string | undefined,
    resolved: ResolvedProvider,
    errorCode: string,
    err: unknown,
): void {
    if (!userId || resolved.providerId === 'local-llm') return;
    if (!UNUSABLE_ERROR_CODES.has(errorCode)) return;
    const repo = deps.providerRouter?.getExternalKeysRepo();
    if (!repo) return;
    void repo.markModelAvailability({
        userId: String(userId),
        providerId: resolved.providerId,
        modelId: resolved.modelId,
        usable: false,
        reason: `${errorCode}: ${err instanceof Error ? err.message : String(err)}`,
    }).then(() => {
        logger.info(`[Availability] 사용 불가 기록: ${resolved.fullId} (${errorCode})`);
    }).catch(() => { /* 관측 실패 무시 */ });
}
