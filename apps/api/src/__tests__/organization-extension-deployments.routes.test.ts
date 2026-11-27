/**
 * 조직 확장 배포 모드·그룹 라우트(§8-1) — 무DB.
 *  - 플래그 OFF 면 모든 라우트 404(저장소 미호출)
 *  - 조직 owner/admin·시스템 admin 만, 일반 멤버·비멤버 403
 *  - 다른 조직의 항목·그룹 조작 403, 없는 항목 404
 *  - 저장 뒤 감사 기록·조직 조정 트리거
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { resetConfig } from '../config/env';

jest.mock('../auth/middleware', () => ({
    requireAuth: (req: Request & { user?: object }, _res: Response, next: NextFunction) => {
        const id = String(req.headers['x-user'] ?? 'u-admin-org');
        req.user = { id, userId: id, role: id === 'u-sys' ? 'admin' : 'user' };
        next();
    },
}));
jest.mock('../data/models/unified-database', () => ({ getPool: () => ({}) }));
const mockOrgGet = jest.fn();
jest.mock('../data/repositories/organization-repository', () => ({
    OrganizationRepository: jest.fn().mockImplementation(() => ({ get: mockOrgGet })),
}));
const repo = {
    listOrgItems: jest.fn(async () => [{ extension_id: 'e1', mode: 'default_off', group_modes: {} }]),
    listGroups: jest.fn(async () => []),
    listOrgMembers: jest.fn(async () => []),
    getItemScope: jest.fn(),
    getGroupOrg: jest.fn(),
    setItemMode: jest.fn(async () => undefined),
    setGroupMode: jest.fn(async () => undefined),
    countGroups: jest.fn(async () => 0),
    createGroup: jest.fn(async (id: string, orgId: string, name: string) => ({ id, org_id: orgId, name, member_ids: [] })),
    renameGroup: jest.fn(async () => true),
    deleteGroup: jest.fn(async () => true),
    addGroupMember: jest.fn(async () => undefined),
    removeGroupMember: jest.fn(async () => true),
};
jest.mock('../data/repositories/extension-org-deployment-repository', () => ({
    ExtensionOrgDeploymentRepository: jest.fn().mockImplementation(() => repo),
}));
const MEMBERSHIPS: Record<string, Array<{ orgId: string; role: string }>> = {
    'u-admin-org': [{ orgId: 'o1', role: 'admin' }],
    'u-owner-org': [{ orgId: 'o1', role: 'owner' }],
    'u-member': [{ orgId: 'o1', role: 'member' }],
    'u-other': [{ orgId: 'o2', role: 'owner' }],
};
jest.mock('../services/org/membership-cache', () => ({ membershipsFor: jest.fn(async (u: string) => MEMBERSHIPS[u] ?? []) }));
const mockAudit = jest.fn(async () => undefined);
jest.mock('../services/AuditService', () => ({ getAuditService: () => ({ logAudit: mockAudit }) }));
const mockTrigger = jest.fn();
jest.mock('../services/extensions/org-deployment', () => ({ triggerOrgReconcile: (...a: unknown[]) => mockTrigger(...a) }));

import { organizationExtensionDeploymentsRouter } from '../routes/organization-extension-deployments.routes';
import { errorHandler } from '../utils/error-handler';

const FLAG = 'EXTENSION_ORG_DEPLOYMENT_MODES_ENABLED';
const ORIGINAL = process.env[FLAG];
function setFlag(on: boolean) { if (on) process.env[FLAG] = 'true'; else delete process.env[FLAG]; resetConfig(); }

function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/organizations', organizationExtensionDeploymentsRouter);
    a.use(errorHandler);
    return a;
}

beforeEach(() => {
    jest.clearAllMocks();
    setFlag(true);
    mockOrgGet.mockImplementation(async (id: string) => (id === 'o1' || id === 'o2' ? { id } : null));
    repo.getItemScope.mockImplementation(async (id: string) =>
        id === 'e1' ? { org_id: 'o1', visibility: 'organization', status: 'active' }
            : id === 'e-other' ? { org_id: 'o2', visibility: 'organization', status: 'active' }
                : id === 'e-private' ? { org_id: null, visibility: 'private', status: 'active' } : null);
    repo.getGroupOrg.mockImplementation(async (id: string) => (id === 'g1' ? 'o1' : id === 'g-other' ? 'o2' : null));
});
afterAll(() => { if (ORIGINAL === undefined) delete process.env[FLAG]; else process.env[FLAG] = ORIGINAL; resetConfig(); });

describe('플래그 OFF', () => {
    test.each([
        ['get', '/api/organizations/o1/extension-deployments'],
        ['put', '/api/organizations/o1/extension-deployments/e1'],
        ['put', '/api/organizations/o1/extension-deployments/e1/groups/g1'],
        ['get', '/api/organizations/o1/groups'],
        ['post', '/api/organizations/o1/groups'],
        ['delete', '/api/organizations/o1/groups/g1'],
        ['put', '/api/organizations/o1/groups/g1/members/u-member'],
    ] as const)('%s %s → 404, 저장소 미호출', async (method, url) => {
        setFlag(false);
        const res = await request(app())[method](url).send({ mode: 'required', name: 'x' });
        expect(res.status).toBe(404);
        for (const fn of Object.values(repo)) expect(fn).not.toHaveBeenCalled();
        expect(mockOrgGet).not.toHaveBeenCalled();
    });
});

describe('권한', () => {
    test.each([['u-admin-org'], ['u-owner-org'], ['u-sys']])('%s 는 읽고 바꿀 수 있다', async (who) => {
        expect((await request(app()).get('/api/organizations/o1/extension-deployments').set('x-user', who)).status).toBe(200);
        const res = await request(app()).put('/api/organizations/o1/extension-deployments/e1').set('x-user', who).send({ mode: 'required' });
        expect(res.status).toBe(200);
        expect(repo.setItemMode).toHaveBeenCalledWith('e1', 'o1', 'required', who);
        expect(mockTrigger).toHaveBeenCalledWith('o1');
        expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'org.extension_deployment_changed', resourceId: 'o1' }));
    });

    test.each([['u-member'], ['u-other'], ['u-stranger']])('%s 는 403 — 읽기도 쓰기도', async (who) => {
        expect((await request(app()).get('/api/organizations/o1/extension-deployments').set('x-user', who)).status).toBe(403);
        expect((await request(app()).put('/api/organizations/o1/extension-deployments/e1').set('x-user', who).send({ mode: 'required' })).status).toBe(403);
        expect((await request(app()).post('/api/organizations/o1/groups').set('x-user', who).send({ name: 'g' })).status).toBe(403);
        expect(repo.setItemMode).not.toHaveBeenCalled();
        expect(repo.createGroup).not.toHaveBeenCalled();
    });

    test('없는 조직은 404', async () => {
        expect((await request(app()).get('/api/organizations/o9/extension-deployments')).status).toBe(404);
    });
});

describe('대상 소속', () => {
    test('다른 조직에 공개된 항목 조작은 403', async () => {
        const res = await request(app()).put('/api/organizations/o1/extension-deployments/e-other').send({ mode: 'default_on' });
        expect(res.status).toBe(403);
        expect(repo.setItemMode).not.toHaveBeenCalled();
    });
    test('조직 공개가 아닌 항목은 403, 없는 항목은 404', async () => {
        expect((await request(app()).put('/api/organizations/o1/extension-deployments/e-private').send({ mode: 'default_on' })).status).toBe(403);
        expect((await request(app()).put('/api/organizations/o1/extension-deployments/e-none').send({ mode: 'default_on' })).status).toBe(404);
    });
    test('다른 조직 그룹의 덮어쓰기·멤버 조작은 403', async () => {
        expect((await request(app()).put('/api/organizations/o1/extension-deployments/e1/groups/g-other').send({ mode: 'required' })).status).toBe(403);
        expect((await request(app()).put('/api/organizations/o1/groups/g-other/members/u-member')).status).toBe(403);
        expect((await request(app()).delete('/api/organizations/o1/groups/g-other')).status).toBe(403);
        expect(repo.setGroupMode).not.toHaveBeenCalled();
        expect(repo.addGroupMember).not.toHaveBeenCalled();
        expect(repo.deleteGroup).not.toHaveBeenCalled();
    });
    test('잘못된 mode 는 400', async () => {
        expect((await request(app()).put('/api/organizations/o1/extension-deployments/e1').send({ mode: 'always' })).status).toBe(400);
    });
    test('그룹 덮어쓰기 저장·지우기(null)', async () => {
        expect((await request(app()).put('/api/organizations/o1/extension-deployments/e1/groups/g1').send({ mode: 'default_on' })).status).toBe(200);
        expect((await request(app()).put('/api/organizations/o1/extension-deployments/e1/groups/g1').send({ mode: null })).status).toBe(200);
        expect(repo.setGroupMode).toHaveBeenNthCalledWith(1, 'e1', 'g1', 'default_on', 'u-admin-org');
        expect(repo.setGroupMode).toHaveBeenNthCalledWith(2, 'e1', 'g1', null, 'u-admin-org');
    });
    test('조직 멤버가 아닌 사용자를 그룹에 넣으면 400 (FK)', async () => {
        repo.addGroupMember.mockRejectedValueOnce(Object.assign(new Error('fk'), { code: '23503' }));
        expect((await request(app()).put('/api/organizations/o1/groups/g1/members/u-x')).status).toBe(400);
    });
    test('같은 이름 그룹은 409', async () => {
        repo.createGroup.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
        expect((await request(app()).post('/api/organizations/o1/groups').send({ name: 'dev' })).status).toBe(409);
    });
});
