/**
 * 외부 리뷰 A1 — 조직 축의 **하위** 조회(사용자 preferences·멤버십·조직 정책)가 실패하면 사용권은 state-unknown 이다.
 *
 * 종전엔 하위 조회가 오류를 삼켜 "조직 없음"·빈 정책을 돌려줬고, 그 결과 allowlist 가 없는 것으로 읽혀 'ok' 가 됐다
 * (멤버십 실패의 "조직 없음"은 60초 캐시까지 됐다). 판정 함수를 직접 mock 하던 단위 테스트는 이 흡수를 볼 수 없어,
 * 여기서는 effective-policy·membership-cache 를 실제로 지나고 저장소만 실패시킨다.
 */
const getPreferences = jest.fn();
const listMembershipsForUser = jest.fn();
const listOrgPolicies = jest.fn();
const listStateRows = jest.fn();
jest.mock('../../../data/repositories/user-repository', () => ({
    UserRepository: jest.fn().mockImplementation(() => ({ getPreferences })),
}));
jest.mock('../../../data/repositories/organization-repository', () => ({
    OrganizationRepository: jest.fn().mockImplementation(() => ({ listMembershipsForUser, listBudgetedOrgsForUser: jest.fn(async () => []) })),
}));
jest.mock('../../../data/repositories/organization-policy-repository', () => ({
    OrganizationPolicyRepository: jest.fn().mockImplementation(() => ({ list: listOrgPolicies })),
}));
jest.mock('../../../data/repositories/addon-state-repository', () => ({
    AddonStateRepository: jest.fn().mockImplementation(() => ({ list: listStateRows })),
}));
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}), getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));

import { checkAddonEntitlement } from '../entitlement';
import { __resetAddonStateCacheForTest } from '../addon-state';
import { clearOrgMembershipCache } from '../../org/membership-cache';
import { clearOrgPolicyCache, resolveEffectivePolicy } from '../../org/effective-policy';

const DOWN = new Error('db down');
const member = { orgId: 'org1', name: 'org1', slug: 'org1', role: 'member' as const, monthlyTokenBudget: null };
// 조직 org1 은 'other-pack' 만 허용한다 — industry-pack 은 조직 허용 목록 밖
const allowlistRows = [{ key: 'ADDON_ALLOWLIST', value: ['other-pack'] }];

beforeEach(() => {
    jest.clearAllMocks();
    __resetAddonStateCacheForTest();
    clearOrgMembershipCache();
    clearOrgPolicyCache();
    listStateRows.mockResolvedValue([{ addon_id: 'industry-pack', state: 'enabled' }]);
    getPreferences.mockResolvedValue({ activeOrgId: 'org1' });
    listMembershipsForUser.mockResolvedValue([member]);
    listOrgPolicies.mockResolvedValue(allowlistRows);
});

describe('조직 축 하위 조회 실패 → state-unknown (허용으로 읽지 않는다)', () => {
    it('정상이면 허용 목록 밖은 not-entitled (실제 조직 계층을 지난다)', async () => {
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('not-entitled');
    });

    it('사용자 preferences 조회 실패', async () => {
        getPreferences.mockRejectedValue(DOWN);
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('state-unknown');
    });

    it('멤버십 조회 실패', async () => {
        listMembershipsForUser.mockRejectedValue(DOWN);
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('state-unknown');
    });

    it('조직 정책 조회 실패', async () => {
        listOrgPolicies.mockRejectedValue(DOWN);
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('state-unknown');
    });

    it('장애 중 fail-open 호출이 만든 "조직 없음"을 캐시해 두지 않는다 — 복구 뒤 바로 허용 목록이 적용된다', async () => {
        listMembershipsForUser.mockRejectedValue(DOWN);
        // 다른 경로(외부 모델 정책 등)의 fail-open 조회 — 글로벌만 적용
        expect((await resolveEffectivePolicy('u1')).orgId).toBeNull();
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('state-unknown');
        listMembershipsForUser.mockResolvedValue([member]);
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('not-entitled');
    });
});

describe('fail-open 조회(resolveEffectivePolicy)는 종전 동작 그대로', () => {
    it('조직 정책을 못 읽으면 조직은 유지하고 글로벌 정책만 적용', async () => {
        listOrgPolicies.mockRejectedValue(DOWN);
        const p = await resolveEffectivePolicy('u1');
        expect(p.orgId).toBe('org1');
        expect(p.addonAllowlist).toBeUndefined();
    });

    it('활성 조직을 못 읽으면 조직 없음', async () => {
        getPreferences.mockRejectedValue(DOWN);
        expect((await resolveEffectivePolicy('u1')).orgId).toBeNull();
    });
});
