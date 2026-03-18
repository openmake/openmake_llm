/**
 * 🆕 공통 미들웨어
 * 인증, 레이트 리미팅, 로깅
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createLogger } from '../utils/logger';
// QuotaExceededError는 utils/error-handler.ts에서 통합 처리
import { getConfig } from '../config';
import { getAnalyticsSystem } from '../monitoring/analytics';
// AuthUser 타입은 auth/middleware.ts에서 정의됨
import { AuthUser } from '../auth/middleware';
import { unauthorized, forbidden, internalError, rateLimited } from '../utils/api-response';

const logger = createLogger('Middleware');
let authMiddlewareWarned = false;

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

function createAdvancedRateLimiter(options: AdvancedRateLimiterOptions) {
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
// 인증 미들웨어
// ================================================

/**
 * JWT 토큰 검증 미들웨어
 * @deprecated This middleware only verifies JWT and does not validate user activity state. Use requireAuth from ../auth/middleware.ts instead.
 */
export function authMiddleware(required: boolean = true) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!authMiddlewareWarned) {
            logger.warn('[DEPRECATED] authMiddleware does not verify user.is_active. Use requireAuth from auth/middleware.ts instead.');
            authMiddlewareWarned = true;
        }

        const authHeader = req.headers.authorization;

        // Cookie first (httpOnly), then Authorization header (backward compat)
        const token = req.cookies?.auth_token ||
                      (authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined);

        if (!token) {
            if (required) {
                return res.status(401).json(unauthorized('인증이 필요합니다.'));
            }
            return next();
        }
        const jwtSecret = getConfig().jwtSecret;

        // JWT_SECRET 미설정 시 보안 오류
        if (!jwtSecret) {
            logger.error('JWT_SECRET 환경변수가 설정되지 않았습니다!');
            return res.status(500).json(internalError('서버 인증 설정 오류'));
        }

        try {
            const decoded = jwt.verify(token, jwtSecret) as AuthUser;
            req.user = decoded;
            next();
        } catch (error) {
            if (required) {
                return res.status(401).json(unauthorized('유효하지 않은 토큰입니다.'));
            }
            next();
        }
    };
}

/**
 * 관리자 권한 확인 미들웨어
 */
export function adminMiddleware(req: Request, res: Response, next: NextFunction) {
    const user = req.user;
    if (!user || user.role !== 'admin') {
        return res.status(403).json(forbidden('관리자 권한이 필요합니다.'));
    }
    next();
}

// ================================================
// 레이트 리미팅 미들웨어
// ================================================

/**
 * 일반 API 레이트 리미터
 */
export const generalLimiter = createAdvancedRateLimiter({
    windowMs: 15 * 60 * 1000,
    ipLimit: 100,
    userLimit: 200,
    endpointRules: [
        { path: /^POST:\/api\/chat(?:\/|$)/, limit: 60 },
        { path: /^POST:\/api\/chat\/stream(?:\/|$)/, limit: 40 },
        { path: /^POST:\/api\/research(?:\/|$)/, limit: 15 },
        { path: /^POST:\/api\/documents\/upload(?:\/|$)/, limit: 25 },
    ],
    message: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});

/**
 * 인증 관련 레이트 리미터
 */
export const authLimiter = createAdvancedRateLimiter({
    windowMs: 15 * 60 * 1000,
    ipLimit: 500, // SPA가 페이지 이동마다 /auth/me + /auth/providers 호출 — 개별 엔드포인트 제한이 실제 방어선
    endpointRules: [
        { path: /^GET:\/api\/auth\/me(?:\/|$)/, limit: 200 }, // 세션 확인 — 비용 낮음
        { path: /^GET:\/api\/auth\/providers(?:\/|$)/, limit: 500 }, // 공개 설정 엔드포인트 — 높은 한도
        { path: /^POST:\/api\/auth\/login(?:\/|$)/, limit: 8 },
        { path: /^POST:\/api\/auth\/register(?:\/|$)/, limit: 6 },
    ],
    message: '로그인 시도가 너무 많습니다.',
});

/**
 * 채팅 API 레이트 리미터
 */
export const chatLimiter = createAdvancedRateLimiter({
    windowMs: 60 * 1000,
    ipLimit: 30,
    userLimit: 45,
    endpointRules: [
        { path: /^POST:\/api\/chat\/stream(?:\/|$)/, limit: 20 },
        { path: /^POST:\/api\/chat(?:\/|$)/, limit: 30 },
    ],
    message: '채팅 요청이 너무 많습니다.',
});

/**
 * Research API 레이트 리미터 (LLM 멀티스텝 호출 — 비용 높음)
 */
