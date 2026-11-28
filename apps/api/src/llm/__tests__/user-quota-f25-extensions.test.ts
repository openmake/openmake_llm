/**
 * F25 잔여(opt-in) — 사용자별 한도 덮어쓰기(213) · 조직/비용 grant · 조직 자체 월 버킷.
 * 플래그 OFF 면 종전과 같은지, ON 이면 각 축이 의도대로 바뀌는지 고정한다. KV 는 메모리, DB 는 저장소 mock.
 */
const flags = { overrides: false, orgGrants: false, orgBucket: false };
jest.mock('../../config/quota-extensions', () => ({
    quotaUserOverridesEnabled: () => flags.overrides,
    quotaOrgGrantsEnabled: () => flags.orgGrants,
    quotaOrgBucketEnabled: () => flags.orgBucket,
    storageGeneratedDailySnapshotEnabled: () => false,
}));
const cfg = { llmHourlyTokenLimit: 1000, llmWeeklyTokenLimit: 0, userMonthlyCostBudgetMicros: 0, quotaFailMode: 'open' };
jest.mock('../../config', () => ({ getConfig: () => cfg }));

const overrideGet = jest.fn(async (_u: string): Promise<unknown> => null);
jest.mock('../../data/repositories/user-quota-override-repository', () => ({
    UserQuotaOverrideRepository: jest.fn().mockImplementation(() => ({ get: overrideGet })),
}));
const sumGrants = jest.fn(async (..._a: unknown[]) => 0);
const sumUserGrants = jest.fn(async (..._a: unknown[]) => 0);
jest.mock('../../data/repositories/quota-grant-repository', () => ({
    QuotaGrantRepository: jest.fn().mockImplementation(() => ({ sumGrants, sumUserGrants, insertIfAbsent: jest.fn(async () => false) })),
}));
type Budgeted = { orgId: string; budget: number; costBudgetMicros: number; memberIds: string[] };
const listBudgetedOrgsForUser = jest.fn(async (_u: string): Promise<Budgeted[]> => []);
const listMembershipsForUser = jest.fn(async (_u: string): Promise<Array<{ orgId: string; role: string }>> => []);
jest.mock('../../data/repositories/organization-repository', () => ({
    OrganizationRepository: jest.fn().mockImplementation(() => ({ listBudgetedOrgsForUser, listMembershipsForUser })),
}));
const getPreferences = jest.fn(async (_u: string): Promise<Record<string, unknown>> => ({}));
jest.mock('../../data/repositories/user-repository', () => ({
    UserRepository: jest.fn().mockImplementation(() => ({ getPreferences })),
}));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../storage', () => { const { MemoryStore } = jest.requireActual('../../storage/memory-store'); const store = new MemoryStore(); return { getKeyValueStore: () => store }; });

import { reserveUserQuota, settleUserQuota, checkOrgBudget, checkUserCostBudget, recordUserUsage, getUserQuotaStatus,
    orgMonthKey, costMonthKey, chargeOrgFor, clearOrgBudgetCache } from '../user-quota';
import { clearQuotaOverrideCache, resolveEffectiveLimits, pickLimit } from '../../services/cost/quota-overrides';
import { clearQuotaGrantCache } from '../../services/cost/quota-grants';
import { getKeyValueStore } from '../../storage';

let t = Date.UTC(2026, 10, 2, 0, 0, 0);
const nextHour = () => (t += 3 * 60 * 60 * 1000); // 매 테스트 새 시간 버킷(키 충돌 방지)

beforeEach(() => {
    flags.overrides = false; flags.orgGrants = false; flags.orgBucket = false;
    cfg.llmHourlyTokenLimit = 1000; cfg.userMonthlyCostBudgetMicros = 0;
    overrideGet.mockReset().mockResolvedValue(null);
    sumGrants.mockReset().mockResolvedValue(0);
    sumUserGrants.mockReset().mockResolvedValue(0);
    listBudgetedOrgsForUser.mockReset().mockResolvedValue([]);
    listMembershipsForUser.mockReset().mockResolvedValue([]);
    getPreferences.mockReset().mockResolvedValue({});
    clearQuotaOverrideCache(); clearQuotaGrantCache(); clearOrgBudgetCache();
});

