/**
 * Discussion·Deep Research 모드의 외부 모델 클라이언트 해석 —
 * message-pipeline 에서 분리 (파일 크기 가드).
 *
 * 해석 우선순위:
 *   ① Deep Research → 'research' role 배정이 외부로 해석되면 그 모델 (REST /api/research 와 일치)
 *   ② 그 외(Discussion 전부 / role 미배정·로컬 해석) → 컴포저에서 선택한 모델(externalResolved)
 *
 * 어느 쪽도 해석되지 않으면 undefined 를 반환해 호출부가 로컬 svc.client 로 fail-open 한다.
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
    if (!userId || String(userId) === 'guest') return undefined;

    // ① Deep Research 는 'research' role 배정을 최우선으로 따른다 (REST /api/research 와 동작 일치).
    //    role 이 외부로 해석될 때만 채택하고, 로컬 해석/미배정이면 ② 로 내려가 기존 동작을 유지한다.
    //    (Discussion 은 대응 role 이 없어 해당 없음.)
    if (modeLabel === 'DeepResearch') {
        try {
            const { resolveRoleClientForUser } = await import('../model-role-resolver');
            const resolved = await resolveRoleClientForUser('research', String(userId));
            if (resolved.providerId !== 'local-llm') {
                if (resolved.degraded) {
                    logger.warn(`[Mode] research role 해석 폴백 (${resolved.fullId}): ${resolved.degraded}`);
                } else {
                    logger.info(`[Mode] DeepResearch research role 모델 사용: ${resolved.fullId} (source=${resolved.source})`);
                }
                return resolved.client;
            }
        } catch (e) {
            logger.warn('[Mode] research role 해석 실패 (컴포저 선택으로 폴백):', e);
        }
    }

    // ② 컴포저에서 선택한 모델. provider gate 는 로컬 선택도 ResolvedProvider
    //    ('local-llm:<tag>')로 채우므로, 로컬 모델을 여러 개 운영하는 클러스터에서
    //    사용자가 고른 태그를 잃지 않도록 그대로 해석한다.
    if (!externalResolved) return undefined;
    try {
        const { resolveAssignedModelClient } = await import('../model-role-resolver');
        const resolved = await resolveAssignedModelClient(externalResolved.fullId, String(userId));
        if (resolved.degraded) {
            logger.warn(`[Mode] 선택 모델 해석 폴백 (${externalResolved.fullId}): ${resolved.degraded}`);
        } else {
            logger.info(`[Mode] ${modeLabel} 선택 모델 사용: ${externalResolved.fullId}`);
        }
        return resolved.client;
    } catch (e) {
        logger.warn('[Mode] 선택 모델 해석 실패 (로컬 폴백):', e);
        return undefined;
    }
}
