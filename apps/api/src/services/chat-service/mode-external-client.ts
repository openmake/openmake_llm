/**
 * Discussion·Deep Research 모드의 외부 모델 클라이언트 해석 —
 * message-pipeline 에서 분리 (파일 크기 가드).
 *
 * 외부 provider 선택(externalResolved) 시 그 모델의 LLMClient 를 해석해
 * 두 모드 전략에 주입할 수 있게 한다. 해석 실패는 undefined 반환(호출부가
 * 로컬 svc.client 로 fail-open).
 *
 * @module services/chat-service/mode-external-client
 */
import type { ResolvedProvider } from '../../providers/provider-router';
import type { LLMClient } from '../../llm';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ModeExternalClient');

export async function resolveModeExternalClient(
    externalResolved: ResolvedProvider | null,
    userId: string | number | undefined,
    modeLabel: 'Discussion' | 'DeepResearch',
): Promise<LLMClient | undefined> {
    if (!externalResolved || !userId || String(userId) === 'guest') return undefined;
    try {
        const { resolveAssignedModelClient } = await import('../model-role-resolver');
        const resolved = await resolveAssignedModelClient(externalResolved.fullId, String(userId));
        if (resolved.degraded) {
            logger.warn(`[Mode] 외부 모델 해석 폴백 (${externalResolved.fullId}): ${resolved.degraded}`);
        } else {
            logger.info(`[Mode] ${modeLabel} 외부 모델 사용: ${externalResolved.fullId}`);
        }
        return resolved.client;
    } catch (e) {
        logger.warn('[Mode] 외부 모델 해석 실패 (로컬 폴백):', e);
        return undefined;
    }
}