describe('사용자별 한도 덮어쓰기 (QUOTA_USER_OVERRIDES_ENABLED)', () => {
    it('PURE: NULL = 전역, 0 = 무제한, 양수 = 그 값', () => {
        expect(pickLimit(null, 1000)).toBe(1000);
        expect(pickLimit('0', 1000)).toBe(0);
        expect(pickLimit('5000', 1000)).toBe(5000);
        expect(resolveEffectiveLimits({ hourlyTokenLimit: 1, weeklyTokenLimit: 2, monthlyCostBudgetMicros: 3 },
            { hourly_token_limit: null, weekly_token_limit: 20, monthly_cost_budget_micros: 0 }))
            .toEqual({ hourlyTokenLimit: 1, weeklyTokenLimit: 20, monthlyCostBudgetMicros: 0, overridden: true });
    });

    it('플래그 OFF: 행이 있어도 전역 한도로 거절(종전) — 표를 읽지도 않는다', async () => {
        const now = nextHour();
        overrideGet.mockResolvedValue({ hourly_token_limit: 5000, weekly_token_limit: null, monthly_cost_budget_micros: null });
        await expect(reserveUserQuota('u-off', 1200, now)).rejects.toMatchObject({ quotaType: 'hourly', limit: 1000 });
        expect(overrideGet).not.toHaveBeenCalled();
    });

    it('플래그 ON: 사용자 한도 5000 이면 1200 통과, 상태 조회도 그 한도', async () => {
        flags.overrides = true;
        const now = nextHour();
        overrideGet.mockResolvedValue({ hourly_token_limit: 5000, weekly_token_limit: null, monthly_cost_budget_micros: null });
        await expect(reserveUserQuota('u-on', 1200, now)).resolves.toMatchObject({ estimate: 1200 });
        const status = await getUserQuotaStatus('u-on', now);
        expect(status?.hourly).toMatchObject({ used: 1200, limit: 5000, remaining: 3800 });
    });

    it('플래그 ON: 0 은 무제한, NULL 칸은 전역 값', async () => {
        flags.overrides = true;
        const now = nextHour();
        overrideGet.mockResolvedValueOnce({ hourly_token_limit: 0, weekly_token_limit: null, monthly_cost_budget_micros: null });
        await expect(reserveUserQuota('u-unl', 999_999, now)).resolves.toBeTruthy();
        overrideGet.mockResolvedValueOnce({ hourly_token_limit: null, weekly_token_limit: null, monthly_cost_budget_micros: null });
        await expect(reserveUserQuota('u-null', 1200, now)).rejects.toMatchObject({ limit: 1000 });
    });

    it('플래그 ON: 조회 실패는 전역 한도(덜 막는 쪽으로 새지 않는다)', async () => {
        flags.overrides = true;
        overrideGet.mockRejectedValue(new Error('db down'));
        await expect(reserveUserQuota('u-err', 1200, nextHour())).rejects.toMatchObject({ limit: 1000 });
    });

    it('플래그 ON: 월 비용 예산도 사용자 값을 따른다', async () => {
        flags.overrides = true;
        const now = nextHour();
        overrideGet.mockResolvedValue({ hourly_token_limit: null, weekly_token_limit: null, monthly_cost_budget_micros: 100 });
        await getKeyValueStore().set(costMonthKey('u-cost', now), 100, 60_000);
        await expect(checkUserCostBudget('u-cost', now)).rejects.toMatchObject({ quotaType: 'cost_monthly', limit: 100 });
    });
});

describe('조직·비용 grant (QUOTA_ORG_GRANTS_ENABLED)', () => {
    it('조직 예산 1000 · 사용 1000: OFF 면 거절, ON + 조직 grant 500 이면 통과', async () => {
        const now = nextHour();
        listBudgetedOrgsForUser.mockResolvedValue([{ orgId: 'og1', budget: 1000, costBudgetMicros: 0, memberIds: ['g-a'] }]);
        await recordUserUsage('g-a', 1000, now);
        await expect(checkOrgBudget('g-a', now)).rejects.toMatchObject({ quotaType: 'org_monthly', limit: 1000 });
        expect(sumGrants).not.toHaveBeenCalled();
        flags.orgGrants = true;
        sumGrants.mockResolvedValue(500);
        await expect(checkOrgBudget('g-a', now)).resolves.toBeUndefined();
        expect(sumGrants).toHaveBeenCalledWith('org', 'og1', 'tokens', 'monthly', expect.any(String));
    });

    it('사용자 비용 grant 가 월 비용 예산에 더해진다', async () => {
        const now = nextHour();
        cfg.userMonthlyCostBudgetMicros = 100;
        await getKeyValueStore().set(costMonthKey('g-c', now), 120, 60_000);
        await expect(checkUserCostBudget('g-c', now)).rejects.toMatchObject({ limit: 100 });
        flags.orgGrants = true;
        sumGrants.mockResolvedValue(50);
        await expect(checkUserCostBudget('g-c', now)).resolves.toBeUndefined();
        expect(sumGrants).toHaveBeenCalledWith('user', 'g-c', 'cost_micros', 'monthly', expect.any(String));
    });
});

