/**
 * 레이트 리미팅 미들웨어
 * Sliding Window Counter 기반 고급 레이트 리미터
 */

import { Request, Response, NextFunction } from 'express';
import { rateLimited } from '../utils/api-response';
import {
    RL_GENERAL, RL_AUTH, RL_CHAT, RL_RESEARCH, RL_UPLOAD, RL_CHUNK_UPLOAD,
    RL_WEB_SEARCH, RL_MEMORY, RL_MCP, RL_API_KEY_MGMT, RL_PUSH, RL_ADMIN,
    RL_AGENT_TASK,
} from '../config/rate-limits';
import { createHash } from 'crypto';
import { getKeyValueStore } from '../storage';
import { STORAGE_POLICY, RATE_LIMIT_POLICY, AUTH_COOKIES } from '../config/security';
import { ARTIFACT_EXEC } from '../config/artifact-exec';
import { ARTIFACT_EXPORT } from '../config/artifact-export';
import { verifyToken } from '../auth/auth-core';
import { isAdminRole } from '../data/user-manager';

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
    /**
     * 리미터 식별자 — 카운터 키 네임스페이스. **필수**: 없으면 windowMs 가 같은 리미터끼리
     * 같은 액터 카운터를 공유해, 예컨대 채팅 POST 가 에이전트 작업 예산을 먹어버린다
     * (2026-08-26 운영 실측: 사이트 전체 POST 가 한 카운터에 쌓여 CLI 가 상시 429).
     */
    name: string;
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

/** 키로 쓸 수 있는 IP 형태인지 — 헤더 원문을 그대로 키에 넣지 않기 위한 최소 검증. */
function isPlausibleIP(v: string): boolean {
    return v.length > 0 && v.length <= 45 && /^[0-9a-fA-F:.]+$/.test(v);
}

function isLoopbackPeer(ip: string): boolean {
    return ip === '::1' || ip === '127.0.0.1' || ip.startsWith('::ffff:127.');
}

/**
 * 레이트리밋 키로 쓸 클라이언트 IP.
 *
 * ⚠️ 운영 실측(2026-08-26): Cloudflare Tunnel → cloudflared → Caddy → Express 경로에서
 * `req.ip` 가 항상 루프백(`::1`)이라 **외부 사용자 전원이 IP 버킷 하나를 공유**했다
 * (X-Forwarded-For 를 넣어도 무시됨 — Caddy 가 신뢰하지 않는 peer 의 XFF 를 덮어쓴다).
 * Cloudflare 가 붙이는 `CF-Connecting-IP` 는 그 경로에서 살아남으므로, **peer 가 루프백일
 * 때만** 이 헤더를 채택한다. 외부 클라이언트는 Cloudflare 가 값을 덮어쓰므로 위조할 수 없고,
 * LAN 직결(:33000)만 위조 여지가 있는데 그 경로는 내부 전용이다.
 */
function getRequestIP(req: Request): string {
    const peer = req.ip || 'unknown';
    if (isLoopbackPeer(peer)) {
        const raw = req.headers['cf-connecting-ip'] ?? req.headers['true-client-ip'];
        const cf = (Array.isArray(raw) ? raw[0] : raw)?.trim();
        if (cf && isPlausibleIP(cf)) return cf;
    }
    return peer;
}

/**
 * 액터 키 — "이 요청을 누구 몫으로 셀 것인가".
 *
 * JWT 사용자 > API key > IP 순. **API key 를 IP 로 세면 안 된다**: 프록시 뒤에서는 CLI·
 * 데스크톱 클라이언트가 사이트 전체 트래픽과 한 버킷을 쓰게 되어, 남의 요청 때문에 429 를
 * 맞는다(실측). 키 원문은 넣지 않고 해시 앞부분만 쓴다.
 */
function resolveActorKey(req: Request, userId: string | null, ip: string): string {
    if (userId) return `user:${userId}`;
    const raw = req.headers['x-api-key'];
    const apiKey = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (apiKey) return `key:${createHash('sha256').update(apiKey).digest('hex').slice(0, 16)}`;
    return `ip:${ip}`;
}

/**
 * 레이트 리밋 keying 용 사용자 신원 해석.
 *
 * ⚠️ 리미터는 미들웨어 체인에서 requireAuth/optionalAuth 보다 **먼저** 실행되므로 이 시점의
 * `req.user` 는 아직 비어 있다. 이전엔 그래서 `userLimit`·`ADMIN_MULTIPLIER` 가 전혀 적용되지
 * 않고 모든 인증 사용자가 익명 `ipLimit` 로만 제한되던 결함이 있었다. 여기서 auth_token(쿠키/
 * Bearer)을 **서명만 검증**(DB 조회 없음)해 keying 목적의 userId/role 을 도출한다.
 * 위조 토큰은 JWT_SECRET 없이 통과 불가하므로 "더 높은 한도 부여" 목적엔 안전하며, 만료/무효
 * 토큰은 null → IP 기준으로 폴백한다(기존 동작 유지). 실제 인증 강제는 라우트별 미들웨어가 담당.
 */
