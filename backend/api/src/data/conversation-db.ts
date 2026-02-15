/**
 * ============================================================
 * Conversation DB - 대화 세션 및 메시지 관리
 * ============================================================
 *
 * 대화 세션과 메시지의 전체 생명주기를 관리하는 데이터 접근 레이어입니다.
 * PostgreSQL의 conversation_sessions / conversation_messages 테이블을 사용합니다.
 *
 * @module data/conversation-db
 * @description
 * - 세션 CRUD (생성, 조회, 수정, 삭제)
 * - 사용자별/익명 세션 격리 조회
 * - 메시지 저장 및 조회 (N+1 방지 배치 로딩)
 * - 익명 세션 → 로그인 사용자 이관 (claim)
 * - JSON → PostgreSQL 원타임 마이그레이션
 * - 자동 세션 정리 스케줄러 (만료 세션 삭제)
 */

import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { getPool } from './models/unified-database';
import { getConfig } from '../config/env';
import { createLogger } from '../utils/logger';
import { withRetry } from './retry-wrapper';

const logger = createLogger('ConversationDB');

// 🔒 설정: 환경변수로 조정 가능
const MAX_SESSIONS = getConfig().maxConversationSessions;
const SESSION_TTL_DAYS = getConfig().sessionTtlDays;

/**
 * 대화 세션 인터페이스 (프론트엔드 호환 camelCase)
 * @interface ConversationSession
 */
export interface ConversationSession {
    /** 세션 고유 식별자 (UUID) */
    id: string;
    /** 소유 사용자 ID (로그인 사용자) */
    userId?: string;
    /** 비로그인 사용자 세션 식별자 (UUID v4) */
    anonSessionId?: string;
    /** 대화 제목 */
    title: string;
    /** 세션 생성 일시 (ISO 8601) */
    created_at: string;
    /** 마지막 업데이트 일시 (ISO 8601) */
    updated_at: string;
    /** 세션 메타데이터 (JSONB) */
    metadata?: Record<string, unknown> | null;
    /** 세션에 속한 메시지 목록 */
    messages: ConversationMessage[];
}

/**
 * 대화 메시지 인터페이스 (프론트엔드 호환 camelCase)
 * @interface ConversationMessage
 */
export interface ConversationMessage {
    /** 메시지 고유 식별자 */
    id: string;
    /** 소속 세션 ID */
    sessionId: string;
    /** 메시지 발화자 역할 */
    role: 'user' | 'assistant' | 'system';
    /** 메시지 본문 */
    content: string;
    /** 메시지 생성 일시 (ISO 8601) */
    timestamp: string;
    /** 응답 생성에 사용된 모델명 */
    model?: string;
    /** AI의 사고 과정 */
    thinking?: string;
}

/**
 * 메시지 저장 시 추가 옵션
 * @interface MessageOptions
 */
interface MessageOptions {
    /** 사용된 모델명 */
    model?: string;
    /** AI 사고 과정 텍스트 */
    thinking?: string;
    /** 사용된 토큰 수 */
    tokensUsed?: number;
    /** 응답 생성 시간 (밀리초) */
    responseTime?: number;
}

// Internal row types for PostgreSQL mapping
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

/**
 * 대화 데이터베이스 접근 클래스
 *
 * PostgreSQL의 conversation_sessions/conversation_messages 테이블에 대한
 * CRUD 작업을 제공합니다. 싱글톤으로 관리됩니다.
 *
 * @class ConversationDB
 * @description
 * - 초기화 시 스키마 마이그레이션 (anon_session_id 컬럼 추가)
 * - JSON 파일 → PostgreSQL 원타임 데이터 마이그레이션
 * - 세션 수 제한 (MAX_SESSIONS) 자동 적용
 * - 배치 메시지 로딩으로 N+1 쿼리 방지
 */
