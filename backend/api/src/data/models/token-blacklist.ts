/**
 * Token Blacklist - PostgreSQL-backed implementation
 * Pluggable interface allows future migration
 */

import { Pool } from 'pg';

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
 */
export class PostgresTokenBlacklist implements ITokenBlacklist {
    private pool: Pool;
    private cleanupInterval: NodeJS.Timeout | null = null;
    private initialized = false;
    
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL
        });
        this.startCleanupScheduler();
    }
    
    private async ensureTable(): Promise<void> {
        if (this.initialized) return;
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS token_blacklist (
                jti TEXT PRIMARY KEY,
                expires_at BIGINT NOT NULL,
                created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
            )
        `);
        await this.pool.query('CREATE INDEX IF NOT EXISTS idx_blacklist_expires ON token_blacklist(expires_at)');
        this.initialized = true;
        console.log('[TokenBlacklist] 📋 PostgreSQL 테이블 초기화됨');
    }
    
    async add(jti: string, expiresAt: number): Promise<void> {
        await this.ensureTable();
        await this.pool.query(
            'INSERT INTO token_blacklist (jti, expires_at) VALUES ($1, $2) ON CONFLICT (jti) DO UPDATE SET expires_at = $2',
            [jti, expiresAt]
        );
    }
    
    async has(jti: string): Promise<boolean> {
        await this.ensureTable();
        const result = await this.pool.query(
            'SELECT 1 FROM token_blacklist WHERE jti = $1 AND expires_at > $2',
            [jti, Date.now()]
        );
        return result.rows.length > 0;
    }
    
    async cleanup(): Promise<number> {
        await this.ensureTable();
        const result = await this.pool.query(
            'DELETE FROM token_blacklist WHERE expires_at < $1',
            [Date.now()]
        );
        return result.rowCount || 0;
    }
    
    async getStats(): Promise<{ count: number }> {
        await this.ensureTable();
        const result = await this.pool.query(
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
                    console.log(`[TokenBlacklist] 🧹 ${cleaned}개 만료된 토큰 정리됨`);
                }
            } catch (err) {
                console.error('[TokenBlacklist] Cleanup error:', err);
            }
        }, 60 * 60 * 1000);
    }
    
    async destroy(): Promise<void> {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        await this.pool.end();
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
        (instance as PostgresTokenBlacklist).destroy();
    }
    instance = null;
}
