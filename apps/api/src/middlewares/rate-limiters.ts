/**
 * 레이트 리미팅 미들웨어
 * Sliding Window Counter 기반 고급 레이트 리미터
 */

import { Request, Response, NextFunction } from 'express';
import { rateLimited } from '../utils/api-response';
import {
    RL_GENERAL, RL_AUTH, RL_CHAT, RL_RESEARCH, RL_UPLOAD,
    RL_WEB_SEARCH, RL_MEMORY, RL_MCP, RL_API_KEY_MGMT, RL_PUSH, RL_ADMIN
} from '../config/rate-limits';
import { getKeyValueStore } from '../storage';
import { STORAGE_POLICY, RATE_LIMIT_POLICY } from '../config/security';
import { ARTIFACT_EXEC } from '../config/artifact-exec';

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
    /** true 를 반환하면 이 요청은 카운트/차단하지 않고 통과 (예: 비용 리미터에서 read-only GET 제외) */
    skip?: (req: Request) => boolean;
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

/** Stage 2-H3 Phase 2: counter 키 네임스페이스 — STORAGE_POLICY 사용 */
function makeStorageKey(counterKey: string): string {
    return STORAGE_POLICY.KEY_PREFIX + STORAGE_POLICY.RATE_LIMIT_PREFIX + counterKey;
}

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

/**
 * Stage 2-H3 Phase 2: KeyValueStore에서 counter 로드 또는 생성.
 * 이전 버전의 in-place 갱신과 달리 매 호출마다 store.get → 메모리 객체 수정 → store.set 시퀀스로 동작.
 * 단일 프로세스(MemoryStore)에서는 기존 Map 동작과 동일 semantics.
 * Redis 전환 시 동시성은 incr 기반 재설계가 필요하며, 이는 Phase 4 과제.
 */
async function getOrCreateCounter(key: string, windowMs: number, now: number): Promise<SlidingWindowCounter> {
    const store = getKeyValueStore();
    const storageKey = makeStorageKey(key);
    const windowStart = getWindowStart(now, windowMs);
    const existing = await store.get<SlidingWindowCounter>(storageKey);

    if (!existing) {
        return {
            currentWindowStart: windowStart,
            currentCount: 0,
            previousWindowStart: windowStart - windowMs,
            previousCount: 0,
        };
    }

    if (existing.currentWindowStart === windowStart) {
        return existing;
    }

    if (existing.currentWindowStart === (windowStart - windowMs)) {
        return {
            previousWindowStart: existing.currentWindowStart,
            previousCount: existing.currentCount,
            currentWindowStart: windowStart,
            currentCount: 0,
        };
    }

    return {
        previousWindowStart: windowStart - windowMs,
        previousCount: 0,
        currentWindowStart: windowStart,
        currentCount: 0,
    };
}

function calculateSlidingWindowUsage(counter: SlidingWindowCounter, now: number, windowMs: number): number {
    const elapsedInWindow = now - counter.currentWindowStart;
    const weight = Math.max(0, Math.min(1, (windowMs - elapsedInWindow) / windowMs));
    return counter.currentCount + (counter.previousCount * weight);
}

/**
 * bug_006: key별 promise chain으로 read-modify-write를 직렬화.
 * MemoryStore 기반 async get/set 사이에 event-loop yield가 생기면서 동일 키에
 * 대한 동시 요청이 같은 pre-increment 값을 읽고 각자 +1로 쓰는 lost-update 경합이
 * 발생했다. 키마다 이전 작업이 끝날 때까지 대기시켜 atomic 증분 semantics 복원.
 *
 * Phase 4(Redis) 전환 시에는 Lua 스크립트 또는 INCR 기반 atomic primitive가 더 적합.
 */
const keyLocks = new Map<string, Promise<unknown>>();

async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = keyLocks.get(key) ?? Promise.resolve();
    const next: Promise<T> = prev.then(fn, fn);
    const tracked: Promise<unknown> = next.catch(() => undefined);
    keyLocks.set(key, tracked);
    tracked.finally(() => {
        if (keyLocks.get(key) === tracked) {
            keyLocks.delete(key);
        }
    });
    return next;
}

/**
 * Stage 2-H3 Phase 2: counter 평가 + 증가 + 저장. 모든 작업이 async.
 * 카운터는 `windowMs * RATE_LIMIT_POLICY.TTL_WINDOW_MULTIPLIER` TTL로 저장되어 구 window는 자연 만료 (이전 LRU 로직 대체).
 */
