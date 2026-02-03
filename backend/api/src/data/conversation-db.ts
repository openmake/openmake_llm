/**
 * Conversation DB
 * 대화 세션 및 메시지 관리 (PostgreSQL 구현)
 * UnifiedDatabase의 conversation_sessions / conversation_messages 테이블 사용
 */

import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { getPool } from './models/unified-database';
import { Pool } from 'pg';

// 🔒 설정: 환경변수로 조정 가능
const MAX_SESSIONS = parseInt(process.env.MAX_CONVERSATION_SESSIONS || '1000');
const SESSION_TTL_DAYS = parseInt(process.env.SESSION_TTL_DAYS || '30');

export interface ConversationSession {
    id: string;
    userId?: string;
    anonSessionId?: string;  // 비로그인 사용자 세션 식별자
    title: string;
    created_at: string;
    updated_at: string;
    metadata?: any;
    messages: ConversationMessage[];
}

export interface ConversationMessage {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
    model?: string;
    thinking?: string;
}

// Internal row types for PostgreSQL mapping
interface SessionRow {
    id: string;
    user_id: string | null;
    anon_session_id: string | null;
    title: string;
    created_at: string;
    updated_at: string;
    metadata: any | null;
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

class ConversationDB {
    constructor() {
        this.init().catch(err => console.error('[ConversationDB] Init failed:', err));
    }

    private async init(): Promise<void> {
        await this.initSchema();
        await this.migrateFromJson();
    }

    /**
     * Schema migration: add anon_session_id column if missing
     */
    private async initSchema(): Promise<void> {
        const pool = getPool();
        try {
            await pool.query(`ALTER TABLE conversation_sessions ADD COLUMN IF NOT EXISTS anon_session_id TEXT`);
        } catch (_e: any) {
            // "duplicate column name" is expected if already exists — ignore
        }
    }

    /**
     * One-time data migration from conversations.json → PostgreSQL
     */
    /**
     * Sanitize userId for FK safety: users 테이블에 존재하는 ID만 허용
     */
    private sanitizeUserId(userId: string | undefined | null, validUserIds: Set<string>): string | null {
        if (!userId || userId === 'guest') return null;
        if (validUserIds.size > 0 && !validUserIds.has(userId)) return null;
        return userId;
    }

