/**
 * 레이트 리미팅 미들웨어
 * Sliding Window Counter 기반 고급 레이트 리미터
 */

import { Request, Response, NextFunction } from 'express';
import { rateLimited } from '../utils/api-response';
import {
    RL_GENERAL, RL_AUTH, RL_CHAT, RL_RESEARCH, RL_UPLOAD,
    RL_WEB_SEARCH, RL_MEMORY, RL_MCP, RL_API_KEY_MGMT, RL_PUSH
} from '../config/rate-limits';

// ================================================
// 타입 정의
// ================================================

interface SlidingWindowCounter {
    currentWindowStart: number;
    currentCount: number;
    previousWindowStart: number;
    previousCount: number;
}

interface EndpointRule {
    path: RegExp;
    limit: number;
}

interface AdvancedRateLimiterOptions {
    windowMs: number;
    ipLimit: number;
    userLimit?: number;
    endpointRules?: EndpointRule[];
    message: string;
}

interface RateLimitDecision {
    allowed: boolean;
    retryAfterSeconds: number;
    activeLimit: number;
    remaining: number;
    resetAtMs: number;
}

// ================================================
// 내부 상태 및 유틸리티
// ================================================

const DEFAULT_LIMITER_MAX_ENTRIES = 20000;
const advancedLimiterCounters = new Map<string, SlidingWindowCounter>();
const advancedLimiterCleanupIntervalMs = 60_000;

function getRequestIP(req: Request): string {
    return req.ip || 'unknown';
}

function getUserKey(req: Request): string | null {
    const user = req.user;
    if (!user) {
        return null;
    }

    if ('userId' in user && user.userId) {
        return String(user.userId);
    }

    if ('id' in user && user.id !== undefined && user.id !== null) {
        return String(user.id);
    }

    return null;
}

function isAdminUser(req: Request): boolean {
    const user = req.user;
    return Boolean(user && user.role === 'admin');
}

function getEndpointKey(req: Request): string {
    return `${req.method.toUpperCase()}:${req.baseUrl || ''}${req.path || ''}`;
}

function getEndpointSpecificLimit(endpointRules: EndpointRule[] | undefined, req: Request): number | null {
    if (!endpointRules || endpointRules.length === 0) {
        return null;
    }

    const endpointKey = getEndpointKey(req);
    const matchedRule = endpointRules.find((rule) => rule.path.test(endpointKey));
    return matchedRule ? matchedRule.limit : null;
}

function getWindowStart(now: number, windowMs: number): number {
    return now - (now % windowMs);
}

function getOrCreateCounter(key: string, windowMs: number, now: number): SlidingWindowCounter {
    const windowStart = getWindowStart(now, windowMs);
    const existing = advancedLimiterCounters.get(key);

    if (!existing) {
        const created: SlidingWindowCounter = {
            currentWindowStart: windowStart,
            currentCount: 0,
            previousWindowStart: windowStart - windowMs,
            previousCount: 0,
        };
        advancedLimiterCounters.set(key, created);
        return created;
    }

    if (existing.currentWindowStart === windowStart) {
        return existing;
    }

    if (existing.currentWindowStart === (windowStart - windowMs)) {
        existing.previousWindowStart = existing.currentWindowStart;
        existing.previousCount = existing.currentCount;
        existing.currentWindowStart = windowStart;
        existing.currentCount = 0;
        return existing;
    }

    existing.previousWindowStart = windowStart - windowMs;
    existing.previousCount = 0;
    existing.currentWindowStart = windowStart;
    existing.currentCount = 0;
    return existing;
}

function calculateSlidingWindowUsage(counter: SlidingWindowCounter, now: number, windowMs: number): number {
    const elapsedInWindow = now - counter.currentWindowStart;
    const weight = Math.max(0, Math.min(1, (windowMs - elapsedInWindow) / windowMs));
    return counter.currentCount + (counter.previousCount * weight);
}

function evaluateAndIncrement(
    counterKey: string,
    limit: number,
    windowMs: number,
    now: number
): RateLimitDecision {
    const counter = getOrCreateCounter(counterKey, windowMs, now);
    const currentUsage = calculateSlidingWindowUsage(counter, now, windowMs);

    if ((currentUsage + 1) > limit) {
        const resetAtMs = counter.currentWindowStart + windowMs;
        const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - now) / 1000));

        return {
            allowed: false,
            retryAfterSeconds,
            activeLimit: limit,
            remaining: 0,
            resetAtMs,
        };
    }

    counter.currentCount += 1;
    const updatedUsage = calculateSlidingWindowUsage(counter, now, windowMs);
    const remaining = Math.max(0, Math.floor(limit - updatedUsage));

    return {
        allowed: true,
        retryAfterSeconds: 0,
        activeLimit: limit,
        remaining,
        resetAtMs: counter.currentWindowStart + windowMs,
    };
}