export const researchLimiter = createAdvancedRateLimiter({
    windowMs: 15 * 60 * 1000,
    ipLimit: 10,
    userLimit: 15,
    endpointRules: [
        { path: /^POST:\/api\/research(?:\/|$)/, limit: 10 },
        { path: /^POST:\/api\/research\/deep(?:\/|$)/, limit: 6 },
    ],
    message: 'Research 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});

/**
 * 대용량 업로드 (OCR/PDF) 레이트 리미터
 */
export const uploadLimiter = createAdvancedRateLimiter({
    windowMs: 15 * 60 * 1000,
    ipLimit: 20,
    userLimit: 30,
    endpointRules: [
        { path: /^POST:\/api\/documents\/upload(?:\/|$)/, limit: 20 },
    ],
    message: '업로드 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});

/**
 * 웹 검색 레이트 리미터 (외부 검색 API 호출 — 비용 높음)
 */
export const webSearchLimiter = createAdvancedRateLimiter({
    windowMs: 60 * 1000,
    ipLimit: 5,
    userLimit: 10,
    endpointRules: [
        { path: /^POST:.*\/web-search(?:\/|$)/, limit: 5 },
    ],
    message: '웹 검색 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});

/**
 * 메모리 API 레이트 리미터 (DB 중심 메모리 CRUD)
 */
export const memoryLimiter = createAdvancedRateLimiter({
    windowMs: 15 * 60 * 1000,
    ipLimit: 50,
    userLimit: 100,
    endpointRules: [
        { path: /^POST:.*\/memory(?:\/|$)/, limit: 30 },
        { path: /^DELETE:.*\/memory(?:\/|$)/, limit: 20 },
    ],
    message: '메모리 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});


/**
 * MCP 레이트 리미터 (MCP 도구 호출 — AI 비용 높음)
 */
export const mcpLimiter = createAdvancedRateLimiter({
    windowMs: 15 * 60 * 1000,
    ipLimit: 20,
    userLimit: 40,
    endpointRules: [
        { path: /^POST:.*\/mcp(?:\/|$)/, limit: 20 },
        { path: /^POST:.*\/mcp\/tools\/call(?:\/|$)/, limit: 10 },
    ],
    message: 'MCP 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});

/**
 * API 키 관리 레이트 리미터 (API Key CRUD — 스크래핑 방지)
 */
export const apiKeyManagementLimiter = createAdvancedRateLimiter({
    windowMs: 15 * 60 * 1000,
    ipLimit: 20,
    userLimit: 30,
    endpointRules: [
        { path: /^POST:.*\/api-keys(?:\/|$)/, limit: 10 },
        { path: /^DELETE:.*\/api-keys(?:\/|$)/, limit: 10 },
    ],
    message: 'API 키 관리 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});

/**
 * 푸시 알림 레이트 리미터 (구독/발송 제한)
 */
export const pushLimiter = createAdvancedRateLimiter({
    windowMs: 15 * 60 * 1000,
    ipLimit: 15,
    userLimit: 30,
    endpointRules: [
        { path: /^POST:.*\/push\/subscribe(?:\/|$)/, limit: 5 },
    ],
    message: '푸시 알림 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});

// ================================================
// 로깅 미들웨어
// ================================================

/**
 * 요청 로깅 미들웨어
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        const logLevel = res.statusCode >= 400 ? 'warn' : 'debug';

        logger[logLevel](`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    });

    next();
}

/**
 * 에러 로깅 미들웨어
 */
export function errorLogger(err: Error, req: Request, res: Response, next: NextFunction) {
    logger.error(`Error: ${err.message}`, {
        stack: err.stack,
        path: req.path,
        method: req.method
    });
    next(err);
}

// ================================================
// 분석 미들웨어
// ================================================

/**
 * 분석 데이터 수집 미들웨어
 */
export function analyticsMiddleware(req: Request, res: Response, next: NextFunction) {
    const analytics = getAnalyticsSystem();

    // 쿼리 기록 (채팅 API)
    if (req.path.includes('/chat') && (req.body as Record<string, unknown>)?.message) {
        analytics.recordQuery((req.body as Record<string, unknown>).message as string);
    }

    next();
}

// ================================================
// ⚙️ Phase 3: 에러 핸들러 & API 응답 표준화
// ================================================
// globalErrorHandler, successResponse, errorResponse, extendResponse 제거됨 (2026-02-07)
// → 에러 핸들링: utils/error-handler.ts의 errorHandler 단일 사용
// → API 응답: utils/api-response.ts의 success(), error() 등 단일 사용
// 하위 호환을 위해 ApiResponse 타입은 utils/api-response.ts에서 가져올 것

// ================================================
// CORS 미들웨어
// ================================================

/**
 * 🔒 CORS 설정 (화이트리스트 기반)
 * - 와일드카드(*) 사용 금지
 * - 환경변수 CORS_ORIGINS에서 허용 도메인 로드
 * - server.ts의 CORS 설정과 일관성 유지
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
    const allowedOrigins = getConfig().corsOrigins.split(',').map(o => o.trim());
    const origin = req.headers.origin;
    
    // 🔒 화이트리스트 기반 Origin 검증
    if (origin && allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
    }
    
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-API-Key');
    res.header('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }

    next();
}

// ================================================
// 🆕 Error Handler Utilities (Re-exports)
// ================================================

// Re-export error handler utilities
export {
    AppError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    RateLimitError,
    DatabaseError,
    errorHandler,
    asyncHandler,
    notFoundHandler
} from '../utils/error-handler';
