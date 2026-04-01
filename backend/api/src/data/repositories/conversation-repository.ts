/**
 * @module data/repositories/conversation-repository
 * @description `conversation_sessions` / `conversation_messages` 테이블 데이터 접근 계층
 *
 * 대화 세션과 메시지 엔티티의 CRUD를 담당합니다.
 * - 세션 생성/조회/삭제, 사용자별 세션 목록
 * - 메시지 추가/조회, 세션별 메시지 히스토리
 * - 세션 제목/메타데이터 갱신
 * - 익명 세션 이관 (claim)
 * - 배치 메시지 로딩 (N+1 방지)
 * - 세션 수 제한 및 만료 세션 정리
 */
import { v4 as uuidv4 } from 'uuid';
import type { QueryResult } from 'pg';
import { BaseRepository } from './base-repository';
<<<<<<< HEAD
import type { ConversationMessage as DbMessage, ConversationSession as DbSession } from '../models/unified-database';
import { getConfig } from '../../config/env';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ConversationRepository');

// ===== View types (camelCase, frontend-compatible) =====

/**
 * 대화 세션 뷰 인터페이스 (프론트엔드 호환 camelCase)
 */
export interface ConversationSessionView {
    id: string;
    userId?: string;
    anonSessionId?: string;
    title: string;
    created_at: string;
    updated_at: string;
    metadata?: Record<string, unknown> | null;
    messages: ConversationMessageView[];
}

/**
 * 대화 메시지 뷰 인터페이스 (프론트엔드 호환 camelCase)
 */
export interface ConversationMessageView {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
    model?: string;
    thinking?: string;
}

/**
 * 메시지 저장 시 추가 옵션
 */
export interface MessageOptions {
    model?: string;
    thinking?: string;
    tokensUsed?: number;
    responseTime?: number;
}

// ===== Internal row types for PostgreSQL mapping =====

interface SessionRow {
    id: string;
    user_id: string | null;
    anon_session_id: string | null;
    title: string;
    created_at: string;
    updated_at: string;
    metadata: Record<string, unknown> | null;
}

interface MessageRow {
    id: number;
    session_id: string;
    role: string;
    content: string;
    model: string | null;
    agent_id: string | null;
    thinking: string | null;
    tokens: number | null;
    response_time_ms: number | null;
    created_at: string;
}

function isDuplicateKeyError(err: unknown): boolean {
    if (err instanceof Error && err.message.includes('duplicate key')) {
        return true;
    }
    if (typeof err === 'object' && err !== null && 'code' in err) {
        const code = (err as { code?: unknown }).code;
        return code === '23505';
    }
    return false;
}
=======
import type { ConversationMessage, ConversationSession } from '../models/unified-database.types';
>>>>>>> fbe49389978ecfeb4fc6d2df399c18138a7fed78

export class ConversationRepository extends BaseRepository {

    // ===== Row → View mapping =====

    private rowToMessage(row: MessageRow): ConversationMessageView {
        return {
            id: String(row.id),
            sessionId: row.session_id,
            role: row.role as 'user' | 'assistant' | 'system',
            content: row.content,
            timestamp: row.created_at,
            model: row.model || undefined,
            thinking: row.thinking || undefined
        };
    }

    private rowToSession(row: SessionRow, messages: ConversationMessageView[]): ConversationSessionView {
        return {
            id: row.id,
            userId: row.user_id || undefined,
            anonSessionId: row.anon_session_id || undefined,
            title: row.title,
            created_at: row.created_at,
            updated_at: row.updated_at,
            metadata: row.metadata || undefined,
            messages
        };
    }

    /**
     * Batch-load messages for a list of session rows (avoids N+1).
     */
    private async loadMessagesForSessions(rows: SessionRow[]): Promise<ConversationSessionView[]> {
        if (rows.length === 0) return [];

        const ids = rows.map(r => r.id);
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');

        const msgResult = await this.query<MessageRow>(
            `SELECT * FROM conversation_messages WHERE session_id IN (${placeholders}) ORDER BY created_at ASC`,
            ids
        );
        const msgRows = msgResult.rows;

        const msgMap = new Map<string, ConversationMessageView[]>();
        for (const mr of msgRows) {
            const arr = msgMap.get(mr.session_id);
            const msg = this.rowToMessage(mr);
            if (arr) {
                arr.push(msg);
            } else {
                msgMap.set(mr.session_id, [msg]);
            }
        }

        return rows.map(row => this.rowToSession(row, msgMap.get(row.id) || []));
    }

