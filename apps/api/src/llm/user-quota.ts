/**
 * ============================================================
 * Per-User Token Quota — KVStore(redis/memory) 기반
 * ============================================================
 *
 * 전역 in-memory tracker(usage-tracker.ts)의 "한 사용자가 소진하면 전체 차단" /
 * 멀티프로세스 N배 허용 / 재시작 리셋 문제를 해소하기 위한 per-user 쿼터.
 *
 * - calendar-bucketed fixed window (hour/week) — 멀티프로세스 정합 (공유 KVStore).
 *   bucket 키가 윈도우마다 고정이므로 incrBy + expire 가 race-free.
 * - 한도는 기존 LLM_HOURLY/WEEKLY_TOKEN_LIMIT 를 per-user 로 재해석.
 * - fail-open: KVStore 장애 시 통과 (가용성 우선, 기존 tracker 패턴 일치).
 * - 비인증(guest/anon) 요청은 enforcement skip (guest-blocks-guest 방지).
 *
 * @module llm/user-quota
 */
import { getKeyValueStore } from '../storage';
import { getConfig } from '../config';
import { createLogger } from '../utils/logger';
import { QuotaExceededError } from '../errors/quota-exceeded.error';
import { isPersistableUserId } from '../utils/user-id-validation';

const logger = createLogger('UserQuota');

const HOUR_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// 윈도우 경과 후 자동 정리 — 버킷 경계 직후에도 직전 버킷 조회가 가능하도록 윈도우의 2배 TTL.
const HOUR_TTL_MS = 2 * HOUR_MS;
const WEEK_TTL_MS = 2 * WEEK_MS;

function hourKey(userId: string, now: number): string {
    return `llmq:${userId}:h:${Math.floor(now / HOUR_MS)}`;
}
function weekKey(userId: string, now: number): string {
    return `llmq:${userId}:w:${Math.floor(now / WEEK_MS)}`;
}

/** 조회용 윈도우 상태 — resetAt 은 현재 calendar bucket 이 넘어가는 시각(ms epoch). */
export interface UserQuotaWindow {
    used: number;
    limit: number;
    remaining: number;
    resetAt: number;
}

export interface UserQuotaStatus {
    hourly: UserQuotaWindow;
    weekly: UserQuotaWindow;
}

function toWindow(used: number, limit: number, resetAt: number): UserQuotaWindow {
    return {
        used,
        limit,
        // limit<=0 은 무제한 — remaining 을 0 으로 만들면 소진처럼 보이므로 used 와 무관하게 0 유지
        remaining: limit > 0 ? Math.max(0, limit - used) : 0,
        resetAt,
    };
}

/**
 * 현재 사용자의 쿼터 잔여 조회 — checkUserQuota 가 검사하는 것과 동일한 버킷을 읽는다.
 *
 * 비인증(guest/anon) 이거나 KVStore 장애면 null (fail-open: 호출부는 표시를 생략).
 */
export async function getUserQuotaStatus(userId: string | undefined, now: number): Promise<UserQuotaStatus | null> {
    if (!isPersistableUserId(userId)) return null;
    const cfg = getConfig();

    try {
        const store = getKeyValueStore();
        const [hUsed, wUsed] = await Promise.all([
            store.get<number>(hourKey(userId, now)),
            store.get<number>(weekKey(userId, now)),
        ]);
        return {
            hourly: toWindow(
                typeof hUsed === 'number' ? hUsed : 0,
                cfg.llmHourlyTokenLimit,
                (Math.floor(now / HOUR_MS) + 1) * HOUR_MS,
            ),
            weekly: toWindow(
                typeof wUsed === 'number' ? wUsed : 0,
                cfg.llmWeeklyTokenLimit,
                (Math.floor(now / WEEK_MS) + 1) * WEEK_MS,
            ),
        };
    } catch (e) {
        logger.warn('per-user quota 조회 실패 (fail-open):', e);
        return null;
    }
}

/**
 * 사용량 기록 전 쿼터 검사. 이미 누적된 사용량이 한도 이상이면 throw.
 * (현재 요청 토큰은 선반영하지 않음 — 기존 soft-limit 동작과 일치.)
 */
export async function checkUserQuota(userId: string | undefined, now: number): Promise<void> {
    if (!isPersistableUserId(userId)) return; // 비인증 요청은 enforcement skip
    const cfg = getConfig();
    const hourlyLimit = cfg.llmHourlyTokenLimit;
    const weeklyLimit = cfg.llmWeeklyTokenLimit;

    try {
        const store = getKeyValueStore();
        const [hUsed, wUsed] = await Promise.all([
            store.get<number>(hourKey(userId, now)),
            store.get<number>(weekKey(userId, now)),
        ]);
        const hourly = typeof hUsed === 'number' ? hUsed : 0;
        const weekly = typeof wUsed === 'number' ? wUsed : 0;

        if (hourlyLimit > 0 && hourly >= hourlyLimit) {
            throw new QuotaExceededError('hourly', hourly, hourlyLimit);
        }
        if (weeklyLimit > 0 && weekly >= weeklyLimit) {
            throw new QuotaExceededError('weekly', weekly, weeklyLimit);
        }
    } catch (e) {
        if (e instanceof QuotaExceededError) throw e;
        logger.warn('per-user quota check 실패 (fail-open):', e);
    }
}

/**
 * 사용량 기록 — hour/week 버킷에 토큰 누적 + TTL 설정. fire-and-forget 용 (fail-open).
 */
export async function recordUserUsage(userId: string | undefined, tokens: number, now: number): Promise<void> {
    if (!isPersistableUserId(userId)) return;
    if (!Number.isFinite(tokens) || tokens <= 0) return;

    try {
        const store = getKeyValueStore();
        const hk = hourKey(userId, now);
        const wk = weekKey(userId, now);
        await Promise.all([
            store.incrBy(hk, tokens).then(() => store.expire(hk, HOUR_TTL_MS)),
            store.incrBy(wk, tokens).then(() => store.expire(wk, WEEK_TTL_MS)),
        ]);
    } catch (e) {
        logger.warn('per-user quota record 실패 (무시):', e);
    }
}