function cleanupAdvancedLimiterStore(now: number = Date.now()): void {
    for (const [key, counter] of advancedLimiterCounters) {
        const staleFor = now - counter.currentWindowStart;
        if (staleFor > (2 * 60 * 60 * 1000)) {
            advancedLimiterCounters.delete(key);
        }
    }

    if (advancedLimiterCounters.size <= DEFAULT_LIMITER_MAX_ENTRIES) {
        return;
    }

    const entriesToDrop = advancedLimiterCounters.size - DEFAULT_LIMITER_MAX_ENTRIES;
    let dropped = 0;

    for (const key of advancedLimiterCounters.keys()) {
        advancedLimiterCounters.delete(key);
        dropped += 1;

        if (dropped >= entriesToDrop) {
            break;
        }
    }
}

const advancedLimiterCleanupInterval = setInterval(() => {
    cleanupAdvancedLimiterStore();
}, advancedLimiterCleanupIntervalMs);

if (
    typeof advancedLimiterCleanupInterval === 'object'
    && advancedLimiterCleanupInterval !== null
    && 'unref' in advancedLimiterCleanupInterval
    && typeof advancedLimiterCleanupInterval.unref === 'function'
) {
    advancedLimiterCleanupInterval.unref();
}

// ================================================
// createAdvancedRateLimiter
// ================================================

export function createAdvancedRateLimiter(options: AdvancedRateLimiterOptions) {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (isAdminUser(req)) {
            next();
            return;
        }

        const now = Date.now();
        const ip = getRequestIP(req);
        const userKey = getUserKey(req);
        const actorKey = userKey ? `user:${userKey}` : `ip:${ip}`;

        const endpointSpecificLimit = getEndpointSpecificLimit(options.endpointRules, req);
        const perEndpointLimit = endpointSpecificLimit ?? options.ipLimit;

        const dimensions: Array<{ key: string; limit: number }> = [
            { key: `ip:${ip}`, limit: options.ipLimit },
            { key: `endpoint:${actorKey}:${getEndpointKey(req)}`, limit: perEndpointLimit },
        ];

        if (userKey && options.userLimit !== undefined) {
            dimensions.push({ key: `user:${userKey}`, limit: options.userLimit });
        }

        let strictestResult: RateLimitDecision | null = null;

        for (const dimension of dimensions) {
            const result = evaluateAndIncrement(
                `${dimension.key}:${options.windowMs}`,
                dimension.limit,
                options.windowMs,
                now
            );

            if (!strictestResult || result.remaining < strictestResult.remaining) {
                strictestResult = result;
            }

            if (!result.allowed) {
                res.setHeader('Retry-After', String(result.retryAfterSeconds));
                res.setHeader('X-RateLimit-Limit', String(result.activeLimit));
                res.setHeader('X-RateLimit-Remaining', '0');
                res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAtMs / 1000)));
                res.status(429).json(rateLimited(options.message));
                return;
            }
        }

        if (strictestResult) {
            res.setHeader('X-RateLimit-Limit', String(strictestResult.activeLimit));
            res.setHeader('X-RateLimit-Remaining', String(strictestResult.remaining));
            res.setHeader('X-RateLimit-Reset', String(Math.ceil(strictestResult.resetAtMs / 1000)));
        }

        next();
    };
}

// ================================================
// 레이트 리미터 인스턴스
// ================================================

/**
 * 일반 API 레이트 리미터
 */
export const generalLimiter = createAdvancedRateLimiter({
    windowMs: RL_GENERAL.windowMs,
    ipLimit: RL_GENERAL.ipLimit,
    userLimit: RL_GENERAL.userLimit,
    endpointRules: [
        { path: /^POST:\/api\/chat(?:\/|$)/, limit: RL_GENERAL.chatLimit },
        { path: /^POST:\/api\/chat\/stream(?:\/|$)/, limit: RL_GENERAL.chatStreamLimit },
        { path: /^POST:\/api\/research(?:\/|$)/, limit: RL_GENERAL.researchLimit },
        { path: /^POST:\/api\/documents\/upload(?:\/|$)/, limit: RL_GENERAL.uploadLimit },
    ],
    message: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});

/**
 * 인증 관련 레이트 리미터
 */
export const authLimiter = createAdvancedRateLimiter({
    windowMs: RL_AUTH.windowMs,
    ipLimit: RL_AUTH.ipLimit,
    endpointRules: [
        { path: /^GET:\/api\/auth\/me(?:\/|$)/, limit: RL_AUTH.meLimit },
        { path: /^GET:\/api\/auth\/providers(?:\/|$)/, limit: RL_AUTH.providersLimit },
        { path: /^POST:\/api\/auth\/login(?:\/|$)/, limit: RL_AUTH.loginLimit },
        { path: /^POST:\/api\/auth\/register(?:\/|$)/, limit: RL_AUTH.registerLimit },
    ],
    message: '로그인 시도가 너무 많습니다.',
});

