/**
 * Token Blacklist - PostgreSQL-backed implementation
 * Pluggable interface allows future migration
 */

import type { Pool } from 'pg';
import { createLogger } from '../../utils/logger';

const logger = createLogger('TokenBlacklist');

/**
 * Pluggable Token Blacklist Interface
 */
export interface ITokenBlacklist {
    add(jti: string, expiresAt: number): Promise<void>;
    has(jti: string): Promise<boolean>;
    cleanup(): Promise<number>;
    getStats(): Promise<{ count: number }>;
}

/**
 * PostgreSQL-backed Token Blacklist Implementation
 * 공유 Pool(getPool())을 사용하여 연결 낭비를 방지합니다.
 */
export class PostgresTokenBlacklist implements ITokenBlacklist {
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
                created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
            )
        `);
        await pool.query('CREATE INDEX IF NOT EXISTS idx_blacklist_expires ON token_blacklist(expires_at)');
        this.initialized = true;
        logger.info('📋 PostgreSQL 테이블 초기화됨');
    }

    async add(jti: string, expiresAt: number): Promise<void> {
        await this.ensureTable();
        const pool = await this.getPool();
        await pool.query(
            'INSERT INTO token_blacklist (jti, expires_at) VALUES ($1, $2) ON CONFLICT (jti) DO UPDATE SET expires_at = $2',
            [jti, expiresAt]
        );
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