describe('조직 자체 월 버킷 (QUOTA_ORG_BUCKET_ENABLED)', () => {
    beforeEach(() => { cfg.llmHourlyTokenLimit = 0; });

    it('OFF: 조직 버킷 키를 만들지 않는다(종전 멤버 합산)', async () => {
        const now = nextHour();
        listBudgetedOrgsForUser.mockResolvedValue([{ orgId: 'ob0', budget: 10_000, costBudgetMicros: 0, memberIds: ['b-0'] }]);
        await reserveUserQuota('b-0', 300, now);
        expect(await getKeyValueStore().get(orgMonthKey('ob0', now))).toBeFalsy();
    });

    it('활성 조직에만 쌓고, 다른 소속 조직 사용량은 이 요청을 막지 않는다(중복 집계 없음)', async () => {
        flags.orgBucket = true;
        const now = nextHour();
        listBudgetedOrgsForUser.mockResolvedValue([
            { orgId: 'ob1', budget: 1000, costBudgetMicros: 0, memberIds: ['b-a', 'b-x'] },
            { orgId: 'ob2', budget: 1000, costBudgetMicros: 0, memberIds: ['b-a'] },
        ]);
        listMembershipsForUser.mockResolvedValue([{ orgId: 'ob1', role: 'member' }, { orgId: 'ob2', role: 'member' }]);
        getPreferences.mockResolvedValue({ activeOrgId: 'ob2' });
        await getKeyValueStore().set(orgMonthKey('ob1', now), 5000, 60_000); // ob1 은 이미 초과 — 활성이 아니라 무관
        await expect(reserveUserQuota('b-a', 400, now)).resolves.toBeTruthy();
        expect(await getKeyValueStore().get(orgMonthKey('ob2', now))).toBe(400);
        expect(await getKeyValueStore().get(orgMonthKey('ob1', now))).toBe(5000);
    });

    it('조직 버킷이 예산 이상이면 거절하고 예약분을 환불한다', async () => {
        flags.orgBucket = true;
        const now = nextHour();
        listBudgetedOrgsForUser.mockResolvedValue([{ orgId: 'ob3', budget: 1000, costBudgetMicros: 0, memberIds: ['b-b'] }]);
        listMembershipsForUser.mockResolvedValue([{ orgId: 'ob3', role: 'member' }]);
        await getKeyValueStore().set(orgMonthKey('ob3', now), 900, 60_000);
        await expect(reserveUserQuota('b-b', 200, now)).rejects.toMatchObject({ quotaType: 'org_monthly', limit: 1000 });
        expect(await getKeyValueStore().get(orgMonthKey('ob3', now))).toBe(900);
    });

    it('정산이 조직 버킷도 실측으로 맞춘다', async () => {
        flags.orgBucket = true;
        const now = nextHour();
        listBudgetedOrgsForUser.mockResolvedValue([{ orgId: 'ob4', budget: 100_000, costBudgetMicros: 0, memberIds: ['b-c'] }]);
        listMembershipsForUser.mockResolvedValue([{ orgId: 'ob4', role: 'member' }]);
        const r = await reserveUserQuota('b-c', 500, now);
        await settleUserQuota(r, 120);
        expect(await getKeyValueStore().get(orgMonthKey('ob4', now))).toBe(120);
    });

    it('활성 조직이 없으면 가입이 가장 이른 예산 조직 하나', async () => {
        flags.orgBucket = true;
        listBudgetedOrgsForUser.mockResolvedValue([
            { orgId: 'late', budget: 10, costBudgetMicros: 0, memberIds: ['b-d'] },
            { orgId: 'early', budget: 10, costBudgetMicros: 0, memberIds: ['b-d'] },
        ]);
        listMembershipsForUser.mockResolvedValue([{ orgId: 'nobudget', role: 'member' }, { orgId: 'early', role: 'member' }, { orgId: 'late', role: 'member' }]);
        await expect(chargeOrgFor('b-d', nextHour())).resolves.toMatchObject({ orgId: 'early' });
    });

    it('멤버가 빠져도(멤버 목록에서 사라져도) 조직 버킷의 사용분은 남는다', async () => {
        flags.orgBucket = true;
        const now = nextHour();
        listBudgetedOrgsForUser.mockResolvedValue([{ orgId: 'ob5', budget: 1000, costBudgetMicros: 0, memberIds: ['b-e'] }]);
        listMembershipsForUser.mockResolvedValue([{ orgId: 'ob5', role: 'member' }]);
        await recordUserUsage('b-e', 1000, now);
        clearOrgBudgetCache();
        // b-e 탈퇴 → 남은 멤버 b-f 의 요청은 조직 버킷 1000 으로 막힌다(멤버 합산이면 0 이라 통과했다)
        listBudgetedOrgsForUser.mockResolvedValue([{ orgId: 'ob5', budget: 1000, costBudgetMicros: 0, memberIds: ['b-f'] }]);
        await expect(checkOrgBudget('b-f', now)).rejects.toMatchObject({ quotaType: 'org_monthly', used: 1000 });
    });
});