async function resolveLimiterIdentity(req: Request): Promise<{ userId: string; role: string } | null> {
    const user = req.user as { userId?: unknown; id?: unknown; role?: unknown } | undefined;
    if (user) {
        const uid = user.userId ?? user.id;
        if (uid !== undefined && uid !== null) {
            return { userId: String(uid), role: user.role ? String(user.role) : 'user' };
        }
    }
    const authHeader = req.headers.authorization;
    const bearer = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const token = (req.cookies?.[AUTH_COOKIES.ACCESS] as string | undefined) || bearer;
    if (!token || typeof token !== 'string') return null;
    try {
        const payload = await verifyToken(token);
        if (payload?.userId) {
            return { userId: String(payload.userId), role: payload.role ? String(payload.role) : 'user' };
        }
    } catch {
        /* 서명 무효/만료 — 익명 취급(IP 기준 폴백) */
    }
    return null;
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
        const identity = await resolveLimiterIdentity(req);
        const userKey = identity?.userId ?? null;
        const actorKey = resolveActorKey(req, userKey, ip);

        // Admin은 높은 배수의 제한 적용 (완전 우회 방지)
        const effectiveIpLimit = isAdminRole(identity?.role) ? options.ipLimit * RATE_LIMIT_POLICY.ADMIN_MULTIPLIER : options.ipLimit;

        const endpointSpecificLimit = getEndpointSpecificLimit(options.endpointRules, req);
        const perEndpointLimit = endpointSpecificLimit ?? effectiveIpLimit;

        // 액터 예산 1개 + 엔드포인트 예산 1개. 식별된 액터(JWT·API key)는 IP 차원을 타지
        // 않는다 — 프록시 뒤에서 IP 는 전원이 공유하는 값이라 남의 트래픽으로 막힌다.
        const actorBudget = userKey && options.userLimit !== undefined ? options.userLimit : effectiveIpLimit;
        const dimensions: Array<{ key: string; limit: number }> = [
            { key: actorKey, limit: actorBudget },
            { key: `endpoint:${actorKey}:${getEndpointKey(req)}`, limit: perEndpointLimit },
        ];

        let strictestResult: RateLimitDecision | null = null;

        for (const dimension of dimensions) {
            const result = await evaluateAndIncrement(
                `${options.name}:${dimension.key}:${options.windowMs}`,
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
    name: 'general',
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
    name: 'auth',
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
    name: 'chat',
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
    name: 'research',
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
 * 에이전트 작업 레이트 리미터 (Docker 샌드박스 spawn + LLM 루프 — 비용 최상급).
 * 실행 비용은 생성(POST)에서 발생 — 진행 폴링(GET/HEAD)은 제외 (research 와 동일 정책).
 */
export const agentTaskLimiter = createAdvancedRateLimiter({
    name: 'agent-task',
    windowMs: RL_AGENT_TASK.windowMs,
    ipLimit: RL_AGENT_TASK.ipLimit,
    userLimit: RL_AGENT_TASK.userLimit,
    endpointRules: [
        { path: /^POST:\/api\/agent-tasks\/?$/, limit: RL_AGENT_TASK.createLimit },
    ],
    skip: (req) => req.method === 'GET' || req.method === 'HEAD',
    message: '에이전트 작업 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});

/**
 * 대용량 업로드 (OCR/PDF) 레이트 리미터
 */
export const uploadLimiter = createAdvancedRateLimiter({
    name: 'upload',
    windowMs: RL_UPLOAD.windowMs,
    ipLimit: RL_UPLOAD.ipLimit,
    userLimit: RL_UPLOAD.userLimit,
    endpointRules: [
        { path: /^POST:\/api\/documents\/upload(?:\/|$)/, limit: RL_UPLOAD.uploadLimit },
    ],
    message: '업로드 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});

/**
 * 청크 업로드 (agent-task 대용량 첨부) 레이트 리미터 — 파일 하나가 청크 수십 개로
 * 나뉘어 도착하므로 uploadLimiter(30/15분)와 별도로 높은 상한을 갖는다.
 */
export const chunkUploadLimiter = createAdvancedRateLimiter({
    name: 'chunk-upload',
    windowMs: RL_CHUNK_UPLOAD.windowMs,
    ipLimit: RL_CHUNK_UPLOAD.ipLimit,
    userLimit: RL_CHUNK_UPLOAD.userLimit,
    message: '청크 업로드 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});

/**
 * 웹 검색 레이트 리미터 (외부 검색 API 호출 -- 비용 높음)
 */
export const webSearchLimiter = createAdvancedRateLimiter({
    name: 'web-search',
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
    name: 'memory',
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
    name: 'mcp',
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
    name: 'api-key-mgmt',
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
    name: 'push',
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
    name: 'admin',
    windowMs: RL_ADMIN.windowMs,
    ipLimit: RL_ADMIN.ipLimit,
    userLimit: RL_ADMIN.userLimit,
    message: 'Admin API 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});

/**
 * 아티팩트 코드 실행 레이트 리미터 — 컨테이너 실행은 비용이 커 보수적으로 제한.
 */
export const artifactExecLimiter = createAdvancedRateLimiter({
    name: 'artifact-exec',
    windowMs: ARTIFACT_EXEC.rateWindowMs,
    ipLimit: ARTIFACT_EXEC.rateIpLimit,
    userLimit: ARTIFACT_EXEC.rateUserLimit,
    message: '코드 실행 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});

/**
 * 아티팩트 export(pdf/docx) 레이트 리미터 — 컨테이너 변환은 비용이 커 보수적으로 제한.
 */
export const artifactExportLimiter = createAdvancedRateLimiter({
    name: 'artifact-export',
    windowMs: ARTIFACT_EXPORT.rateWindowMs,
    ipLimit: ARTIFACT_EXPORT.rateIpLimit,
    userLimit: ARTIFACT_EXPORT.rateUserLimit,
    message: '문서 변환 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});
