/**
 * ============================================================
 * Conversation Sessions - 세션 CRUD 및 관리
 * ============================================================
 *
 * 대화 세션의 생성, 조회, 수정, 삭제, 익명 이관, 정리를 담당합니다.
 *
 * @module data/conversation-sessions
 */

import { v4 as uuidv4 } from 'uuid';
import { getPool } from './models/unified-database';
import { getConfig } from '../config/env';
import { createLogger } from '../utils/logger';
import { withRetry } from './retry-wrapper';
import {
    ConversationSession,
    SessionRow,
    MessageRow,
    isDuplicateKeyError,
    rowToMessage,
    rowToSession
} from './conversation-types';
import { loadMessagesForSessions } from './conversation-messages';

const logger = createLogger('ConversationSessions');

// 설정: 환경변수로 조정 가능
const MAX_SESSIONS = getConfig().maxConversationSessions;

/**
 * 세션 수 제한 적용 (MAX_SESSIONS 초과 시 가장 오래된 세션 삭제)
 */
async function enforceMaxSessions(): Promise<void> {
    const pool = getPool();
    const countResult = await pool.query('SELECT COUNT(*) as cnt FROM conversation_sessions');
    const cnt = parseInt(countResult.rows[0].cnt, 10);
    if (cnt <= MAX_SESSIONS) return;

    const excess = cnt - MAX_SESSIONS;
    await pool.query(`
        DELETE FROM conversation_sessions WHERE id IN (
            SELECT id FROM conversation_sessions ORDER BY updated_at ASC LIMIT $1
        )
    `, [excess]);

    logger.info(`[ConversationSessions] Cleaned ${excess} sessions (limit: ${MAX_SESSIONS})`);
}

/**
 * 새 세션 생성
 */
