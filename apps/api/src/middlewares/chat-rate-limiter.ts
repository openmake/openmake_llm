/**
 * 채팅 요청 레이트 리미터
 * 사용자 역할에 따른 일일 채팅 횟수 제한 (남용 방지)
 *
 * Write-through cache pattern: PostgreSQL을 primary store로 사용하고,
 * in-memory Map을 hot read cache로 유지합니다.
 * - Express 미들웨어(chatRateLimiter): 동기 — 캐시에서 읽고, DB 쓰기는 fire-and-forget
 * - WebSocket 함수(checkChatRateLimit): 비동기 — DB 읽기/쓰기를 await
 * - DB 장애 시 캐시 전용 모드로 자동 폴백
 */

import { Request, Response, NextFunction } from 'express';
import { getPool } from '../data/models/unified-database';
import { isAdminRole } from '../data/user-manager';
import { createLogger } from '../utils/logger';

const logger = createLogger('ChatRateLimiter');

interface RateLimitEntry {
    count: number;
    resetAt: number;
}

// In-memory cache (hot reads, synced with DB)
const rateLimitCache = new Map<string, RateLimitEntry>();
const CLEANUP_INTERVAL_MS = 60_000;
const MAX_ENTRIES = Number(process.env.CHAT_RATE_LIMIT_CACHE_MAX) || 10000;

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

// 역할별 일일 제한 (남용 방지 — 구독 등급과 무관)
const DAILY_LIMITS: Record<string, number> = {
    admin: Infinity,
    user: Number(process.env.CHAT_DAILY_LIMIT_USER) || 100,
    guest: Number(process.env.CHAT_DAILY_LIMIT_GUEST) || 20
};

/** 일일 한도 초기화 기준 TZ 기본값 — 서비스 대상이 한국 사용자라 UTC 자정(한국 09:00)이 아닌 한국 자정 */
const DEFAULT_RESET_TZ = 'Asia/Seoul';

/** timeZone 기준 t 시점의 벽시계 시각을 UTC 로 읽은 값과 t 의 차이(ms) = 그 시점의 UTC 오프셋 */
function getTimeZoneOffsetMs(t: number, fmt: Intl.DateTimeFormat): number {
    const p: Record<string, number> = {};
    for (const part of fmt.formatToParts(t)) {
        if (part.type !== 'literal') p[part.type] = Number(part.value);
    }
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}

/**
 * 일일 채팅 한도가 초기화될 다음 자정(epoch ms).
 * 기준 TZ 는 CHAT_DAILY_RESET_TZ(IANA, 기본 Asia/Seoul). 잘못된 TZ 면 경고 후 UTC 자정으로 폴백.
 * 외부 라이브러리 없이 Intl 로 그 TZ 의 오늘 날짜를 얻고, 내일 00:00 벽시계 시각을 오프셋으로 epoch 로 바꾼다
 * (DST 가 있는 TZ 도 맞도록 오프셋을 내일 자정 근처에서 다시 잰다).
 */
export function getNextResetMidnight(
    nowMs: number = Date.now(),
    timeZone: string = process.env.CHAT_DAILY_RESET_TZ || DEFAULT_RESET_TZ,
): number {
    let fmt: Intl.DateTimeFormat;
    try {
        fmt = new Intl.DateTimeFormat('en-US', {
            timeZone, hourCycle: 'h23',
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: 'numeric', minute: 'numeric', second: 'numeric',
        });
    } catch {
        logger.warn(`CHAT_DAILY_RESET_TZ 값이 올바른 IANA 시간대가 아님(${timeZone}) — UTC 자정으로 폴백`);
        const now = new Date(nowMs);
        return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    }
    // 그 TZ 의 오늘 날짜 → 내일 00:00 벽시계 시각(UTC 로 표기한 값)
    const wall = new Date(nowMs + getTimeZoneOffsetMs(nowMs, fmt));
    const tomorrowWall = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + 1);
    // 벽시계 → epoch: 오프셋을 한 번 어림한 뒤 그 시점의 오프셋으로 다시 맞춘다(DST 경계 대비)
    const guess = tomorrowWall - getTimeZoneOffsetMs(tomorrowWall, fmt);
    return tomorrowWall - getTimeZoneOffsetMs(guess, fmt);
}

function getDailyLimit(role: string): number {
    if (isAdminRole(role)) return Infinity;
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
    const limit = getDailyLimit(role);

    if (limit === Infinity) {
        next();
        return;
    }

    const now = Date.now();
    let entry = rateLimitCache.get(key);

    if (!entry || now >= entry.resetAt) {
        entry = { count: 0, resetAt: getNextResetMidnight() };
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
    anonSessionId?: string,
    clientIp?: string
): Promise<string | null> {
    const normalizedAnonSessionId = typeof anonSessionId === 'string' ? anonSessionId.trim() : '';
    const normalizedIp = typeof clientIp === 'string' ? clientIp.trim() : '';
    // 게스트 키는 IP 를 우선한다 — anonSessionId 는 클라이언트가 생성/회전할 수 있어 일일 한도를
    // 리셋하는 우회가 가능했다. IP 가 있으면 IP 로 묶어(회전해도 같은 IP 는 동일 버킷) 비용 남용을 막고,
    // IP 를 못 얻는 경우에만 기존 anonSessionId 기반으로 폴백한다.
    let anonKey: string;
    if (normalizedIp) {
        anonKey = `anon:ip:${normalizedIp}`;
    } else if (/^[a-zA-Z0-9_-]{8,128}$/.test(normalizedAnonSessionId)) {
        anonKey = `anon:${normalizedAnonSessionId}`;
    } else {
        anonKey = 'ws-anonymous';
    }
    const key = userId || anonKey;
    const limit = getDailyLimit(role);

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
            entry = { count: 0, resetAt: getNextResetMidnight() };
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