async function evaluateAndIncrement(
    counterKey: string,
    limit: number,
    windowMs: number,
    now: number
): Promise<RateLimitDecision> {
    const storageKey = makeStorageKey(counterKey);
    return withKeyLock(storageKey, () => performEvaluateAndIncrement(counterKey, limit, windowMs, now));
}

async function performEvaluateAndIncrement(
    counterKey: string,
    limit: number,
    windowMs: number,
    now: number
): Promise<RateLimitDecision> {
    const store = getKeyValueStore();
    const storageKey = makeStorageKey(counterKey);
    const counter = await getOrCreateCounter(counterKey, windowMs, now);
    const currentUsage = calculateSlidingWindowUsage(counter, now, windowMs);

    if ((currentUsage + 1) > limit) {
        // 거부된 요청은 카운터 증가 없음 — 상태 저장도 불필요 (기존 in-memory 동작과 동일)
        // 다만 window 롤오버 상태는 저장해 다음 요청이 stale 보지 않도록
        await store.set(storageKey, counter, windowMs * RATE_LIMIT_POLICY.TTL_WINDOW_MULTIPLIER);
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
    await store.set(storageKey, counter, windowMs * RATE_LIMIT_POLICY.TTL_WINDOW_MULTIPLIER);
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

// ================================================
// createAdvancedRateLimiter
// ================================================

export function createAdvancedRateLimiter(options: AdvancedRateLimiterOptions) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        // 비용 리미터 등에서 read-only 요청을 제외 — 카운트/차단 없이 통과.
        if (options.skip?.(req)) { next(); return; }
        const now = Date.now();
        const ip = getRequestIP(req);
        const userKey = getUserKey(req);
        const actorKey = userKey ? `user:${userKey}` : `ip:${ip}`;

        // Admin은 높은 배수의 제한 적용 (완전 우회 방지)
        const effectiveIpLimit = isAdminUser(req) ? options.ipLimit * RATE_LIMIT_POLICY.ADMIN_MULTIPLIER : options.ipLimit;

        const endpointSpecificLimit = getEndpointSpecificLimit(options.endpointRules, req);
        const perEndpointLimit = endpointSpecificLimit ?? effectiveIpLimit;

        const dimensions: Array<{ key: string; limit: number }> = [
            { key: `ip:${ip}`, limit: effectiveIpLimit },
            { key: `endpoint:${actorKey}:${getEndpointKey(req)}`, limit: perEndpointLimit },
        ];

        if (userKey && options.userLimit !== undefined) {
            dimensions.push({ key: `user:${userKey}`, limit: options.userLimit });
        }

        let strictestResult: RateLimitDecision | null = null;

        for (const dimension of dimensions) {
            const result = await evaluateAndIncrement(
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
    // 비용은 실행(POST)에서만 발생 — read-only 조회(GET/HEAD: 세션 목록·상세·스텝)는
    // 리미터 제외. 조회까지 묶여 페이지 몇 번 방문에 429 로 히스토리가 사라지던 결함 방지
    // (requireAuth 로 여전히 인증 보호됨).
    skip: (req) => req.method === 'GET' || req.method === 'HEAD',
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
        // GET (settings 페이지 카운트/리스트 조회) 는 mutation 과 별개의 관대한 한도 —
        // 페이지 진입마다 호출되므로 30/15min 공유 시 정상 사용 패턴도 차단됨.
        { path: /^GET:.*\/api-keys(?:\/|$)/, limit: RL_API_KEY_MGMT.readLimit },
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

/**
 * Admin API 레이트 리미터
 */
export const adminLimiter = createAdvancedRateLimiter({
    windowMs: RL_ADMIN.windowMs,
    ipLimit: RL_ADMIN.ipLimit,
    userLimit: RL_ADMIN.userLimit,
    message: 'Admin API 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});

/**
 * 아티팩트 코드 실행 레이트 리미터 — 컨테이너 실행은 비용이 커 보수적으로 제한.
 */
export const artifactExecLimiter = createAdvancedRateLimiter({
    windowMs: ARTIFACT_EXEC.rateWindowMs,
    ipLimit: ARTIFACT_EXEC.rateIpLimit,
    userLimit: ARTIFACT_EXEC.rateUserLimit,
    message: '코드 실행 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});