export async function createSession(
    userId?: string,
    title?: string,
    metadata?: Record<string, unknown> | null,
    anonSessionId?: string
): Promise<ConversationSession> {
    const pool = getPool();
    const id = uuidv4();
    const now = new Date().toISOString();
    const resolvedTitle = title || '새 대화';

    try {
        await withRetry(() => pool.query(`
            INSERT INTO conversation_sessions (id, user_id, anon_session_id, title, created_at, updated_at, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
            id,
            userId || null,
            anonSessionId || null,
            resolvedTitle,
            now,
            now,
            metadata ? JSON.stringify(metadata) : null
        ]), { operation: 'createSession' });
    } catch (err: unknown) {
        if (anonSessionId && isDuplicateKeyError(err)) {
            const existing = await getSessionsByAnonId(anonSessionId, 1);
            if (existing.length > 0) {
                return existing[0];
            }
        }
        throw err;
    }

    await enforceMaxSessions();

    return {
        id,
        userId: userId || undefined,
        anonSessionId: anonSessionId || undefined,
        title: resolvedTitle,
        created_at: now,
        updated_at: now,
        metadata,
        messages: []
    };
}

/**
 * 세션 단건 조회 (메시지 포함)
 */
export async function getSession(id: string): Promise<ConversationSession | undefined> {
    const pool = getPool();
    const sessionResult = await pool.query('SELECT * FROM conversation_sessions WHERE id = $1', [id]);
    const row = sessionResult.rows[0] as SessionRow | undefined;
    if (!row) return undefined;

    const msgResult = await pool.query(
        'SELECT * FROM conversation_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT 500',
        [id]
    );

    const messages = (msgResult.rows as MessageRow[]).map(mr => rowToMessage(mr));
    return rowToSession(row, messages);
}

/**
 * 사용자 ID로 세션 목록 조회
 */
export async function getSessionsByUserId(userId: string, limit: number = 50): Promise<ConversationSession[]> {
    const pool = getPool();
    const result = await pool.query(
        'SELECT * FROM conversation_sessions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2',
        [userId, limit]
    );

    return loadMessagesForSessions(result.rows as SessionRow[]);
}

/**
 * 익명 세션 ID로 세션 목록 조회
 */
export async function getSessionsByAnonId(anonSessionId: string, limit: number = 50): Promise<ConversationSession[]> {
    const pool = getPool();
    const result = await pool.query(
        'SELECT * FROM conversation_sessions WHERE anon_session_id = $1 ORDER BY updated_at DESC LIMIT $2',
        [anonSessionId, limit]
    );

    return loadMessagesForSessions(result.rows as SessionRow[]);
}

/**
 * 전체 세션 목록 조회
 */
export async function getAllSessions(limit: number = 100): Promise<ConversationSession[]> {
    const pool = getPool();
    const result = await pool.query(
        'SELECT * FROM conversation_sessions ORDER BY updated_at DESC LIMIT $1',
        [limit]
    );

    return loadMessagesForSessions(result.rows as SessionRow[]);
}

/**
 * 하위 호환성: guest이면 전체, 그 외는 사용자별 조회
 */
export async function getSessions(userId: string, limit: number = 50): Promise<ConversationSession[]> {
    if (!userId || userId === 'guest') {
        return getAllSessions(limit);
    }
    return getSessionsByUserId(userId, limit);
}

/**
 * getUserSessions 별칭 (하위 호환)
 */
export async function getUserSessions(userId: string): Promise<ConversationSession[]> {
    return getSessions(userId);
}

/**
 * 세션 제목 업데이트
 */
export async function updateSessionTitle(sessionId: string, title: string): Promise<boolean> {
    const pool = getPool();
    const now = new Date().toISOString();
    const result = await pool.query(
        'UPDATE conversation_sessions SET title = $1, updated_at = $2 WHERE id = $3',
        [title, now, sessionId]
    );

    return (result.rowCount || 0) > 0;
}

/**
 * 세션 삭제 (CASCADE로 메시지 함께 삭제)
 */
export async function deleteSession(id: string): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query('DELETE FROM conversation_sessions WHERE id = $1', [id]);
    return (result.rowCount || 0) > 0;
}

/**
 * 특정 사용자의 모든 대화 세션을 삭제합니다.
 * CASCADE로 메시지도 함께 삭제됩니다.
 * @param userId - 사용자 ID
 * @returns 삭제된 세션 수
 */
export async function deleteAllSessionsByUserId(userId: string): Promise<number> {
    const pool = getPool();
    const result = await pool.query(
        'DELETE FROM conversation_sessions WHERE user_id = $1',
        [userId]
    );
    const count = result.rowCount || 0;
    if (count > 0) {
        logger.info(`[ConversationSessions] Deleted all ${count} sessions for user ${userId}`);
    }
    return count;
}

/**
 * 익명 세션을 로그인한 사용자에게 이관
 * anon_session_id로 생성된 세션의 user_id를 업데이트하고 anon_session_id를 제거
 * @returns 이관된 세션 수
 */
export async function claimAnonymousSessions(userId: string, anonSessionId: string): Promise<number> {
    const pool = getPool();
    const now = new Date().toISOString();

    const result = await pool.query(
        `UPDATE conversation_sessions
         SET user_id = $1, anon_session_id = NULL, updated_at = $2
         WHERE anon_session_id = $3 AND (user_id IS NULL OR user_id = $1)`,
        [userId, now, anonSessionId]
    );

    const count = result.rowCount || 0;
    if (count > 0) {
        logger.info(`[ConversationSessions] Claimed ${count} anonymous sessions for user ${userId}`);
    }
    return count;
}

/**
 * 오래된 세션 정리
 * @param days - 기준 일수 (이보다 오래된 세션 삭제)
 * @returns 삭제된 세션 수
 */
export async function cleanupOldSessions(days: number): Promise<number> {
    const pool = getPool();
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const result = await pool.query(
        'DELETE FROM conversation_sessions WHERE updated_at < $1',
        [cutoff]
    );

    const count = result.rowCount || 0;
    if (count > 0) {
        logger.info(`[ConversationSessions] Cleaned ${count} old sessions (${days} days)`);
    }
    return count;
}
