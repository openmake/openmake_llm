import { getPool } from '../data/models/unified-database';
import { createLogger } from './logger';

const logger = createLogger('TokenCleanup');

/**
 * Delete expired entries from token_blacklist table.
 * Called on server startup and every hour via setInterval.
 */
export async function pruneExpiredTokens(): Promise<number> {
    try {
        const pool = getPool();
        const result = await pool.query(
            'DELETE FROM token_blacklist WHERE expires_at < $1',
            [Date.now()]
        );
        const deleted = result.rowCount ?? 0;
        if (deleted > 0) {
            logger.info(`[TokenCleanup] Pruned ${deleted} expired token blacklist entries`);
        }
        return deleted;
    } catch (error) {
        logger.error('[TokenCleanup] Failed to prune expired tokens:', error);
        return 0;
    }
}

/**
 * Also prune expired chat_rate_limits entries.
 */
export async function pruneExpiredRateLimits(): Promise<number> {
    try {
        const pool = getPool();
        const result = await pool.query(
            'DELETE FROM chat_rate_limits WHERE reset_at < NOW()'
        );
        const deleted = result.rowCount ?? 0;
        if (deleted > 0) {
            logger.info(`[TokenCleanup] Pruned ${deleted} expired rate limit entries`);
        }
        return deleted;
    } catch (error) {
        logger.error('[TokenCleanup] Failed to prune expired rate limits:', error);
        return 0;
    }
}

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic cleanup (call once on server startup).
 * Runs immediately, then every hour.
 */
export function startPeriodicCleanup(): void {
    if (cleanupInterval) {
        return;
    }

    // Run immediately on startup (delayed 10s to let DB connect)
    setTimeout(async () => {
        await pruneExpiredTokens();
        await pruneExpiredRateLimits();
    }, 10_000);

    // Then every hour
    cleanupInterval = setInterval(async () => {
        await pruneExpiredTokens();
        await pruneExpiredRateLimits();
    }, 60 * 60 * 1000);

    // Allow process to exit even with interval running
    if (cleanupInterval && typeof cleanupInterval === 'object' && 'unref' in cleanupInterval) {
        cleanupInterval.unref();
    }

    logger.info('[TokenCleanup] Periodic cleanup started (every 1 hour)');
}

/**
 * Stop periodic cleanup (for graceful shutdown).
 */
export function stopPeriodicCleanup(): void {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
    }
}
