/**
 * 큐레이션 add-on — 갤러리·갤러리 설치·공유 토글 (§8-2 이전, 무DB).
 * 종전 Base 라우트(`controllers/user-extensions.controller`)와 같은 경로·같은 응답을 고정한다:
 *  - 갤러리: 타인 user_id·내부 필드 비노출 + owned, 카탈로그는 enabled 원본만(조회 실패는 fail-open),
 *    installPreview 는 EXTENSION_INSTALL_PREVIEW_ENABLED 일 때만, deployment_mode 는 EXTENSION_ORG_DEPLOYMENT_MODES_ENABLED 일 때만
 *  - 갤러리 설치: 설치 판정 밖 404, 원본 정책 거절 403(전역 errorHandler), 그 밖 실패 400
 *  - 공유 토글: organization 은 활성 조직에만, 없는 확장 404
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { resetConfig } from '../../../config/env';

jest.mock('../../../auth/middleware', () => ({
    requireAuth: (req: Request & { user?: object }, _res: Response, next: NextFunction) => {
        req.user = { id: 'u-1', userId: 'u-1', role: 'user' };
        next();
    },
}));
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}) }));

const ROW = { id: 'inst-1', user_id: 'u-1', name: 'pack', version: '1.0.0', status: 'active', visibility: 'shared', org_id: null, source_hash: 'h', permissions_reviewed_by: null, source_url: 'https://github.com/a/pack', source_path: '.claude-plugin/plugin.json', tracking_ref: null };
const ORG_ROW = { ...ROW, id: 'src-1', user_id: 'u-pub', visibility: 'organization', org_id: 'o1' };
const repo = {
    listShared: jest.fn(async () => [ROW, ORG_ROW]),
    getInstallableById: jest.fn(),
    setVisibility: jest.fn(),
};
jest.mock('../../../data/repositories/user-extension-repository', () => ({ UserExtensionRepository: jest.fn().mockImplementation(() => repo) }));
const CATALOG = { id: 'c1', url: 'https://github.com/org/market', name: 'market', description: 'd', plugins: [{ name: 'p' }], last_synced_at: '2026-11-01T00:00:00.000Z', access_token_enc: 'secret', alias: 'm' };
const mockListEnabled = jest.fn(async () => [CATALOG]);
jest.mock('../../../data/repositories/extension-catalog-repository', () => ({
    ExtensionCatalogRepository: jest.fn().mockImplementation(() => ({ listEnabled: mockListEnabled })),
}));
const mockActiveOrg = jest.fn();
jest.mock('../../../services/org/membership-cache', () => ({
    membershipsFor: jest.fn(async () => [{ orgId: 'o1', role: 'member' }]),
    activeOrgFor: (...a: unknown[]) => mockActiveOrg(...a),
}));
const depRepo = {
    listMemberInputs: jest.fn(async () => [{ ...ORG_ROW, item_mode: 'required', group_modes: [] }]),
    listInstallsForUser: jest.fn(async () => []),
};
jest.mock('../../../data/repositories/extension-org-deployment-repository', () => ({
    ExtensionOrgDeploymentRepository: jest.fn().mockImplementation(() => depRepo),
}));
const mockInstall = jest.fn();
jest.mock('../../../services/extensions/shared-install', () => ({ installSharedExtension: (...a: unknown[]) => mockInstall(...a) }));

import { createGalleryRouter, createVisibilityRouter } from '../gallery-routes';
import { errorHandler } from '../../../utils/error-handler';
import { ExtensionSourceBlockedError } from '../../../errors/extension-source-blocked.error';

const KEYS = ['EXTENSION_INSTALL_PREVIEW_ENABLED', 'EXTENSION_ORG_DEPLOYMENT_MODES_ENABLED'] as const;
const ORIGINAL = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
function setEnv(k: (typeof KEYS)[number], v: string | undefined) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
    resetConfig();
}

function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/users/me/extensions/gallery', createGalleryRouter());
    a.use('/api/users/me/extensions/:id/visibility', createVisibilityRouter());
    a.use(errorHandler);
    return a;
}

const strip = ({ source_hash: _h, user_id: _u, permissions_reviewed_by: _p, ...rest }: Record<string, unknown>) => rest;

beforeEach(() => {
    jest.clearAllMocks();
    for (const k of KEYS) setEnv(k, undefined);
});
afterAll(() => {
    for (const k of KEYS) { if (ORIGINAL[k] === undefined) delete process.env[k]; else process.env[k] = ORIGINAL[k]; }
    resetConfig();
});

describe('GET /gallery', () => {
    it('종전 응답 모양 — 내부 필드 없이 owned, 카탈로그는 공개 필드만(토큰 암호문·별칭 없음), 플래그 필드 없음', async () => {
        const res = await request(app()).get('/api/users/me/extensions/gallery');
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({
            extensions: [{ ...strip(ROW), owned: true }, { ...strip(ORG_ROW), owned: false }],
            catalog: [{ id: 'c1', url: CATALOG.url, name: 'market', description: 'd', plugins: [{ name: 'p' }], last_synced_at: CATALOG.last_synced_at }],
        });
        expect(repo.listShared).toHaveBeenCalledWith(undefined, ['o1']);
        for (const fn of Object.values(depRepo)) expect(fn).not.toHaveBeenCalled();
    });

    it('카탈로그 조회가 실패해도 갤러리는 응답한다(fail-open)', async () => {
        mockListEnabled.mockRejectedValueOnce(new Error('db down'));
        const res = await request(app()).get('/api/users/me/extensions/gallery');
        expect(res.status).toBe(200);
        expect(res.body.data.catalog).toEqual([]);
        expect(res.body.data.extensions).toHaveLength(2);
    });

    it('설치 미리보기가 켜지면 installPreview:true', async () => {
        setEnv('EXTENSION_INSTALL_PREVIEW_ENABLED', 'true');
        const res = await request(app()).get('/api/users/me/extensions/gallery');
        expect(res.body.data.installPreview).toBe(true);
    });

    it('조직 배포 모드가 켜지면 조직 항목에 deployment_mode', async () => {
        setEnv('EXTENSION_ORG_DEPLOYMENT_MODES_ENABLED', 'true');
        mockActiveOrg.mockResolvedValueOnce({ orgId: 'o1', orgRole: 'member' });
        const res = await request(app()).get('/api/users/me/extensions/gallery');
        expect(res.body.data.extensions[1].deployment_mode).toBe('required');
        expect(res.body.data.extensions[0].deployment_mode).toBeUndefined();
    });
});

describe('POST /gallery/:id/install', () => {
    it('설치 판정 밖이면 404 이고 설치하지 않는다', async () => {
        repo.getInstallableById.mockResolvedValueOnce(null);
        const res = await request(app()).post('/api/users/me/extensions/gallery/x/install').send({});
        expect(res.status).toBe(404);
        expect(mockInstall).not.toHaveBeenCalled();
    });

    it('설치 결과 요약을 낸다(deduped = upToDate)', async () => {
        repo.getInstallableById.mockResolvedValueOnce(ORG_ROW);
        mockInstall.mockResolvedValueOnce({ extensionId: 'e9', name: 'pack', version: '1.0.0', deduped: true, skills: [], mcpServers: [], agents: [], validationWarnings: [] });
        const res = await request(app()).post('/api/users/me/extensions/gallery/src-1/install').send({ accessToken: 't' });
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ extensionId: 'e9', name: 'pack', version: '1.0.0', updated: false, upToDate: true, skills: [], mcpServers: [], agents: [], validationWarnings: [] });
        expect(repo.getInstallableById).toHaveBeenCalledWith('src-1', 'u-1', ['o1']);
        expect(mockInstall).toHaveBeenCalledWith(ORG_ROW, 'u-1', { isAdmin: false, accessToken: 't' });
    });

    it('원본 정책 거절은 403 EXTENSION_SOURCE_BLOCKED, 그 밖 실패는 400', async () => {
        repo.getInstallableById.mockResolvedValue(ORG_ROW);
        mockInstall.mockRejectedValueOnce(new ExtensionSourceBlockedError({ code: 'EXTENSION_SOURCE_BLOCKED', message: 'blocked', source: { type: 'github', value: 'a/pack' } } as never));
        const blocked = await request(app()).post('/api/users/me/extensions/gallery/src-1/install').send({});
        expect(blocked.status).toBe(403);
        expect(blocked.body.error.code).toBe('EXTENSION_SOURCE_BLOCKED');
        mockInstall.mockRejectedValueOnce(new Error('repo gone'));
        const failed = await request(app()).post('/api/users/me/extensions/gallery/src-1/install').send({});
        expect(failed.status).toBe(400);
        expect(failed.body.error.message).toContain('갤러리 설치 실패: repo gone');
        repo.getInstallableById.mockReset();
    });
});

describe('PATCH /:id/visibility', () => {
    it('organization 공개는 활성 조직이 없으면 400 — 저장하지 않는다', async () => {
        mockActiveOrg.mockResolvedValueOnce(null);
        const res = await request(app()).patch('/api/users/me/extensions/inst-1/visibility').send({ visibility: 'organization' });
        expect(res.status).toBe(400);
        expect(repo.setVisibility).not.toHaveBeenCalled();
    });

    it('활성 조직에 공개 — 경로의 id 와 요청자의 활성 조직으로 저장', async () => {
        mockActiveOrg.mockResolvedValueOnce({ orgId: 'o1', orgRole: 'member' });
        repo.setVisibility.mockResolvedValueOnce({ ...ROW, visibility: 'organization', org_id: 'o1' });
        const res = await request(app()).patch('/api/users/me/extensions/inst-1/visibility').send({ visibility: 'organization' });
        expect(res.status).toBe(200);
        expect(repo.setVisibility).toHaveBeenCalledWith('inst-1', 'u-1', 'organization', 'o1');
        expect(res.body.data.extension).toEqual({ ...strip(ROW), visibility: 'organization', org_id: 'o1' });
    });

    it('없는(남의) 확장은 404, 잘못된 값은 400', async () => {
        repo.setVisibility.mockResolvedValueOnce(null);
        expect((await request(app()).patch('/api/users/me/extensions/zz/visibility').send({ visibility: 'private' })).status).toBe(404);
        expect(repo.setVisibility).toHaveBeenCalledWith('zz', 'u-1', 'private', null);
        expect((await request(app()).patch('/api/users/me/extensions/zz/visibility').send({ visibility: 'public' })).status).toBe(400);
    });
});
