/**
 * ============================================================
 * Conversation Messages - 메시지 CRUD
 * ============================================================
 *
 * 대화 메시지의 조회, 저장을 담당합니다.
 *
 * @module data/conversation-messages
 */

import { getPool } from './models/unified-database';
import { withRetry, withTransaction } from './retry-wrapper';
import {
    ConversationMessage,
    MessageOptions,
    MessageRow,
    SessionRow,
    ConversationSession,
    rowToMessage,
    rowToSession
} from './conversation-types';

/**
 * 세션 목록에 대한 메시지 배치 로딩 (N+1 방지)
 */
export async function loadMessagesForSessions(rows: SessionRow[]): Promise<ConversationSession[]> {
    if (rows.length === 0) return [];

    const pool = getPool();
    const ids = rows.map(r => r.id);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');

    const msgResult = await pool.query(
        `SELECT * FROM conversation_messages WHERE session_id IN (${placeholders}) ORDER BY created_at ASC`,
        ids
    );
    const msgRows = msgResult.rows as MessageRow[];

    // Group messages by session_id
    const msgMap = new Map<string, ConversationMessage[]>();
    for (const mr of msgRows) {
        const arr = msgMap.get(mr.session_id);
        const msg = rowToMessage(mr);
        if (arr) {
            arr.push(msg);
        } else {
            msgMap.set(mr.session_id, [msg]);
        }
    }

    return rows.map(row => rowToSession(row, msgMap.get(row.id) || []));
}

/**
 * 세션의 메시지 목록 조회
 */
export async function getMessages(sessionId: string, limit: number = 200): Promise<ConversationMessage[]> {
    const safeLimit = Math.min(limit || 200, 1000);
    const pool = getPool();
    const result = await pool.query(
        'SELECT * FROM conversation_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT $2',
        [sessionId, safeLimit]
    );

    return (result.rows as MessageRow[]).map(r => rowToMessage(r));
}

/**
 * 세션에 메시지 추가
 */
export async function addMessage(
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    options?: MessageOptions
): Promise<ConversationMessage | null> {
    const pool = getPool();

    // Verify session exists (트랜잭션 밖에서 먼저 확인 -- 읽기 전용이므로 OK)
    const sessionResult = await pool.query('SELECT id FROM conversation_sessions WHERE id = $1', [sessionId]);
    if (sessionResult.rows.length === 0) return null;

    const now = new Date().toISOString();

    // INSERT + 세션 updated_at 갱신을 단일 트랜잭션으로 처리 (원자성 보장)
    const result = await withTransaction(pool, async (client) => {
        const insertResult = await withRetry(() => client.query(`
            INSERT INTO conversation_messages (session_id, role, content, model, thinking, tokens, response_time_ms, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
        `, [
            sessionId,
            role,
            content,
            options?.model || null,
            options?.thinking || null,
            options?.tokensUsed || null,
            options?.responseTime || null,
            now
        ]), { operation: 'addMessage' });

        await client.query(
            'UPDATE conversation_sessions SET updated_at = $1 WHERE id = $2',
            [now, sessionId]
        );

        return insertResult;
    });

    return {
        id: String((result.rows[0] as { id: number }).id),
        sessionId,
        role,
        content,
        timestamp: now,
        model: options?.model || undefined,
        thinking: options?.thinking || undefined
    };
}
