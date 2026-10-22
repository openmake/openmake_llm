/**
 * 세션 분기(branchFromSessionId) 소유권 검증 — request-handler.ts 에서 분리 (max-lines 가드).
 *
 * @module chat/request-branch-meta
 */
import { createLogger } from '../utils/logger';
import type { ChatUserContext, ChatRequestParams } from './request-handler-types';

// 로그 모듈명은 분리 전과 같게 둔다(운영 로그 검색 호환).
const log = createLogger('ChatRequestHandler');

export async function validateBranchMeta(
    params: Pick<ChatRequestParams, 'branchFromSessionId' | 'branchFromMessageId'>,
    userContext: ChatUserContext,
): Promise<{ parentSessionId: string; parentMessageId?: string } | undefined> {
    // Phase 3 보완 D.3 (2026-05-26): branchFromSessionId 의 ownership 검증 —
    // 다른 사용자의 sessionId 가 parent 로 저장되지 않도록. 검증 실패 시 silent skip + warn.
    let validatedBranchMeta: { parentSessionId: string; parentMessageId?: string } | undefined;
    if (params.branchFromSessionId && userContext.authenticatedUserId) {
        try {
            const { getPool } = await import('../data/models/unified-database');
            const r = await getPool().query<{ user_id: string | null }>(
                'SELECT user_id FROM conversation_sessions WHERE id = $1',
                [params.branchFromSessionId]
            );
            const ownerUid = r.rows[0]?.user_id;
            if (ownerUid && ownerUid === userContext.authenticatedUserId) {
                validatedBranchMeta = {
                    parentSessionId: params.branchFromSessionId,
                    parentMessageId: params.branchFromMessageId,
                };
            } else {
                log.warn(`branchFromSessionId 권한 거부: parent.user=${ownerUid} != actor=${userContext.authenticatedUserId} — branch metadata 미저장`);
            }
        } catch (e) {
            log.warn(`branchFromSessionId 권한 검증 실패 (continue, branch 무시): ${e instanceof Error ? e.message : e}`);
        }
    } else if (params.branchFromSessionId) {
        // 비인증 사용자 — branch 정보 무시 (anon session 분기는 의미 없음)
        log.warn(`branchFromSessionId 무시 — 비인증 사용자 (anon session)`);
    }
    return validatedBranchMeta;
}
