/**
 * 조직 멤버십 캐시 (F22 Phase A) — 활성 조직은 preferences 값이 아니라 실제 멤버십으로 확정된다.
 */
const listMembershipsForUser = jest.fn(async (_userId: string) => [] as Array<{ orgId: string; name: string; slug: string; role: 'owner' | 'admin' | 'member'; monthlyTokenBudget: number | null }>);
const listBudgetedOrgsForUser = jest.fn(async (_userId: string) => [] as Array<{ orgId: string; budget: number; memberIds: string[] }>);
const getPreferences = jest.fn(async (_userId: string) => ({} as Record<string, unknown>));
jest.mock('../../../data/repositories/organization-repository', () => ({
    OrganizationRepository: jest.fn().mockImplementation(() => ({ listMembershipsForUser, listBudgetedOrgsForUser })),
}));
jest.mock('../../../data/repositories/user-repository', () => ({
    UserRepository: jest.fn().mockImplementation(() => ({ getPreferences })),
}));
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}) }));

import { activeOrgFor, membershipsFor, budgetedOrgsFor, resolveActiveOrg, clearOrgMembershipCache } from '../membership-cache';

const M = (orgId: string, role: 'owner' | 'admin' | 'member' = 'member') => ({ orgId, name: orgId, slug: orgId, role, monthlyTokenBudget: null });

describe('resolveActiveOrg (PURE)', () => {
    it('멤버인 조직만 활성으로 인정하고 역할을 싣는다', () => {
        expect(resolveActiveOrg('o1', [M('o1', 'admin')])).toEqual({ orgId: 'o1', orgRole: 'admin' });
    });
    it('멤버가 아니거나 값이 비면 null', () => {
        expect(resolveActiveOrg('o9', [M('o1')])).toBeNull();
        expect(resolveActiveOrg(undefined, [M('o1')])).toBeNull();
        expect(resolveActiveOrg('', [M('o1')])).toBeNull();
        expect(resolveActiveOrg(42, [M('o1')])).toBeNull();
    });
});

describe('activeOrgFor / 캐시', () => {
    beforeEach(() => { clearOrgMembershipCache(); listMembershipsForUser.mockReset(); getPreferences.mockReset(); listBudgetedOrgsForUser.mockReset(); });

    it('guest·미인증은 DB 를 치지 않고 null', async () => {
        expect(await activeOrgFor(undefined)).toBeNull();
        expect(await activeOrgFor('guest')).toBeNull();
        expect(getPreferences).not.toHaveBeenCalled();
    });

    it('preferences.activeOrgId 가 멤버십에 있으면 컨텍스트, TTL 안에서는 재조회하지 않는다', async () => {
        getPreferences.mockResolvedValue({ activeOrgId: 'o1' });
        listMembershipsForUser.mockResolvedValue([M('o1', 'owner')]);
        const now = 1_000_000;
        expect(await activeOrgFor('u1', now)).toEqual({ orgId: 'o1', orgRole: 'owner' });
        expect(await activeOrgFor('u1', now + 1000)).toEqual({ orgId: 'o1', orgRole: 'owner' });
        expect(getPreferences).toHaveBeenCalledTimes(1);
        expect(listMembershipsForUser).toHaveBeenCalledTimes(1);
    });

    it('preferences 가 가리켜도 멤버가 아니면 null (탈퇴 후 잔존값 무시)', async () => {
        getPreferences.mockResolvedValue({ activeOrgId: 'o1' });
        listMembershipsForUser.mockResolvedValue([M('o2')]);
        expect(await activeOrgFor('u1')).toBeNull();
    });

    it('clearOrgMembershipCache(userId) 는 그 사용자만 비운다', async () => {
        getPreferences.mockResolvedValue({ activeOrgId: 'o1' });
        listMembershipsForUser.mockResolvedValue([M('o1')]);
        await activeOrgFor('u1'); await activeOrgFor('u2');
        clearOrgMembershipCache('u1');
        await activeOrgFor('u1'); await activeOrgFor('u2');
        expect(getPreferences).toHaveBeenCalledTimes(3);
    });

    it('조회 실패는 fail-open(null / 빈 목록)', async () => {
        getPreferences.mockRejectedValue(new Error('db down'));
        listMembershipsForUser.mockRejectedValue(new Error('db down'));
        listBudgetedOrgsForUser.mockRejectedValue(new Error('db down'));
        expect(await activeOrgFor('u1')).toBeNull();
        expect(await membershipsFor('u1')).toEqual([]);
        expect(await budgetedOrgsFor('u1')).toEqual([]);
    });
});
