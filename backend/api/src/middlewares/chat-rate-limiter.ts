/**
 * 채팅 요청 레이트 리미터
 * 사용자 역할/등급에 따른 일일 채팅 횟수 제한
 *
 * Note: In-memory store는 단일 프로세스 한정. 클러스터 환경에서는 Redis 등 외부 저장소 도입 필요
 */

import { Request, Response, NextFunction } from 'express';

interface RateLimitEntry {
    count: number;
    resetAt: number;
}

// In-memory store
const rateLimitStore = new Map<string, RateLimitEntry>();
const CLEANUP_INTERVAL_MS = 60_000;
const MAX_ENTRIES = 10000;

function removeExpiredEntries(now: number): void {
    for (const [key, entry] of rateLimitStore) {
        if (now >= entry.resetAt) {
            rateLimitStore.delete(key);
        }
    }
}

function dropOldestEntries(entriesToDrop: number): void {
    if (entriesToDrop <= 0) {
        return;
    }

    let dropped = 0;
    for (const key of rateLimitStore.keys()) {
        rateLimitStore.delete(key);
        dropped++;

        if (dropped >= entriesToDrop) {
            break;
        }
    }
}

function cleanupRateLimitStore(now: number = Date.now()): void {
    removeExpiredEntries(now);

    if (rateLimitStore.size <= MAX_ENTRIES) {
        return;
    }

    dropOldestEntries(rateLimitStore.size - MAX_ENTRIES);
}

const chatRateLimitCleanupInterval = setInterval(() => {
    cleanupRateLimitStore();
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
    let entry = rateLimitStore.get(key);

    if (!entry || now >= entry.resetAt) {
        entry = { count: 0, resetAt: getNextMidnightUTC() };
        rateLimitStore.set(key, entry);

        if (rateLimitStore.size > MAX_ENTRIES) {
            cleanupRateLimitStore(now);
        }
    }

    entry.count++;

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
 * WebSocket용 레이트 체크 함수
 * @returns null if allowed, error message string if rate limited
 */
export function checkChatRateLimit(
    userId: string | null,
    role: string,
    tier?: string
): string | null {
    const key = userId || 'ws-anonymous';
    const limit = getDailyLimit(role, tier);

    if (limit === Infinity) return null;

    const now = Date.now();
    let entry = rateLimitStore.get(key);

    if (!entry || now >= entry.resetAt) {
        entry = { count: 0, resetAt: getNextMidnightUTC() };
        rateLimitStore.set(key, entry);

        if (rateLimitStore.size > MAX_ENTRIES) {
            cleanupRateLimitStore(now);
        }
    }

    entry.count++;

    if (entry.count > limit) {
        return `일일 채팅 제한 초과 (${limit}회/일)`;
    }

    return null;
}
