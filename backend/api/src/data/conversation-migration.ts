/**
 * ============================================================
 * Conversation Migration - 스키마 초기화 및 JSON 마이그레이션
 * ============================================================
 *
 * - anon_session_id 컬럼 자동 추가 (스키마 마이그레이션)
 * - conversations.json -> PostgreSQL 원타임 데이터 마이그레이션
 *
 * @module data/conversation-migration
 */

import * as fs from 'fs';
import * as path from 'path';
import { getPool } from './models/unified-database';
import { createLogger } from '../utils/logger';

const logger = createLogger('ConversationMigration');

/**
 * Schema migration: add anon_session_id column if missing
 */
export async function initSchema(): Promise<void> {
    const pool = getPool();
    try {
        await pool.query(`ALTER TABLE conversation_sessions ADD COLUMN IF NOT EXISTS anon_session_id TEXT`);
    } catch (_e: unknown) {
        // "duplicate column name" is expected if already exists -- ignore
    }
}

/**
 * Sanitize userId for FK safety: users 테이블에 존재하는 ID만 허용
 */
function sanitizeUserId(userId: string | undefined | null, validUserIds: Set<string>): string | null {
    if (!userId || userId === 'guest') return null;
    if (validUserIds.size > 0 && !validUserIds.has(userId)) return null;
    return userId;
}

/**
 * One-time data migration from conversations.json -> PostgreSQL
 */
export async function migrateFromJson(): Promise<void> {
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
                        sanitizeUserId(s.userId, validUserIds),
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
        logger.info(`[ConversationMigration] JSON -> PostgreSQL migration complete: ${sessions.length} sessions`);
    } catch (error) {
        logger.error('[ConversationMigration] JSON migration failed (ignored):', error);
    }
}
