/**
 * Token Blacklist - PostgreSQL-backed implementation
 * Pluggable interface allows future migration
 */

import type { Pool } from 'pg';
import { createLogger } from '../../utils/logger';

const logger = createLogger('TokenBlacklist');

/**
 * 폐기 사유(보안 점검 A7) — 'rotated' 는 refresh 회전으로 폐기된 옛 refresh(다시 오면 재사용 = 탈취 신호),
 * 'revoked' 는 그 밖(로그아웃·세션 상한 정리·비밀번호 변경). refresh 재사용 탐지는 'rotated' 만 본다.
 */
export const BLACKLIST_REASONS = ['revoked', 'rotated'] as const;
export type BlacklistReason = typeof BLACKLIST_REASONS[number];

/** token_blacklist.reason 열 정의 — CREATE·ALTER 공용(db/init/002-schema.sql·legacy-schema.ts·마이그레이션 195 와 같은 값) */
const REASON_COLUMN_SQL = "reason TEXT NOT NULL DEFAULT 'revoked'";

/**
 * Pluggable Token Blacklist Interface
 */
interface ITokenBlacklist {
    add(jti: string, expiresAt: number, reason?: BlacklistReason): Promise<void>;
    has(jti: string): Promise<boolean>;
    /** 만료 전 블랙리스트 행의 사유 — 없으면 null. refresh 경로 전용(access 경로는 has) */
    getReason(jti: string): Promise<BlacklistReason | null>;
    cleanup(): Promise<number>;
    getStats(): Promise<{ count: number }>;
}

/**
 * PostgreSQL-backed Token Blacklist Implementation
 * 공유 Pool(getPool())을 사용하여 연결 낭비를 방지합니다.
 */
class PostgresTokenBlacklist implements ITokenBlacklist {
    private cleanupInterval: NodeJS.Timeout | null = null;
    private initialized = false;

    /** 공유 Pool — lazy import로 순환 의존성 방지 */
    private async getPool(): Promise<Pool> {
        const { getPool } = await import('../models/unified-database');
        return getPool();
    }

    constructor() {
        this.startCleanupScheduler();
    }

    private async ensureTable(): Promise<void> {
        if (this.initialized) return;
        const pool = await this.getPool();
        await pool.query(`
            CREATE TABLE IF NOT EXISTS token_blacklist (
                jti TEXT PRIMARY KEY,
                expires_at BIGINT NOT NULL,
                created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000),
                ${REASON_COLUMN_SQL}
            )
        `);
        // DB_AUTO_MIGRATE=false 설치(마이그레이션 195 미적용) 대비 — 멱등
        await pool.query(`ALTER TABLE token_blacklist ADD COLUMN IF NOT EXISTS ${REASON_COLUMN_SQL}`);
        await pool.query('CREATE INDEX IF NOT EXISTS idx_blacklist_expires ON token_blacklist(expires_at)');
        this.initialized = true;
        logger.info('📋 PostgreSQL 테이블 초기화됨');
    }

    async add(jti: string, expiresAt: number, reason: BlacklistReason = 'revoked'): Promise<void> {
        await this.ensureTable();
        const pool = await this.getPool();
        // 한 번 rotated 로 기록된 jti 는 뒤의 로그아웃(revoked)이 덮어 재사용 탐지를 끄지 못하게 유지한다
        await pool.query(
            `INSERT INTO token_blacklist (jti, expires_at, reason) VALUES ($1, $2, $3)
             ON CONFLICT (jti) DO UPDATE SET expires_at = EXCLUDED.expires_at,
                 reason = CASE WHEN token_blacklist.reason = 'rotated' THEN 'rotated' ELSE EXCLUDED.reason END`,
            [jti, expiresAt, reason]
        );
    }

    async getReason(jti: string): Promise<BlacklistReason | null> {
        await this.ensureTable();
        const pool = await this.getPool();
        const result = await pool.query(
            'SELECT reason FROM token_blacklist WHERE jti = $1 AND expires_at > $2',
            [jti, Date.now()]
        );
        if (result.rows.length === 0) return null;
        return result.rows[0].reason === 'rotated' ? 'rotated' : 'revoked';
    }

    async has(jti: string): Promise<boolean> {
        await this.ensureTable();
        const pool = await this.getPool();
        const result = await pool.query(
            'SELECT 1 FROM token_blacklist WHERE jti = $1 AND expires_at > $2',
            [jti, Date.now()]
        );
        return result.rows.length > 0;
    }

    async cleanup(): Promise<number> {
        await this.ensureTable();
        const pool = await this.getPool();
        const result = await pool.query(
            'DELETE FROM token_blacklist WHERE expires_at < $1',
            [Date.now()]
        );
        return result.rowCount || 0;
    }

    async getStats(): Promise<{ count: number }> {
        await this.ensureTable();
        const pool = await this.getPool();
        const result = await pool.query(
            'SELECT COUNT(*) as count FROM token_blacklist WHERE expires_at > $1',
            [Date.now()]
        );
        return { count: parseInt(result.rows[0].count, 10) };
    }

    private startCleanupScheduler(): void {
        this.cleanupInterval = setInterval(async () => {
            try {
                const cleaned = await this.cleanup();
                if (cleaned > 0) {
                    logger.info(`🧹 ${cleaned}개 만료된 토큰 정리됨`);
                }
            } catch (err) {
                logger.error('Cleanup error:', err);
            }
        }, 60 * 60 * 1000);

        // 프로세스 종료를 막지 않도록 unref
        if (this.cleanupInterval.unref) {
            this.cleanupInterval.unref();
        }
    }

    /**
     * 정리 타이머를 중지합니다 (graceful shutdown 시 호출).
     * 공유 Pool을 사용하므로 pool.end()를 호출하지 않습니다.
     */
    async destroy(): Promise<void> {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}

// Singleton instance
let instance: ITokenBlacklist | null = null;

export function getTokenBlacklist(): ITokenBlacklist {
    if (!instance) {
        instance = new PostgresTokenBlacklist();
    }
    return instance;
}

export function resetTokenBlacklist(): void {
    if (instance && instance instanceof PostgresTokenBlacklist) {
        void (instance as PostgresTokenBlacklist).destroy();
    }
    instance = null;
}