/**
 * 채팅 API 레이트 리미터
 */
export const chatLimiter = createAdvancedRateLimiter({
    windowMs: RL_CHAT.windowMs,
    ipLimit: RL_CHAT.ipLimit,
    userLimit: RL_CHAT.userLimit,
    endpointRules: [
        { path: /^POST:\/api\/chat\/stream(?:\/|$)/, limit: RL_CHAT.streamLimit },
        { path: /^POST:\/api\/chat(?:\/|$)/, limit: RL_CHAT.chatLimit },
    ],
    message: '채팅 요청이 너무 많습니다.',
});

/**
 * Research API 레이트 리미터 (LLM 멀티스텝 호출 -- 비용 높음)
 */
export const researchLimiter = createAdvancedRateLimiter({
    windowMs: RL_RESEARCH.windowMs,
    ipLimit: RL_RESEARCH.ipLimit,
    userLimit: RL_RESEARCH.userLimit,
    endpointRules: [
        { path: /^POST:\/api\/research(?:\/|$)/, limit: RL_RESEARCH.researchLimit },
        { path: /^POST:\/api\/research\/deep(?:\/|$)/, limit: RL_RESEARCH.deepLimit },
    ],
    message: 'Research 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});

/**
 * 대용량 업로드 (OCR/PDF) 레이트 리미터
 */
export const uploadLimiter = createAdvancedRateLimiter({
    windowMs: RL_UPLOAD.windowMs,
    ipLimit: RL_UPLOAD.ipLimit,
    userLimit: RL_UPLOAD.userLimit,
    endpointRules: [
        { path: /^POST:\/api\/documents\/upload(?:\/|$)/, limit: RL_UPLOAD.uploadLimit },
    ],
    message: '업로드 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});

/**
 * 웹 검색 레이트 리미터 (외부 검색 API 호출 -- 비용 높음)
 */
export const webSearchLimiter = createAdvancedRateLimiter({
    windowMs: RL_WEB_SEARCH.windowMs,
    ipLimit: RL_WEB_SEARCH.ipLimit,
    userLimit: RL_WEB_SEARCH.userLimit,
    endpointRules: [
        { path: /^POST:.*\/web-search(?:\/|$)/, limit: RL_WEB_SEARCH.searchLimit },
    ],
    message: '웹 검색 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});

/**
 * 메모리 API 레이트 리미터 (DB 중심 메모리 CRUD)
 */
export const memoryLimiter = createAdvancedRateLimiter({
    windowMs: RL_MEMORY.windowMs,
    ipLimit: RL_MEMORY.ipLimit,
    userLimit: RL_MEMORY.userLimit,
    endpointRules: [
        { path: /^POST:.*\/memory(?:\/|$)/, limit: RL_MEMORY.createLimit },
        { path: /^DELETE:.*\/memory(?:\/|$)/, limit: RL_MEMORY.deleteLimit },
    ],
    message: '메모리 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});

/**
 * MCP 레이트 리미터 (MCP 도구 호출 -- AI 비용 높음)
 */
export const mcpLimiter = createAdvancedRateLimiter({
    windowMs: RL_MCP.windowMs,
    ipLimit: RL_MCP.ipLimit,
    userLimit: RL_MCP.userLimit,
    endpointRules: [
        { path: /^POST:.*\/mcp(?:\/|$)/, limit: RL_MCP.mcpLimit },
        { path: /^POST:.*\/mcp\/tools\/call(?:\/|$)/, limit: RL_MCP.toolCallLimit },
    ],
    message: 'MCP 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});

/**
 * API 키 관리 레이트 리미터 (API Key CRUD -- 스크래핑 방지)
 */
export const apiKeyManagementLimiter = createAdvancedRateLimiter({
    windowMs: RL_API_KEY_MGMT.windowMs,
    ipLimit: RL_API_KEY_MGMT.ipLimit,
    userLimit: RL_API_KEY_MGMT.userLimit,
    endpointRules: [
        { path: /^POST:.*\/api-keys(?:\/|$)/, limit: RL_API_KEY_MGMT.createLimit },
        { path: /^DELETE:.*\/api-keys(?:\/|$)/, limit: RL_API_KEY_MGMT.deleteLimit },
    ],
    message: 'API 키 관리 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});

/**
 * 푸시 알림 레이트 리미터 (구독/발송 제한)
 */
export const pushLimiter = createAdvancedRateLimiter({
    windowMs: RL_PUSH.windowMs,
    ipLimit: RL_PUSH.ipLimit,
    userLimit: RL_PUSH.userLimit,
    endpointRules: [
        { path: /^POST:.*\/push\/subscribe(?:\/|$)/, limit: RL_PUSH.subscribeLimit },
    ],
    message: '푸시 알림 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});