class ConversationDB {
    /**
     * ConversationDB 인스턴스를 생성합니다.
     * 초기화 시 스키마 마이그레이션과 JSON 데이터 이관을 비동기로 수행합니다.
     */
    constructor() {
        this.init().catch(err => logger.error('[ConversationDB] Init failed:', err));
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
        } catch (_e: unknown) {
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
            const sessions = JSON.parse(raw) as Array<{
                id: string; userId?: string; anonSessionId?: string;
                title?: string; created_at?: string; updated_at?: string;
                metadata?: Record<string, unknown>; messages?: Array<{
                    role: string; content: string; model?: string;
                    thinking?: string; timestamp?: string;
                }>;
            }>;
            if (!Array.isArray(sessions) || sessions.length === 0) return;

            const pool = getPool();
            const client = await pool.connect();

            try {
                await client.query('BEGIN');

                // FK 위반 방지: users 테이블의 유효한 ID 목록 조회
                const userResult = await client.query('SELECT id FROM users');
                const validUserIds = new Set<string>(userResult.rows.map((r) => r.id));

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
            logger.info(`[ConversationDB] JSON → PostgreSQL migration complete: ${sessions.length} sessions`);
        } catch (error) {
            logger.error('[ConversationDB] JSON migration failed (ignored):', error);
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

        logger.info(`[ConversationDB] Cleaned ${excess} sessions (limit: ${MAX_SESSIONS})`);
    }

    // ===== Public API =====

    async createSession(userId?: string, title?: string, metadata?: Record<string, unknown> | null, anonSessionId?: string): Promise<ConversationSession> {
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

    async getMessages(sessionId: string, limit: number = 200): Promise<ConversationMessage[]> {
        const safeLimit = Math.min(limit || 200, 1000);
        const pool = getPool();
        const result = await pool.query(
            'SELECT * FROM conversation_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT $2',
            [sessionId, safeLimit]
        );

        return (result.rows as MessageRow[]).map(r => this.rowToMessage(r));
    }

    async addMessage(sessionId: string, role: 'user' | 'assistant' | 'system', content: string, options?: MessageOptions): Promise<ConversationMessage | null> {
        const pool = getPool();

        // Verify session exists
        const sessionResult = await pool.query('SELECT id FROM conversation_sessions WHERE id = $1', [sessionId]);
        if (sessionResult.rows.length === 0) return null;

        const now = new Date().toISOString();

        const result = await withRetry(() => pool.query(`
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
    async saveMessage(sessionId: string, role: 'user' | 'assistant' | 'system', content: string, options?: MessageOptions) {
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

    /**
     * 익명 세션을 로그인한 사용자에게 이관
     * anon_session_id로 생성된 세션의 user_id를 업데이트하고 anon_session_id를 제거
     * @returns 이관된 세션 수
     */
    async claimAnonymousSessions(userId: string, anonSessionId: string): Promise<number> {
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
            logger.info(`[ConversationDB] Claimed ${count} anonymous sessions for user ${userId}`);
        }
        return count;
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
            logger.info(`[ConversationDB] Cleaned ${count} old sessions (${days} days)`);
        }
        return count;
    }
}

/** 싱글톤 인스턴스 (lazy initialization) */
let dbInstance: ConversationDB | null = null;

/**
 * ConversationDB 싱글톤 인스턴스를 반환합니다.
 *
 * @returns ConversationDB 인스턴스
 */
export function getConversationDB() {
    if (!dbInstance) {
        dbInstance = new ConversationDB();
        logger.info(`[ConversationDB] Config: max sessions ${MAX_SESSIONS}, TTL ${SESSION_TTL_DAYS} days`);
    }
    return dbInstance;
}

/** 세션 정리 스케줄러 타이머 */
let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 만료 세션 자동 정리 스케줄러를 시작합니다.
 * 지정된 간격으로 30일 이상 된 세션을 삭제합니다.
 *
 * @param intervalHours - 정리 실행 간격 (시간 단위, 기본값: 24)
 */
export function startSessionCleanupScheduler(intervalHours: number = 24) {
    if (cleanupTimer) clearInterval(cleanupTimer);

    logger.info(`[ConversationDB] Cleanup scheduler started (interval: ${intervalHours}h)`);

    cleanupTimer = setInterval(async () => {
        try {
            const count = await getConversationDB().cleanupOldSessions(30);
            if (count > 0) {
                logger.info(`[ConversationDB] Cleaned ${count} old sessions`);
            }
        } catch (error) {
            logger.error('[ConversationDB] Cleanup error:', error);
        }
    }, intervalHours * 60 * 60 * 1000);
}
