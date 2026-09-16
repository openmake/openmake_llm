/**
 * 원자적 예약·정산 (F25 PR-2) — 동시 N요청 중 한도를 넘는 요청은 자기 증가분으로 즉시 거부된다.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { reserveUserQuota, settleUserQuota, checkUserQuota } from '../llm/user-quota';
import { getKeyValueStore, resetKeyValueStoreForTests } from '../storage';
import { resetConfig } from '../config/env';
import { QuotaExceededError } from '../errors/quota-exceeded.error';
import { QuotaUnavailableError } from '../errors/quota-unavailable.error';

jest.mock('../services/org/membership-cache', () => ({ budgetedOrgsFor: async () => [], clearOrgMembershipCache: () => undefined, activeOrgFor: async () => null }));

const ORIGINAL_ENV = { ...process.env };
const NOW = 1_700_000_000_000;

beforeEach(() => {
    process.env.STORAGE_BACKEND = 'memory';
    process.env.LLM_HOURLY_TOKEN_LIMIT = '1000';
    process.env.LLM_WEEKLY_TOKEN_LIMIT = '5000';
    delete process.env.QUOTA_FAIL_MODE;
    resetConfig(); resetKeyValueStoreForTests();
});
afterEach(() => { process.env = { ...ORIGINAL_ENV }; resetConfig(); resetKeyValueStoreForTests(); });

describe('reserveUserQuota', () => {
    it('한도 1000·예약 600 × 동시 3건 → 정확히 1건 통과, 버킷은 600', async () => {
        const results = await Promise.allSettled([1, 2, 3].map(() => reserveUserQuota('u1', 600, NOW)));
        const ok = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');
        expect(ok).toHaveLength(1);
        expect(rejected).toHaveLength(2);
        for (const r of rejected) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(QuotaExceededError);
        const hour = await getKeyValueStore().get<number>(`llmq:u1:h:${Math.floor(NOW / 3_600_000)}`);
        expect(hour).toBe(600);
    });

    it('정산: 실측 200 이면 버킷 200, 실패(0) 면 전액 환불', async () => {
        const r = await reserveUserQuota('u1', 600, NOW);
        await settleUserQuota(r, 200);
        const key = `llmq:u1:h:${Math.floor(NOW / 3_600_000)}`;
        expect(await getKeyValueStore().get<number>(key)).toBe(200);
        const r2 = await reserveUserQuota('u1', 300, NOW);
        await settleUserQuota(r2, 0);
        expect(await getKeyValueStore().get<number>(key)).toBe(200);
    });

    it('예약 0 은 종전 누적 비교와 동일(checkUserQuota 호환)', async () => {
        await reserveUserQuota('u1', 1000, NOW);
        await expect(reserveUserQuota('u1', 0, NOW)).rejects.toThrow(QuotaExceededError);
        await expect(checkUserQuota('u1', NOW)).rejects.toThrow(QuotaExceededError);
    });

    it('비인증은 null 핸들, settle 무영향', async () => {
        expect(await reserveUserQuota('guest', 500, NOW)).toBeNull();
        await settleUserQuota(null, 500);
    });

    it('QUOTA_FAIL_MODE=closed + 저장소 장애 → QuotaUnavailableError, open 이면 통과', async () => {
        const store = getKeyValueStore();
        const spy = jest.spyOn(store, 'incrBy').mockRejectedValue(new Error('kv down'));
        process.env.QUOTA_FAIL_MODE = 'closed'; resetConfig();
        await expect(reserveUserQuota('u1', 10, NOW)).rejects.toThrow(QuotaUnavailableError);
        process.env.QUOTA_FAIL_MODE = 'open'; resetConfig();
        const r = await reserveUserQuota('u1', 10, NOW);
        expect(r).toEqual({ userId: 'u1', estimate: 0, keys: [] });
        spy.mockRestore();
    });
});
