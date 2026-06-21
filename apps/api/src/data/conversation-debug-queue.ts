/**
 * ============================================================
 * Conversation Debug Queue — 디버깅·재현용 임시 본문 보존
 * ============================================================
 *
 * `conversation_messages` 테이블이 사용자 saveHistory 토글에 의해
 * 조건부 저장되는 환경에서, 운영 안전망으로 본문을 일시 보존한다.
 *
 * 두 가지 트리거:
 *   - 'auto-error': 에러 발생 시 자동 저장 (24h TTL)
 *   - 'user-report': 사용자 🚩 버튼 신고 (7d TTL)
 *
 * cleanup cron 이 expires_at < now() 항목을 주기적으로 삭제.
 *
 * @module data/conversation-debug-queue
 * @see db/migrations/015_conversation_debug_queue.sql
 */

import { getPool } from './models/unified-database';
import { withRetry } from './retry-wrapper';
import { createLogger } from '../utils/logger';

const logger = createLogger('ConversationDebugQueue');

/** 디버그 큐 저장 사유 */
export type DebugQueueReason = 'auto-error' | 'user-report';

/** TTL 정책 — 사유별 보존 기간 (밀리초) */
export const DEBUG_QUEUE_TTL_MS: Record<DebugQueueReason, number> = {
    'auto-error':
        Number(process.env.OMK_DEBUG_QUEUE_AUTO_ERROR_TTL_MS) || 24 * 60 * 60 * 1000,
    'user-report':
        Number(process.env.OMK_DEBUG_QUEUE_USER_REPORT_TTL_MS) || 7 * 24 * 60 * 60 * 1000,
};

/** 디버그 큐 INSERT 입력 */
export interface DebugQueueEntry {
    sessionId: string;
    userId: string;
    reason: DebugQueueReason;
    userMessage: string;
    /** 부분 응답 가능 (첫 토큰 전 에러면 빈 문자열) */
    assistantMessage: string;
    /** reason='auto-error' 시만 채움 */
    errorCode?: string;
    /** model, agent, queryType 등 운영 메타 */
    routingMetadata?: Record<string, unknown>;
}

/**
 * 디버그 큐에 항목 1건 INSERT.
 *
 * 실패해도 throw 하지 않음 — 디버그 큐 실패가 채팅 흐름을 막지 않게 한다.
 *
 * @returns 생성된 항목 ID 와 만료 시각, 실패 시 null
 */
export async function enqueueDebugCapture(
    entry: DebugQueueEntry,
): Promise<{ id: string; expiresAt: Date } | null> {
    try {
        const pool = getPool();
        const ttlMs = DEBUG_QUEUE_TTL_MS[entry.reason];
        const expiresAt = new Date(Date.now() + ttlMs);

        const result = await withRetry(
            () =>
                pool.query<{ id: string }>(
                    `INSERT INTO conversation_debug_queue
                       (session_id, user_id, expires_at, reason,
                        user_message, assistant_message, error_code, routing_metadata)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                     RETURNING id`,
                    [
                        entry.sessionId,
                        entry.userId,
                        expiresAt.toISOString(),
                        entry.reason,
                        entry.userMessage,
                        entry.assistantMessage,
                        entry.errorCode ?? null,
                        entry.routingMetadata ? JSON.stringify(entry.routingMetadata) : null,
                    ],
                ),
            { operation: 'enqueueDebugCapture' },
        );

        const id = result.rows[0]?.id;
        if (!id) return null;
        logger.info(
            `[DebugQueue] 본문 보존: reason=${entry.reason}, session=${entry.sessionId}, expires=${expiresAt.toISOString()}`,
        );
        return { id, expiresAt };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[DebugQueue] enqueue 실패 (reason=${entry.reason}): ${msg}`);
        return null;
    }
}

/**
 * 만료된 디버그 큐 항목을 삭제한다 (cleanup cron 용).
 *
 * @returns 삭제된 항목 수
 */
export async function cleanupExpiredDebugQueue(): Promise<number> {
    try {
        const pool = getPool();
        const result = await withRetry(
            () =>
                pool.query(
                    `DELETE FROM conversation_debug_queue WHERE expires_at < now()`,
                ),
            { operation: 'cleanupExpiredDebugQueue' },
        );
        const count = result.rowCount ?? 0;
        if (count > 0) {
            logger.info(`[DebugQueue] 만료 항목 ${count}건 정리`);
        }
        return count;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[DebugQueue] cleanup 실패: ${msg}`);
        return 0;
    }
}
