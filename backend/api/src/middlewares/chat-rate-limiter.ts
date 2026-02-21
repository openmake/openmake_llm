/**
 * 채팅 요청 레이트 리미터
 * 사용자 역할/등급에 따른 일일 채팅 횟수 제한
 *
 * Write-through cache pattern: PostgreSQL을 primary store로 사용하고,
 * in-memory Map을 hot read cache로 유지합니다.
 * - Express 미들웨어(chatRateLimiter): 동기 — 캐시에서 읽고, DB 쓰기는 fire-and-forget
 * - WebSocket 함수(checkChatRateLimit): 비동기 — DB 읽기/쓰기를 await
 * - DB 장애 시 캐시 전용 모드로 자동 폴백
 */

import { Request, Response, NextFunction } from 'express';
import { getPool } from '../data/models/unified-database';

interface RateLimitEntry {
    count: number;
    resetAt: number;
}

// In-memory cache (hot reads, synced with DB)
const rateLimitCache = new Map<string, RateLimitEntry>();
const CLEANUP_INTERVAL_MS = 60_000;
const MAX_ENTRIES = 10000;

// ===== DB operations =====

async function loadFromDB(key: string): Promise<RateLimitEntry | null> {
    try {
        const pool = getPool();
        const result = await pool.query(
            'SELECT count, reset_at FROM chat_rate_limits WHERE user_key = $1 AND reset_at > NOW()',
            [key]
        );
        if (result.rows.length > 0) {
            const row = result.rows[0] as { count: number; reset_at: string };
            return { count: row.count, resetAt: new Date(row.reset_at).getTime() };
        }
        return null;
    } catch {
        return null;
    }
}

async function saveToDB(key: string, entry: RateLimitEntry): Promise<void> {
    try {
        const pool = getPool();
        await pool.query(
            `INSERT INTO chat_rate_limits (user_key, count, reset_at, updated_at)
             VALUES ($1, $2, to_timestamp($3 / 1000.0), NOW())
             ON CONFLICT (user_key) DO UPDATE SET count = $2, reset_at = to_timestamp($3 / 1000.0), updated_at = NOW()`,
            [key, entry.count, entry.resetAt]
        );
    } catch {
        // fall back to cache-only
    }
}

async function cleanupDB(): Promise<void> {
    try {
        const pool = getPool();
        await pool.query('DELETE FROM chat_rate_limits WHERE reset_at <= NOW()');
    } catch {
        // ignore
    }
}

// ===== Cache management =====

function removeExpiredEntries(now: number): void {
    for (const [key, entry] of rateLimitCache) {
        if (now >= entry.resetAt) {
            rateLimitCache.delete(key);
        }
    }
}

function dropOldestEntries(entriesToDrop: number): void {
    if (entriesToDrop <= 0) {
        return;
    }

    let dropped = 0;
    for (const key of rateLimitCache.keys()) {
        rateLimitCache.delete(key);
        dropped++;

        if (dropped >= entriesToDrop) {
            break;
        }
    }
}

function cleanupRateLimitStore(now: number = Date.now()): void {
    removeExpiredEntries(now);

    if (rateLimitCache.size <= MAX_ENTRIES) {
        return;
    }

    dropOldestEntries(rateLimitCache.size - MAX_ENTRIES);
}

const chatRateLimitCleanupInterval = setInterval(() => {
    cleanupRateLimitStore();
    // Also purge expired rows from DB
    cleanupDB().catch(() => { /* ignore */ });
}, CLEANUP_INTERVAL_MS);

if (
    typeof chatRateLimitCleanupInterval === 'object'
    && chatRateLimitCleanupInterval !== null
    && 'unref' in chatRateLimitCleanupInterval
    && typeof chatRateLimitCleanupInterval.unref === 'function'
) {
    chatRateLimitCleanupInterval.unref();
}

/**
 * Graceful shutdown 시 채팅 레이트 리미터 cleanup interval을 중지합니다.
 */
export function stopChatRateLimitCleanup(): void {
    clearInterval(chatRateLimitCleanupInterval);
}

