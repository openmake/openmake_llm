/**
 * 확장 라우트 × 조직 배포 모드(§8-1) — 무DB.
 *  - 플래그 OFF: 목록·갤러리 응답이 종전과 바이트 단위로 같고, 제거는 판정 없이 진행(배포 저장소 미호출)
 *  - 플래그 ON: required 설치본 제거는 403 EXTENSION_REQUIRED(제거 미실행), default_on 은 제거 후 user_removed 기록,
 *    목록 행엔 org_deployment, 갤러리 조직 항목엔 deployment_mode
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { resetConfig } from '../config/env';

jest.mock('../auth/middleware', () => ({
    requireAuth: (req: Request & { user?: object }, _res: Response, next: NextFunction) => {
        req.user = { id: 'u-1', userId: 'u-1', role: 'user' };
        next();
    },
    requireAdmin: (_req: Request, res: Response) => { res.status(403).json({}); },
}));
jest.mock('../data/models/unified-database', () => ({ getPool: () => ({}) }));

const ROW = { id: 'inst-1', user_id: 'u-1', name: 'pack', version: '1.0.0', status: 'active', visibility: 'private', org_id: null, source_hash: 'h', permissions_reviewed_by: null };
const ORG_ROW = { ...ROW, id: 'src-1', user_id: 'u-pub', visibility: 'organization', org_id: 'o1' };
const mockRemove = jest.fn();
jest.mock('../data/repositories/user-extension-repository', () => ({
    UserExtensionRepository: jest.fn().mockImplementation(() => ({
        remove: mockRemove,
        listActiveForUser: jest.fn(async () => [ROW]),
        listShared: jest.fn(async () => [ORG_ROW]),
    })),
}));
jest.mock('../data/repositories/extension-catalog-repository', () => ({
    ExtensionCatalogRepository: jest.fn().mockImplementation(() => ({ listEnabled: async () => [] })),
    toPublicCatalogSource: (x: unknown) => x,
}));
jest.mock('../services/org/membership-cache', () => ({
    membershipsFor: jest.fn(async () => [{ orgId: 'o1', role: 'member' }]),
    activeOrgFor: jest.fn(async () => ({ orgId: 'o1', orgRole: 'member' })),
}));
jest.mock('../services/addon/addon-state', () => ({ removeExtensionInstallation: jest.fn(async () => undefined) }));
jest.mock('../services/extensions/release-linked-mcp', () => ({ releaseLinkedMcpServers: jest.fn(async () => 0) }));

// 배포 저장소 — 플래그 OFF 에선 한 번도 불리면 안 된다
const depRepo = {
    findByInstalledExtension: jest.fn(),
    listMemberInputs: jest.fn(async () => [{ ...ORG_ROW, item_mode: 'required', group_modes: [] }]),
    listInstallsForUser: jest.fn(async () => [{ source_extension_id: 'src-1', user_id: 'u-1', org_id: 'o1', installed_extension_id: 'inst-1', state: 'installed' }]),
    markUserRemoved: jest.fn(async () => undefined),
};
jest.mock('../data/repositories/extension-org-deployment-repository', () => ({
    ExtensionOrgDeploymentRepository: jest.fn().mockImplementation(() => depRepo),
}));

import { createUserExtensionsController } from '../controllers/user-extensions.controller';

const FLAG = 'EXTENSION_ORG_DEPLOYMENT_MODES_ENABLED';
const ORIGINAL = process.env[FLAG];
function setFlag(on: boolean) { if (on) process.env[FLAG] = 'true'; else delete process.env[FLAG]; resetConfig(); }

function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/users/me/extensions', createUserExtensionsController());
    return a;
}

/** 종전 응답 — 배포 필드가 하나도 없는 모양 */
const { source_hash: _h, user_id: _u, permissions_reviewed_by: _p, ...PUBLIC_ROW } = ROW;
const { source_hash: _h2, user_id: _u2, permissions_reviewed_by: _p2, ...PUBLIC_ORG_ROW } = ORG_ROW;

beforeEach(() => {
    jest.clearAllMocks();
    mockRemove.mockResolvedValue({ ...ROW, status: 'removed' });
    depRepo.findByInstalledExtension.mockResolvedValue({ source_extension_id: 'src-1', user_id: 'u-1', org_id: 'o1', installed_extension_id: 'inst-1', state: 'installed' });
});
afterAll(() => { if (ORIGINAL === undefined) delete process.env[FLAG]; else process.env[FLAG] = ORIGINAL; resetConfig(); });

describe('플래그 OFF — 종전과 같다', () => {
    beforeEach(() => setFlag(false));
    test('목록·갤러리 응답 data 에 배포 필드가 없다(종전 모양 그대로)', async () => {
        const list = await request(app()).get('/api/users/me/extensions');
        expect(list.body.data).toEqual({ extensions: [PUBLIC_ROW] });
        const gallery = await request(app()).get('/api/users/me/extensions/gallery');
        expect(gallery.body.data).toEqual({ extensions: [{ ...PUBLIC_ORG_ROW, owned: false }], catalog: [] });
        for (const fn of Object.values(depRepo)) expect(fn).not.toHaveBeenCalled();
    });
    test('required 로 배포된 설치본이라도 제거된다(판정 없음)', async () => {
        const res = await request(app()).delete('/api/users/me/extensions/inst-1');
        expect(res.status).toBe(200);
        expect(mockRemove).toHaveBeenCalledWith('inst-1', 'u-1', false);
        for (const fn of Object.values(depRepo)) expect(fn).not.toHaveBeenCalled();
    });
});

describe('플래그 ON', () => {
    beforeEach(() => setFlag(true));
    test('required 설치본 제거는 403 EXTENSION_REQUIRED — 제거를 실행하지 않는다', async () => {
        const res = await request(app()).delete('/api/users/me/extensions/inst-1');
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('EXTENSION_REQUIRED');
        expect(mockRemove).not.toHaveBeenCalled();
        expect(depRepo.markUserRemoved).not.toHaveBeenCalled();
    });
    test('default_on 설치본은 제거되고 user_removed 로 기록된다', async () => {
        depRepo.listMemberInputs.mockResolvedValueOnce([{ ...ORG_ROW, item_mode: 'default_on', group_modes: [] }]);
        const res = await request(app()).delete('/api/users/me/extensions/inst-1');
        expect(res.status).toBe(200);
        expect(mockRemove).toHaveBeenCalled();
        expect(depRepo.markUserRemoved).toHaveBeenCalledWith('src-1', 'u-1');
    });
    test('배포 설치본이 아니면 종전대로 제거(기록 없음)', async () => {
        depRepo.findByInstalledExtension.mockResolvedValueOnce(null);
        const res = await request(app()).delete('/api/users/me/extensions/inst-1');
        expect(res.status).toBe(200);
        expect(depRepo.markUserRemoved).not.toHaveBeenCalled();
    });
    test('목록 행에 org_deployment, 갤러리 조직 항목에 deployment_mode', async () => {
        const list = await request(app()).get('/api/users/me/extensions');
        expect(list.body.data.extensions[0].org_deployment).toEqual({ mode: 'required', removable: false });
        const gallery = await request(app()).get('/api/users/me/extensions/gallery');
        expect(gallery.body.data.extensions[0].deployment_mode).toBe('required');
    });
});