    // ===== Enforce MAX_SESSIONS =====

    private async enforceMaxSessions(): Promise<void> {
        const maxSessions = getConfig().maxConversationSessions;
        const countResult = await this.query('SELECT COUNT(*) as cnt FROM conversation_sessions');
        const cnt = parseInt((countResult.rows[0] as { cnt: string }).cnt, 10);
        if (cnt <= maxSessions) return;

        const excess = cnt - maxSessions;
        await this.query(`
            DELETE FROM conversation_sessions WHERE id IN (
                SELECT id FROM conversation_sessions ORDER BY updated_at ASC LIMIT $1
            )
        `, [excess]);

        logger.info(`[ConversationRepository] Cleaned ${excess} sessions (limit: ${maxSessions})`);
    }

    // ===== Low-level methods (raw DB types, used by UnifiedDatabase facade) =====

    async createSessionRaw(id: string, userId?: string, title?: string, metadata?: Record<string, unknown> | null): Promise<QueryResult<Record<string, unknown>>> {
        return this.query(
            'INSERT INTO conversation_sessions (id, user_id, title, metadata) VALUES ($1, $2, $3, $4)',
            [id, userId, title || '새 대화', JSON.stringify(metadata || {})]
        );
    }

    async addMessageRaw(sessionId: string, role: string, content: string, options?: {
        model?: string;
        agentId?: string;
        thinking?: string;
        tokens?: number;
        responseTimeMs?: number;
    }): Promise<QueryResult<Record<string, unknown>>> {
        return this.query(
            `INSERT INTO conversation_messages
            (session_id, role, content, model, agent_id, thinking, tokens, response_time_ms)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                sessionId,
                role,
                content,
                options?.model,
                options?.agentId,
                options?.thinking,
                options?.tokens,
                options?.responseTimeMs
            ]
        );
    }

    async getSessionMessages(sessionId: string, limit: number = 100): Promise<DbMessage[]> {
        const result = await this.query<DbMessage>(
            'SELECT * FROM conversation_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT $2',
            [sessionId, limit]
        );
        return result.rows as DbMessage[];
    }

    async getUserSessions(userId: string, limit: number = 50): Promise<DbSession[]> {
        const result = await this.query<DbSession>(
            'SELECT * FROM conversation_sessions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2',
            [userId, limit]
        );
        return result.rows as DbSession[];
    }

    async getAllSessions(limit: number = 50): Promise<DbSession[]> {
        const result = await this.query<DbSession>(
            'SELECT * FROM conversation_sessions ORDER BY updated_at DESC LIMIT $1',
            [limit]
        );
        return result.rows as DbSession[];
    }

    async deleteSession(sessionId: string): Promise<{ changes: number }> {
        const result = await this.query('DELETE FROM conversation_sessions WHERE id = $1', [sessionId]);
        return { changes: result.rowCount || 0 };
    }

    // ===== High-level methods (view types, replaces ConversationDB) =====

    async createSession(userId?: string, title?: string, metadata?: Record<string, unknown> | null, anonSessionId?: string): Promise<ConversationSessionView> {
        const id = uuidv4();
        const now = new Date().toISOString();
        const resolvedTitle = title || '새 대화';

        try {
            await this.query(`
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
            ]);
        } catch (err: unknown) {
            if (anonSessionId && isDuplicateKeyError(err)) {
                const existing = await this.getSessionsByAnonId(anonSessionId, 1);
                if (existing.length > 0) {
                    return existing[0];
                }
            }
            throw err;
        }

        await this.enforceMaxSessions();

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

    async getSession(id: string): Promise<ConversationSessionView | undefined> {
        const sessionResult = await this.query<SessionRow>('SELECT * FROM conversation_sessions WHERE id = $1', [id]);
        const row = sessionResult.rows[0];
        if (!row) return undefined;

        const msgResult = await this.query<MessageRow>(
            'SELECT * FROM conversation_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT 500',
            [id]
        );

        const messages = msgResult.rows.map(mr => this.rowToMessage(mr));
        return this.rowToSession(row, messages);
    }

    async getSessionsByUserId(userId: string, limit: number = 50): Promise<ConversationSessionView[]> {
        const result = await this.query<SessionRow>(
            'SELECT * FROM conversation_sessions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2',
            [userId, limit]
        );
        return this.loadMessagesForSessions(result.rows);
    }

    async getSessionsByAnonId(anonSessionId: string, limit: number = 50): Promise<ConversationSessionView[]> {
        const result = await this.query<SessionRow>(
            'SELECT * FROM conversation_sessions WHERE anon_session_id = $1 ORDER BY updated_at DESC LIMIT $2',
            [anonSessionId, limit]
        );
        return this.loadMessagesForSessions(result.rows);
    }

    async getAllSessionsWithMessages(limit: number = 100): Promise<ConversationSessionView[]> {
        const result = await this.query<SessionRow>(
            'SELECT * FROM conversation_sessions ORDER BY updated_at DESC LIMIT $1',
            [limit]
        );
        return this.loadMessagesForSessions(result.rows);
    }

    /**
     * 하위 호환성: guest이면 전체, 그 외는 사용자별 조회
     */
    async getSessions(userId: string, limit: number = 50): Promise<ConversationSessionView[]> {
        if (!userId || userId === 'guest') {
            return this.getAllSessionsWithMessages(limit);
        }
        return this.getSessionsByUserId(userId, limit);
    }

    async getMessages(sessionId: string, limit: number = 200): Promise<ConversationMessageView[]> {
        const safeLimit = Math.min(limit || 200, 1000);
        const result = await this.query<MessageRow>(
            'SELECT * FROM conversation_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT $2',
            [sessionId, safeLimit]
        );
        return result.rows.map(r => this.rowToMessage(r));
    }

    async addMessage(sessionId: string, role: 'user' | 'assistant' | 'system', content: string, options?: MessageOptions): Promise<ConversationMessageView | null> {
        // Verify session exists
        const sessionResult = await this.query('SELECT id FROM conversation_sessions WHERE id = $1', [sessionId]);
        if (sessionResult.rows.length === 0) return null;

        const now = new Date().toISOString();

        const result = await this.query(`
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

        // Update session's updated_at
        await this.query('UPDATE conversation_sessions SET updated_at = $1 WHERE id = $2', [now, sessionId]);

        return {
            id: String(result.rows[0].id),
            sessionId,
            role,
            content,
            timestamp: now,
            model: options?.model || undefined,
            thinking: options?.thinking || undefined
        };
    }

    /**
     * saveMessage 별칭 메서드 (server.ts 호환성)
     */
    async saveMessage(sessionId: string, role: 'user' | 'assistant' | 'system', content: string, options?: MessageOptions) {
        return this.addMessage(sessionId, role, content, options);
    }

    async updateSessionTitle(sessionId: string, title: string): Promise<boolean> {
        const now = new Date().toISOString();
        const result = await this.query(
            'UPDATE conversation_sessions SET title = $1, updated_at = $2 WHERE id = $3',
            [title, now, sessionId]
        );
        return (result.rowCount || 0) > 0;
    }

    async deleteAllSessionsByUserId(userId: string): Promise<number> {
        const result = await this.query(
            'DELETE FROM conversation_sessions WHERE user_id = $1',
            [userId]
        );
        const count = result.rowCount || 0;
        if (count > 0) {
            logger.info(`[ConversationRepository] Deleted all ${count} sessions for user ${userId}`);
        }
        return count;
    }

    /**
     * 익명 세션을 로그인한 사용자에게 이관
     */
    async claimAnonymousSessions(userId: string, anonSessionId: string): Promise<number> {
        const now = new Date().toISOString();
        const result = await this.query(
            `UPDATE conversation_sessions
             SET user_id = $1, anon_session_id = NULL, updated_at = $2
             WHERE anon_session_id = $3 AND (user_id IS NULL OR user_id = $1)`,
            [userId, now, anonSessionId]
        );
        const count = result.rowCount || 0;
        if (count > 0) {
            logger.info(`[ConversationRepository] Claimed ${count} anonymous sessions for user ${userId}`);
        }
        return count;
    }

    async cleanupOldSessions(days: number): Promise<number> {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const result = await this.query(
            'DELETE FROM conversation_sessions WHERE updated_at < $1',
            [cutoff]
        );
        const count = result.rowCount || 0;
        if (count > 0) {
            logger.info(`[ConversationRepository] Cleaned ${count} old sessions (${days} days)`);
        }
        return count;
    }
}