// 역할/등급별 일일 제한
const DAILY_LIMITS: Record<string, number> = {
    admin: Infinity,
    enterprise: Infinity,
    pro: 1000,
    free: 100,
    user: 100,
    guest: 20
};

function getNextMidnightUTC(): number {
    const now = new Date();
    const tomorrow = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1
    ));
    return tomorrow.getTime();
}

function getDailyLimit(role: string, tier?: string): number {
    if (role === 'admin') return Infinity;
    if (tier === 'enterprise') return Infinity;
    if (tier && DAILY_LIMITS[tier] !== undefined) return DAILY_LIMITS[tier];
    return DAILY_LIMITS[role] || DAILY_LIMITS['guest'];
}

/**
 * Express 미들웨어: 채팅 레이트 리미터
 * 동기 함수 — 캐시에서 읽고, DB 쓰기는 fire-and-forget
 */
export function chatRateLimiter(req: Request, res: Response, next: NextFunction): void {
    const user = req.user;
    const key = user
        ? ('userId' in user ? String(user.userId) : String(user.id))
        : (req.ip || 'unknown');

    const role = user?.role || 'guest';
    const tier = (user && 'tier' in user) ? (user.tier as string) : undefined;
    const limit = getDailyLimit(role, tier);

    if (limit === Infinity) {
        next();
        return;
    }

    const now = Date.now();
    let entry = rateLimitCache.get(key);

    if (!entry || now >= entry.resetAt) {
        entry = { count: 0, resetAt: getNextMidnightUTC() };
        rateLimitCache.set(key, entry);

        if (rateLimitCache.size > MAX_ENTRIES) {
            cleanupRateLimitStore(now);
        }

        // Fire async DB load to warm cache for next request (don't block)
        loadFromDB(key).then(dbEntry => {
            if (dbEntry && dbEntry.resetAt > Date.now()) {
                const cached = rateLimitCache.get(key);
                // Only update if cache entry is still the one we just created
                if (cached && cached.count <= 1) {
                    cached.count = Math.max(cached.count, dbEntry.count);
                    cached.resetAt = dbEntry.resetAt;
                }
            }
        }).catch(() => { /* ignore */ });
    }

    entry.count++;

    // Fire-and-forget DB write
    saveToDB(key, entry).catch(() => { /* ignore */ });

    if (entry.count > limit) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        res.setHeader('Retry-After', String(retryAfter));
        res.setHeader('X-RateLimit-Limit', String(limit));
        res.setHeader('X-RateLimit-Remaining', '0');
        res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
        res.status(429).json({
            success: false,
            error: {
                message: '일일 채팅 제한을 초과했습니다',
                limit,
                retryAfterSeconds: retryAfter
            }
        });
        return;
    }

    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - entry.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
    next();
}

/**
 * WebSocket용 레이트 체크 함수 (비동기 — DB 읽기/쓰기를 await)
 * @returns null if allowed, error message string if rate limited
 */
export async function checkChatRateLimit(
    userId: string | null,
    role: string,
    tier?: string
): Promise<string | null> {
    const key = userId || 'ws-anonymous';
    const limit = getDailyLimit(role, tier);

    if (limit === Infinity) return null;

    const now = Date.now();
    let entry = rateLimitCache.get(key);

    if (!entry || now >= entry.resetAt) {
        // Try loading from DB first
        const dbEntry = await loadFromDB(key);
        if (dbEntry && dbEntry.resetAt > now) {
            entry = dbEntry;
            rateLimitCache.set(key, entry);
        } else {
            entry = { count: 0, resetAt: getNextMidnightUTC() };
            rateLimitCache.set(key, entry);
        }

        if (rateLimitCache.size > MAX_ENTRIES) {
            cleanupRateLimitStore(now);
        }
    }

    entry.count++;

    // Await DB write for WebSocket path
    await saveToDB(key, entry);

    if (entry.count > limit) {
        return `일일 채팅 제한 초과 (${limit}회/일)`;
    }

    return null;
}
