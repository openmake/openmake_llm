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
import { CONVERSATION_LIMITS } from '../config/runtime-limits';
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
 *
 * @param rows - 세션 row 목록
 * @param options.maxMessagesPerSession - 세션당 최근 N 메시지로 제한 (기본 미지정: 모든 메시지).
 *   list view 에서는 50 등 작은 값을 전달해 5K+ 메시지 보유 사용자의 메모리 spike 방지.
 *   single-session detail 은 getSession() 의 LIMIT 500 패턴을 사용하므로 본 함수 미사용.
 */
export async function loadMessagesForSessions(
    rows: SessionRow[],
    options?: { maxMessagesPerSession?: number }
): Promise<ConversationSession[]> {
    if (rows.length === 0) return [];

    const pool = getPool();
    const ids = rows.map(r => r.id);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const maxPerSession = options?.maxMessagesPerSession;

    let msgRows: MessageRow[];
    if (maxPerSession === undefined || maxPerSession <= 0) {
        // 기존 동작 (하위 호환): 세션당 메시지 무제한
        const msgResult = await pool.query(
            `SELECT * FROM conversation_messages WHERE session_id IN (${placeholders}) ORDER BY created_at ASC`,
            ids
        );
        msgRows = msgResult.rows as MessageRow[];
    } else {
        // window function 으로 세션당 최근 N 메시지만 — list view 페이로드 비대화 방지.
        // ROW_NUMBER() PARTITION BY session_id ORDER BY created_at DESC 로 최신 N 추출 후
        // 외부에서 created_at ASC 로 재정렬 (기존 동작과 동일 순서 보장).
        const msgResult = await pool.query(
            `SELECT * FROM (
                SELECT *, ROW_NUMBER() OVER (
                    PARTITION BY session_id ORDER BY created_at DESC
                ) AS rn
                FROM conversation_messages WHERE session_id IN (${placeholders})
            ) ranked WHERE rn <= $${ids.length + 1}
            ORDER BY session_id, created_at ASC`,
            [...ids, maxPerSession]
        );
        msgRows = msgResult.rows as MessageRow[];
    }

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
export async function getMessages(sessionId: string, limit: number = CONVERSATION_LIMITS.MESSAGES_DEFAULT): Promise<ConversationMessage[]> {
    const safeLimit = Math.min(limit || CONVERSATION_LIMITS.MESSAGES_DEFAULT, CONVERSATION_LIMITS.MESSAGES_MAX);
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

    // INSERT + 세션 updated_at 갱신을 단일 트랜잭션으로 처리 (원자성 보장).
    // 재시도는 트랜잭션 '전체'를 감싼다 — 트랜잭션 내부의 단일 statement 만 재시도하면
    // deadlock/serialization(40001/40P01) 시 트랜잭션이 이미 abort 되어 재시도가 25P02
    // ("current transaction is aborted")로 오보고된다. 새 BEGIN 부터 다시 시도해야 한다.
    const result = await withRetry(() => withTransaction(pool, async (client) => {
        const insertResult = await client.query(`
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
        ]);

        await client.query(
            'UPDATE conversation_sessions SET updated_at = $1 WHERE id = $2',
            [now, sessionId]
        );

        return insertResult;
    }), { operation: 'addMessage' });

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

/**
 * 메시지의 생각 요약 헤드라인 갱신 — 요약은 저장 후 비동기로 도착하므로 UPDATE 로 반영.
 * (thinking-summarizer 최종 요약 → request-handler 가 fire-and-forget 호출)
 */
export async function updateMessageReasoningSummary(messageId: string, summary: string): Promise<void> {
    const pool = getPool();
    await withRetry(() => pool.query(
        'UPDATE conversation_messages SET reasoning_summary = $1 WHERE id = $2',
        [summary, parseInt(messageId, 10)]
    ), { operation: 'updateMessageReasoningSummary' });
}