    private async migrateFromJson(): Promise<void> {
        const jsonPath = path.join(__dirname, '..', '..', 'data', 'conversations.json');
        try {
            if (!fs.existsSync(jsonPath)) return;

            const raw = fs.readFileSync(jsonPath, 'utf-8');
            const sessions: any[] = JSON.parse(raw);
            if (!Array.isArray(sessions) || sessions.length === 0) return;

            const pool = getPool();
            const client = await pool.connect();

            try {
                await client.query('BEGIN');

                // FK 위반 방지: users 테이블의 유효한 ID 목록 조회
                const userResult = await client.query('SELECT id FROM users');
                const validUserIds = new Set<string>(userResult.rows.map((r: any) => r.id));

                for (const s of sessions) {
                    await client.query(
                        `INSERT INTO conversation_sessions (id, user_id, anon_session_id, title, created_at, updated_at, metadata)
                        VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
                        [
                            s.id,
                            this.sanitizeUserId(s.userId, validUserIds),
                            s.anonSessionId || null,
                            s.title || '새 대화',
                            s.created_at || new Date().toISOString(),
                            s.updated_at || new Date().toISOString(),
                            s.metadata ? JSON.stringify(s.metadata) : null
                        ]
                    );
                    if (Array.isArray(s.messages)) {
                        for (const m of s.messages) {
                            await client.query(
                                `INSERT INTO conversation_messages (session_id, role, content, model, thinking, created_at)
                                VALUES ($1, $2, $3, $4, $5, $6)`,
                                [
                                    s.id,
                                    m.role,
                                    m.content,
                                    m.model || null,
                                    m.thinking || null,
                                    m.timestamp || new Date().toISOString()
                                ]
                            );
                        }
                    }
                }

                await client.query('COMMIT');
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }

            // Rename to .migrated
            fs.renameSync(jsonPath, jsonPath + '.migrated');
            console.log(`[ConversationDB] JSON → PostgreSQL 마이그레이션 완료: ${sessions.length}개 세션`);
        } catch (error) {
            console.error('[ConversationDB] JSON 마이그레이션 실패 (무시):', error);
        }
    }

    // ===== Helper: row → interface mapping =====

    private rowToMessage(row: MessageRow): ConversationMessage {
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

    private rowToSession(row: SessionRow, messages: ConversationMessage[]): ConversationSession {
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
    private async loadMessagesForSessions(rows: SessionRow[]): Promise<ConversationSession[]> {
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

        console.log(`[ConversationDB] 🧹 용량 초과로 ${excess}개 세션 제거됨 (현재 ${MAX_SESSIONS}개)`);
    }

    // ===== Public API =====

    async createSession(userId?: string, title?: string, metadata?: any, anonSessionId?: string): Promise<ConversationSession> {
        const pool = getPool();
        const id = uuidv4();
        const now = new Date().toISOString();

        await pool.query(`
            INSERT INTO conversation_sessions (id, user_id, anon_session_id, title, created_at, updated_at, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
            id,
            userId || null,
            anonSessionId || null,
            title || '새 대화',
            now,
            now,
            metadata ? JSON.stringify(metadata) : null
        ]);

        await this.enforceMaxSessions();

        return {
            id,
            userId: userId || undefined,
            anonSessionId: anonSessionId || undefined,
            title: title || '새 대화',
            created_at: now,
            updated_at: now,
            metadata,
            messages: []
        };
    }

    async getSession(id: string): Promise<ConversationSession | undefined> {
        const pool = getPool();
        const sessionResult = await pool.query('SELECT * FROM conversation_sessions WHERE id = $1', [id]);
        const row = sessionResult.rows[0] as SessionRow | undefined;
        if (!row) return undefined;

        const msgResult = await pool.query(
            'SELECT * FROM conversation_messages WHERE session_id = $1 ORDER BY created_at ASC',
            [id]
        );

        const messages = (msgResult.rows as MessageRow[]).map(mr => this.rowToMessage(mr));
        return this.rowToSession(row, messages);
    }

    async getSessionsByUserId(userId: string, limit: number = 50): Promise<ConversationSession[]> {
        const pool = getPool();
        const result = await pool.query(
            'SELECT * FROM conversation_sessions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2',
            [userId, limit]
        );

        return this.loadMessagesForSessions(result.rows as SessionRow[]);
    }

    async getSessionsByAnonId(anonSessionId: string, limit: number = 50): Promise<ConversationSession[]> {
        const pool = getPool();
        const result = await pool.query(
            'SELECT * FROM conversation_sessions WHERE anon_session_id = $1 ORDER BY updated_at DESC LIMIT $2',
            [anonSessionId, limit]
        );

        return this.loadMessagesForSessions(result.rows as SessionRow[]);
    }

    async getAllSessions(limit: number = 100): Promise<ConversationSession[]> {
        const pool = getPool();
        const result = await pool.query(
            'SELECT * FROM conversation_sessions ORDER BY updated_at DESC LIMIT $1',
            [limit]
        );

        return this.loadMessagesForSessions(result.rows as SessionRow[]);
    }

    // 하위 호환성: guest이면 전체, 그 외는 사용자별 조회
    async getSessions(userId: string, limit: number = 50): Promise<ConversationSession[]> {
        if (!userId || userId === 'guest') {
            return this.getAllSessions(limit);
        }
        return this.getSessionsByUserId(userId, limit);
    }

    async getMessages(sessionId: string, limit: number = 100): Promise<ConversationMessage[]> {
        const pool = getPool();
        const result = await pool.query(
            'SELECT * FROM conversation_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT $2',
            [sessionId, limit]
        );

        return (result.rows as MessageRow[]).map(r => this.rowToMessage(r));
    }

    async addMessage(sessionId: string, role: 'user' | 'assistant' | 'system', content: string, options?: any): Promise<ConversationMessage | null> {
        const pool = getPool();

        // Verify session exists
        const sessionResult = await pool.query('SELECT id FROM conversation_sessions WHERE id = $1', [sessionId]);
        if (sessionResult.rows.length === 0) return null;

        const now = new Date().toISOString();

        const result = await pool.query(`
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
        await pool.query('UPDATE conversation_sessions SET updated_at = $1 WHERE id = $2', [now, sessionId]);

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

    // saveMessage 별칭 메서드 (server.ts 호환성)
    async saveMessage(sessionId: string, role: 'user' | 'assistant' | 'system', content: string, options?: any) {
        return this.addMessage(sessionId, role, content, options);
    }

    async updateSessionTitle(sessionId: string, title: string): Promise<boolean> {
        const pool = getPool();
        const now = new Date().toISOString();
        const result = await pool.query(
            'UPDATE conversation_sessions SET title = $1, updated_at = $2 WHERE id = $3',
            [title, now, sessionId]
        );

        return (result.rowCount || 0) > 0;
    }

    async getUserSessions(userId: string): Promise<ConversationSession[]> {
        return this.getSessions(userId);
    }

    async deleteSession(id: string): Promise<boolean> {
        const pool = getPool();
        const result = await pool.query('DELETE FROM conversation_sessions WHERE id = $1', [id]);
        return (result.rowCount || 0) > 0;
    }

    async cleanupOldSessions(days: number): Promise<number> {
        const pool = getPool();
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

        const result = await pool.query(
            'DELETE FROM conversation_sessions WHERE updated_at < $1',
            [cutoff]
        );

        const count = result.rowCount || 0;
        if (count > 0) {
            console.log(`[ConversationDB] 🧹 ${count}개 오래된 세션 정리됨 (${days}일 이전)`);
        }
        return count;
    }
}

// 싱글톤 인스턴스
const db = new ConversationDB();

console.log(`[ConversationDB] 🔒 설정: 최대 세션 ${MAX_SESSIONS}개, TTL ${SESSION_TTL_DAYS}일`);

export function getConversationDB() {
    return db;
}

// 스케줄러 (server.ts에서 require로 사용됨)
let cleanupTimer: any = null;

export function startSessionCleanupScheduler(intervalHours: number = 24) {
    if (cleanupTimer) clearInterval(cleanupTimer);

    console.log(`[ConversationDB] 세션 정리 스케줄러 시작 (주기: ${intervalHours}시간)`);

    cleanupTimer = setInterval(async () => {
        try {
            const count = await db.cleanupOldSessions(30);
            if (count > 0) {
                console.log(`[ConversationDB] 오래된 세션 ${count}개 정리됨`);
            }
        } catch (error) {
            console.error('[ConversationDB] 세션 정리 중 오류:', error);
        }
    }, intervalHours * 60 * 60 * 1000);
}
