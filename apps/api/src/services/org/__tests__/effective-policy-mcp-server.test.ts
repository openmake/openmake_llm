/**
 * 조직 정책 EXTENSION_MCP_SERVER_POLICY(§8-3) 가 유효 정책까지 실려 오는지 — 행 파싱 → 병합 → resolveEffectivePolicyStrict.
 */
jest.mock('../membership-cache', () => ({
    activeOrgForStrict: jest.fn(async () => ({ orgId: 'org-1', orgRole: 'member' })),
    membershipsForStrict: jest.fn(async () => []),
}));
const listMock = jest.fn();
jest.mock('../../../data/repositories/organization-policy-repository', () => ({
    OrganizationPolicyRepository: jest.fn().mockImplementation(() => ({ list: listMock })),
}));
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}) }));

import { resolveEffectivePolicyStrict, clearOrgPolicyCache } from '../effective-policy';

describe('조직 MCP 서버 정책 → 유효 정책', () => {
    beforeEach(() => { clearOrgPolicyCache(); listMock.mockReset(); });

    it('조직 행의 매처가 extensionMcpServer 층(scope organization)으로 실린다', async () => {
        listMock.mockResolvedValue([{ key: 'EXTENSION_MCP_SERVER_POLICY', value: { allow: [{ type: 'url', url: 'https://mcp.example.com' }], deny: [] } }]);
        const p = await resolveEffectivePolicyStrict('u1');
        expect(p.extensionMcpServer).toEqual({ allow: [{ type: 'url', url: 'https://mcp.example.com' }], deny: [], scope: 'organization' });
    });

    it('깨진 조직 값은 전부 차단 층(broken)', async () => {
        listMock.mockResolvedValue([{ key: 'EXTENSION_MCP_SERVER_POLICY', value: { allow: 'x' } }]);
        const p = await resolveEffectivePolicyStrict('u1');
        expect(p.extensionMcpServer).toMatchObject({ allow: [], deny: [], broken: true, scope: 'organization' });
    });

    it('조직 행이 없으면 층 없음', async () => {
        listMock.mockResolvedValue([]);
        const p = await resolveEffectivePolicyStrict('u1');
        expect(p.extensionMcpServer).toBeUndefined();
    });
});
