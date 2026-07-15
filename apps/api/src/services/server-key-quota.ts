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
