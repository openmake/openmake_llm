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
import { budgetedOrgsFor, clearOrgMembershipCache } from '../services/org/membership-cache';
import { createLogger } from '../utils/logger';
import { QuotaExceededError } from '../errors/quota-exceeded.error';
import { QuotaUnavailableError } from '../errors/quota-unavailable.error';
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
/** 달력 월 버킷(UTC) — 조직 월 예산(127) 합산 재료. 다음 달 말까지 보존(TTL 62일). */
function monthBucket(now: number): string {
    const d = new Date(now);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthKey(userId: string, now: number): string {
    return `llmq:${userId}:m:${monthBucket(now)}`;
}
const MONTH_TTL_MS = 62 * 24 * 60 * 60 * 1000;

/** 정산 잡(services/cost/quota-reconcile-job)용 공개 헬퍼 */
export function weekBucketKey(userId: string, now: number): string { return weekKey(userId, now); }
export function monthBucketKey(userId: string, now: number): string { return monthKey(userId, now); }
export { WEEK_TTL_MS, MONTH_TTL_MS };
export function weekWindow(now: number): { from: Date; to: Date } {
    const start = Math.floor(now / WEEK_MS) * WEEK_MS;
    return { from: new Date(start), to: new Date(start + WEEK_MS) };
}
export function monthWindow(now: number): { from: Date; to: Date } {
    const d = new Date(now);
    const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    return { from, to };
}


/** 조직 예산 캐시는 services/org/membership-cache 로 통합(F22 Phase A) — 이름은 호출처 호환용으로 유지. */
export function clearOrgBudgetCache(): void { clearOrgMembershipCache(); }

/**
 * 조직 월 예산 검사(127) — 사용자가 속한 예산 있는 조직마다 멤버 전체의 이번 달 사용량 합이 예산 이상이면 throw.
 * 조직이 없으면 no-op. KV 장애는 fail-open.
 */
export async function checkOrgBudget(userId: string, now: number): Promise<void> {
    const orgs = await budgetedOrgsFor(userId, now);
    if (orgs.length === 0) return;
    const store = getKeyValueStore();
    for (const org of orgs) {
        const used = (await Promise.all(org.memberIds.map((m) => store.get<number>(monthKey(m, now)))))
            .reduce<number>((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);
        if (used >= org.budget) throw new QuotaExceededError('org_monthly', used, org.budget);
    }
}

/** 조회용 윈도우 상태 — resetAt 은 현재 calendar bucket 이 넘어가는 시각(ms epoch). */
interface UserQuotaWindow {
    used: number;
    limit: number;
    remaining: number;
    resetAt: number;
}

interface UserQuotaStatus {
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
        await checkOrgBudget(userId, now);
    } catch (e) {
        if (e instanceof QuotaExceededError) throw e;
        if (cfg.quotaFailMode === 'closed') {
            logger.error('per-user quota check 저장소 장애 (fail-closed):', e);
            throw new QuotaUnavailableError(e);
        }
        logger.warn('per-user quota check 실패 (fail-open):', e);
    }
}

/** 예약 핸들 — settleUserQuota 로 실측 정산. keys 는 hour/week/month 버킷. */
export interface QuotaReservation {
    userId: string;
    estimate: number;
    keys: { key: string; ttlMs: number }[];
}

/**
 * 원자적 예약(F25 PR-2): 추정 토큰을 hour→week→month 버킷에 incrBy 로 **선반영**하고, 증가 후 값이 한도를
 * 넘으면 지금까지 올린 만큼 환불하고 throw. 동시 N요청 중 한도를 넘는 요청은 자기 증가분의 결과값으로
 * 즉시 판정되므로 초과 통과가 불가능하다(종전 check-then-record 의 경쟁 창 제거).
 * 조직 월 예산은 종전처럼 멤버 합산 읽기로 검사한다(이 사용자의 예약분은 월 버킷에 이미 반영돼 있다).
 * KV 장애: QUOTA_FAIL_MODE=open 이면 예약 없이 통과(estimate 0 핸들), closed 면 QuotaUnavailableError.
 */
export async function reserveUserQuota(userId: string | undefined, estimate: number, now: number): Promise<QuotaReservation | null> {
    if (!isPersistableUserId(userId)) return null;
    const cfg = getConfig();
    const est = Number.isFinite(estimate) && estimate > 0 ? Math.ceil(estimate) : 0;
    const plan: Array<{ key: string; ttlMs: number; limit: number; type: 'hourly' | 'weekly' | null }> = [
        { key: hourKey(userId, now), ttlMs: HOUR_TTL_MS, limit: cfg.llmHourlyTokenLimit, type: 'hourly' },
        { key: weekKey(userId, now), ttlMs: WEEK_TTL_MS, limit: cfg.llmWeeklyTokenLimit, type: 'weekly' },
        { key: monthKey(userId, now), ttlMs: MONTH_TTL_MS, limit: 0, type: null },
    ];
    const applied: { key: string; ttlMs: number }[] = [];
    const store = getKeyValueStore();
    try {
        for (const step of plan) {
            const after = est > 0 ? await store.incrBy(step.key, est) : ((await store.get<number>(step.key)) ?? 0);
            if (est > 0) { applied.push({ key: step.key, ttlMs: step.ttlMs }); void store.expire(step.key, step.ttlMs).catch(() => undefined); }
            const usedNum = typeof after === 'number' ? after : 0;
            // 한도 판정은 "이 요청 포함" — est 가 0 이면 종전 checkUserQuota 와 같은 누적치 비교
            if (step.type && step.limit > 0 && (est > 0 ? usedNum > step.limit : usedNum >= step.limit)) {
                await refund(store, applied, est);
                throw new QuotaExceededError(step.type, Math.max(0, usedNum - est), step.limit);
            }
        }
        try {
            await checkOrgBudget(userId, now);
        } catch (e) {
            if (e instanceof QuotaExceededError) { await refund(store, applied, est); }
            throw e;
        }
        return { userId, estimate: est, keys: applied };
    } catch (e) {
        if (e instanceof QuotaExceededError) throw e;
        if (cfg.quotaFailMode === 'closed') {
            logger.error('per-user quota 저장소 장애 (fail-closed):', e);
            throw new QuotaUnavailableError(e);
        }
        logger.warn('per-user quota 예약 실패 (fail-open):', e);
        return { userId, estimate: 0, keys: [] };
    }
}

async function refund(store: ReturnType<typeof getKeyValueStore>, applied: { key: string }[], amount: number): Promise<void> {
    if (amount <= 0) return;
    await Promise.all(applied.map((a) => store.incrBy(a.key, -amount).catch(() => undefined)));
}

/**
 * 정산 — 예약분과 실측의 차이(actual - estimate)를 버킷에 반영한다(음수 가능). 실패·중단은 actual=0 으로
 * 호출해 전액 환불한다. fail-open.
 */
export async function settleUserQuota(reservation: QuotaReservation | null, actual: number): Promise<void> {
    if (!reservation || reservation.keys.length === 0) {
        // 예약 없이 통과한 경우(비인증·fail-open) — 실측이 있으면 종전 기록 경로
        if (reservation && actual > 0) await recordUserUsage(reservation.userId, actual, Date.now());
        return;
    }
    const delta = Math.max(0, Math.round(actual)) - reservation.estimate;
    if (delta === 0) return;
    try {
        const store = getKeyValueStore();
        await Promise.all(reservation.keys.map((k) => store.incrBy(k.key, delta).then(() => store.expire(k.key, k.ttlMs))));
    } catch (e) {
        logger.warn('per-user quota 정산 실패 (무시):', e);
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
        const mk = monthKey(userId, now);
        await Promise.all([
            store.incrBy(hk, tokens).then(() => store.expire(hk, HOUR_TTL_MS)),
            store.incrBy(wk, tokens).then(() => store.expire(wk, WEEK_TTL_MS)),
            store.incrBy(mk, tokens).then(() => store.expire(mk, MONTH_TTL_MS)),
        ]);
    } catch (e) {
        logger.warn('per-user quota record 실패 (무시):', e);
    }
}
