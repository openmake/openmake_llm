/**
 * @module services/server-key-quota
 * @description 서버 공용 외부 키 토큰 상한 — KVStore calendar-bucket (llm/user-quota 패턴).
 *
 * 비용 주체가 운영자이므로 상한은 hard gate: 초과 시 role 해석이 로컬로 강등된다.
 * KVStore 장애 시 fail-open (가용성 우선 — user-quota 와 동일 정책).
 * 멀티프로세스 정합엔 STORAGE_BACKEND=redis 필요 (user-quota 와 동일 제약).
 */
import { getKeyValueStore } from '../storage';
import { createLogger } from '../utils/logger';

const logger = createLogger('ServerKeyQuota');

const DAY_MS = 24 * 60 * 60 * 1000;
// 고정 30일 윈도우 (calendar-month 대신 — user-quota week 버킷과 동일한 race-free 방식)
const MONTH_MS = 30 * DAY_MS;
const DAY_TTL_MS = 2 * DAY_MS;
const MONTH_TTL_MS = 2 * MONTH_MS;

function dayKey(providerId: string, now: number): string {
    return `srvkeyq:${providerId}:d:${Math.floor(now / DAY_MS)}`;
}
function monthKey(providerId: string, now: number): string {
    return `srvkeyq:${providerId}:m:${Math.floor(now / MONTH_MS)}`;
}

/**
 * 상한 검사 — 사용 가능하면 null, 불가면 사유 문자열 반환 (resolver 폴백 사유로 사용).
 * daily=0 은 "사용 불가" 로 해석 (등록만 하고 잠근 상태).
 */
export async function checkServerKeyBudget(
    providerId: string,
    dailyLimit: number,
    monthlyLimit: number | null,
    now: number,
): Promise<string | null> {
    if (dailyLimit <= 0) return `서버 키 '${providerId}' 일 상한이 0 (잠금 상태)`;
    try {
        const store = getKeyValueStore();
        const [dUsed, mUsed] = await Promise.all([
            store.get<number>(dayKey(providerId, now)),
            store.get<number>(monthKey(providerId, now)),
        ]);
        const daily = typeof dUsed === 'number' ? dUsed : 0;
        const monthly = typeof mUsed === 'number' ? mUsed : 0;
        if (daily >= dailyLimit) {
            return `서버 키 '${providerId}' 일 토큰 상한 초과 (${daily}/${dailyLimit})`;
        }
        if (monthlyLimit !== null && monthlyLimit > 0 && monthly >= monthlyLimit) {
            return `서버 키 '${providerId}' 월 토큰 상한 초과 (${monthly}/${monthlyLimit})`;
        }
        return null;
    } catch (e) {
        logger.warn('서버 키 상한 조회 실패 — fail-open:', e);
        return null;
    }
}

/** 사용량 누적 (fire-and-forget) */
export async function recordServerKeyUsage(providerId: string, tokens: number, now: number): Promise<void> {
    if (!Number.isFinite(tokens) || tokens <= 0) return;
    try {
        const store = getKeyValueStore();
        const dk = dayKey(providerId, now);
        const mk = monthKey(providerId, now);
        await Promise.all([
            store.incrBy(dk, tokens).then(() => store.expire(dk, DAY_TTL_MS)),
            store.incrBy(mk, tokens).then(() => store.expire(mk, MONTH_TTL_MS)),
        ]);
    } catch (e) {
        logger.warn('서버 키 사용량 누적 실패 (무시):', e);
    }
}

/** 예약 핸들 — `settleServerKeyReservation` 로 실측 정산 */
export interface ServerKeyReservation {
    providerId: string;
    estimate: number;
    keys: { key: string; ttlMs: number }[];
}

/**
 * 원자적 예약(P04, 계획서 9.2·T24) — 추정 토큰을 일·월 버킷에 **선반영**하고 증가 후 값이 상한을 넘으면 환불 후 사유를 돌려준다.
 * 동시 요청 두 건이 각각 `checkServerKeyBudget` 만 통과해 총한도를 넘던 경쟁 창을 없앤다. KV 장애는 종전과 같이 fail-open(예약 0).
 * daily=0 은 잠금 상태.
 */
export async function reserveServerKeyBudget(
    providerId: string, estimate: number, dailyLimit: number, monthlyLimit: number | null, now: number,
): Promise<{ reservation: ServerKeyReservation } | { rejected: string }> {
    if (dailyLimit <= 0) return { rejected: `서버 키 '${providerId}' 일 상한이 0 (잠금 상태)` };
    const est = Number.isFinite(estimate) && estimate > 0 ? Math.ceil(estimate) : 0;
    const plan = [
        { key: dayKey(providerId, now), ttlMs: DAY_TTL_MS, limit: dailyLimit, label: '일' },
        { key: monthKey(providerId, now), ttlMs: MONTH_TTL_MS, limit: monthlyLimit !== null && monthlyLimit > 0 ? monthlyLimit : 0, label: '월' },
    ];
    const applied: { key: string; ttlMs: number }[] = [];
    try {
        const store = getKeyValueStore();
        for (const step of plan) {
            const after = est > 0 ? await store.incrBy(step.key, est) : ((await store.get<number>(step.key)) ?? 0);
            if (est > 0) { applied.push({ key: step.key, ttlMs: step.ttlMs }); void store.expire(step.key, step.ttlMs).catch(() => undefined); }
            const used = typeof after === 'number' ? after : 0;
            if (step.limit <= 0) continue;
            if (est > 0 ? used > step.limit : used >= step.limit) {
                await Promise.all(applied.map((a) => store.incrBy(a.key, -est).catch(() => undefined)));
                return { rejected: `서버 키 '${providerId}' ${step.label} 토큰 상한 초과 (${Math.max(0, used - est)}/${step.limit})` };
            }
        }
        return { reservation: { providerId, estimate: est, keys: applied } };
    } catch (e) {
        logger.warn('서버 키 예산 예약 실패 — fail-open:', e);
        return { reservation: { providerId, estimate: 0, keys: [] } };
    }
}

/**
 * 정산 — provider 가 usage 를 줬으면 (actual - estimate) 만큼 보정한다. `actual === null`(usage 없음)이면 예약분을 **그대로 둔다**
 * — unknown 을 무료로 정산하지 않는다(계획서 9.2). 전송 전 실패는 actual=0 으로 전액 환불.
 */
export async function settleServerKeyReservation(reservation: ServerKeyReservation | null, actual: number | null): Promise<void> {
    if (!reservation || reservation.keys.length === 0 || actual === null) return;
    const delta = Math.max(0, Math.round(actual)) - reservation.estimate;
    if (delta === 0) return;
    try {
        const store = getKeyValueStore();
        await Promise.all(reservation.keys.map((k) => store.incrBy(k.key, delta).then(() => store.expire(k.key, k.ttlMs))));
    } catch (e) {
        logger.warn('서버 키 예산 정산 실패 (무시):', e);
    }
}
