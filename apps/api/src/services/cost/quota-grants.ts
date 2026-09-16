/**
 * 쿼터 추가 한도(grants)·이월·초과 요청 (F25 PR-3b, 2026-09-17).
 *
 *  - 유효 한도 = 설정 한도 + 해당 윈도우 버킷의 grants 합(60초 캐시, 변경 시 clearQuotaGrantCache).
 *  - 이월: 새 주/월 버킷의 첫 예약에서 직전 버킷 미사용분 × QUOTA_ROLLOVER_RATIO(0=비활성)를 min(cap) 해
 *    kind rollover 로 멱등 삽입(UNIQUE 로 동시 첫 요청이 두 번 넣지 못한다). 시간 버킷은 이월 없음.
 *  - 초과 요청: reserve 가 초과를 판정하면 QUOTA_OVERAGE_AUTO_REQUEST=true 일 때 사용자·윈도우·버킷당 pending 1건을
 *    자동 생성하고 QuotaExceededError.approvalRequestId 로 알린다. 승인 → grants(kind approval).
 * 전부 fail-open — 조회 실패는 grants 0·요청 없음으로 처리한다.
 *
 * @module services/cost/quota-grants
 */
import { randomUUID } from 'crypto';
import { createLogger } from '../../utils/logger';
import { getPool } from '../../data/models/unified-database';
import { QUOTA_GRANTS } from '../../config/runtime-limits';
import { ORG_CONTEXT } from '../../config/runtime-limits';
import type { QuotaWindow } from '../../data/repositories/quota-grant-repository';

const logger = createLogger('QuotaGrants');

async function repo() {
    const { QuotaGrantRepository } = await import('../../data/repositories/quota-grant-repository');
    return new QuotaGrantRepository(getPool());
}

interface Entry { at: number; value: number }
const grantCache = new Map<string, Entry>();

export function clearQuotaGrantCache(userId?: string): void {
    if (userId === undefined) { grantCache.clear(); return; }
    for (const k of grantCache.keys()) if (k.startsWith(`${userId}|`)) grantCache.delete(k);
}

/** 해당 버킷의 grants 합 (60초 캐시, fail-open 0). */
export async function grantsFor(userId: string, window: QuotaWindow, bucket: string, now: number = Date.now()): Promise<number> {
    const key = `${userId}|${window}|${bucket}`;
    const hit = grantCache.get(key);
    if (hit && now - hit.at < ORG_CONTEXT.CACHE_TTL_MS) return hit.value;
    try {
        const value = await (await repo()).sumUserGrants(userId, window, bucket);
        grantCache.set(key, { at: now, value });
        return value;
    } catch (e) {
        logger.warn('grants 조회 실패 (0 으로 처리):', e);
        return 0;
    }
}

/** PURE: 이월량 = min(cap, max(0, 직전 한도 - 직전 사용) × ratio). ratio 0 이면 0. */
export function rolloverAmount(prevLimit: number, prevUsed: number, ratio: number, cap: number): number {
    if (!(ratio > 0) || !(prevLimit > 0)) return 0;
    const unused = Math.max(0, prevLimit - Math.max(0, prevUsed));
    const amount = Math.floor(unused * Math.min(1, ratio));
    return cap > 0 ? Math.min(cap, amount) : amount;
}

/** 새 버킷 첫 예약 시 호출 — 멱등. 삽입되면 캐시 무효화. */
export async function maybeCreateRollover(userId: string, window: QuotaWindow, bucket: string, prevLimit: number, prevUsed: number): Promise<boolean> {
    const amount = rolloverAmount(prevLimit, prevUsed, QUOTA_GRANTS.ROLLOVER_RATIO, QUOTA_GRANTS.ROLLOVER_CAP_TOKENS);
    if (amount <= 0) return false;
    try {
        const inserted = await (await repo()).insertIfAbsent({ userId, window, bucket, amount, kind: 'rollover', sourceId: '' });
        if (inserted) { clearQuotaGrantCache(userId); logger.info(`이월 생성: user=${userId} ${window}/${bucket} +${amount}`); }
        return inserted;
    } catch (e) {
        logger.warn('이월 생성 실패 (무시):', e);
        return false;
    }
}

/** 초과 요청 자동 생성 — pending 이 있으면 그 id. 실패는 undefined. */
export async function ensureOverageRequest(userId: string, window: QuotaWindow, bucket: string, requestedAmount: number, reason: string | null, autoCreated: boolean): Promise<string | undefined> {
    try {
        const r = await repo();
        const existing = await r.findPendingOverage(userId, window, bucket);
        if (existing) return existing.id;
        const created = await r.createOverageIfNoPending({
            id: randomUUID(), userId, window, bucket, requestedAmount: Math.max(1, requestedAmount), reason, autoCreated,
            expiresAt: new Date(Date.now() + QUOTA_GRANTS.OVERAGE_REQUEST_TTL_MS),
        });
        return created?.id ?? (await r.findPendingOverage(userId, window, bucket))?.id;
    } catch (e) {
        logger.warn('초과 요청 생성 실패 (무시):', e);
        return undefined;
    }
}
