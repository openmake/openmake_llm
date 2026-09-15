/**
 * 조직 월 토큰 예산(127) — 멤버 합산 사용량이 예산 이상이면 QuotaExceededError('org_monthly').
 * KV 는 기본 memory 백엔드, 조직 조회는 mock.
 */
const listBudgetedOrgsForUser = jest.fn(async (_userId: string) => [] as Array<{ orgId: string; budget: number; memberIds: string[] }>);
jest.mock('../../data/repositories/organization-repository', () => ({
    OrganizationRepository: jest.fn().mockImplementation(() => ({ listBudgetedOrgsForUser })),
}));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));

import { checkOrgBudget, recordUserUsage, clearOrgBudgetCache } from '../user-quota';
import { QuotaExceededError } from '../../errors/quota-exceeded.error';

const NOW = Date.UTC(2026, 8, 16, 12, 0, 0);

describe('checkOrgBudget', () => {
    beforeEach(() => { clearOrgBudgetCache(); listBudgetedOrgsForUser.mockReset(); });

    it('조직이 없으면 통과', async () => {
        listBudgetedOrgsForUser.mockResolvedValue([]);
        await expect(checkOrgBudget('u-none', NOW)).resolves.toBeUndefined();
    });

    it('멤버 합산 월 사용량이 예산 이상이면 org_monthly 로 거부, 미만이면 통과', async () => {
        listBudgetedOrgsForUser.mockResolvedValue([{ orgId: 'o1', budget: 1000, memberIds: ['u-a', 'u-b'] }]);
        await recordUserUsage('u-a', 600, NOW);
        await recordUserUsage('u-b', 300, NOW);
        await expect(checkOrgBudget('u-a', NOW)).resolves.toBeUndefined(); // 900 < 1000
        await recordUserUsage('u-b', 100, NOW);                             // 1000
        await expect(checkOrgBudget('u-a', NOW)).rejects.toMatchObject({ quotaType: 'org_monthly', used: 1000, limit: 1000 });
        await expect(checkOrgBudget('u-b', NOW)).rejects.toBeInstanceOf(QuotaExceededError);
    });

    it('다른 달 사용량은 합산하지 않는다', async () => {
        listBudgetedOrgsForUser.mockResolvedValue([{ orgId: 'o2', budget: 500, memberIds: ['u-c'] }]);
        await recordUserUsage('u-c', 900, Date.UTC(2026, 7, 31, 23, 0, 0)); // 8월
        await expect(checkOrgBudget('u-c', NOW)).resolves.toBeUndefined();
    });

    it('조직 조회 실패는 fail-open', async () => {
        listBudgetedOrgsForUser.mockRejectedValue(new Error('db down'));
        await expect(checkOrgBudget('u-d', NOW)).resolves.toBeUndefined();
    });

    it('멤버십은 60초 캐시 — clearOrgBudgetCache 후 다시 조회', async () => {
        listBudgetedOrgsForUser.mockResolvedValue([]);
        await checkOrgBudget('u-e', NOW);
        await checkOrgBudget('u-e', NOW + 1000);
        expect(listBudgetedOrgsForUser).toHaveBeenCalledTimes(1);
        clearOrgBudgetCache();
        await checkOrgBudget('u-e', NOW + 2000);
        expect(listBudgetedOrgsForUser).toHaveBeenCalledTimes(2);
    });
});
