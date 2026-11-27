/**
 * 확장 공유·게시 add-on(§8-2 — 갤러리·공유 토글·내부 게시 라우트의 소유자)을 꺼도 Base 확장 기능이 그대로다 (무DB).
 *
 * Base 는 add-on 이름을 모르므로 그 add-on 을 매니페스트의 라우트(`/api/users/me/extensions/gallery`)로 찾는다.
 *  - env 로 끄면(`ADDON_BUILTIN_DISABLED`) 그 라우트 셋은 마운트되지 않고 코드도 불러오지 않는다
 *  - 그래도 Base 확장 목록·원본 정책(M2) 403·채팅 설치 도구(import_extension_from_git)의 원본 정책 거절이 그대로 돈다
 *  - 켜져 있으면 게이트(꺼짐 404 · 조직 allowlist 밖 403)를 지나 Base `/:id` 보다 먼저 갤러리를 답한다
 * 채팅·에이전트 작업·아티팩트는 내장 add-on 을 모두 끈 배포 테스트(all-builtin-addons-off·base-only-addons-off)가 고정한다.
 */
import { resetConfig } from '../config/env';
import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

jest.mock('../auth/middleware', () => ({
    requireAuth: (req: Request & { user?: object }, _res: Response, next: NextFunction) => {
        req.user = { id: 'u-1', userId: 'u-1', role: 'user' };
        next();
    },
    requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
    optionalAuth: (req: Request & { user?: object }, _res: Response, next: NextFunction) => {
        req.user = { id: 'u-1', userId: 'u-1', role: 'user' };
        next();
    },
}));
jest.mock('../data/models/unified-database', () => ({ getPool: () => ({}), getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));
jest.mock('../security/security-audit', () => ({ auditSecurityEvent: jest.fn(async () => undefined) }));
jest.mock('../services/org/effective-policy', () => ({ resolveEffectivePolicyStrict: jest.fn(async () => ({ extensionSource: undefined })) }));
jest.mock('../services/AuditService', () => ({ getAuditService: () => ({ logAudit: jest.fn(async () => undefined) }) }));
jest.mock('../services/org/membership-cache', () => ({ membershipsFor: jest.fn(async () => []), activeOrgFor: jest.fn(async () => null) }));

const ROW = { id: 'inst-1', user_id: 'u-1', name: 'pack', version: '1.0.0', status: 'active', visibility: 'private', org_id: null, source_hash: 'h', permissions_reviewed_by: null };
const extRepo = {
    listActiveForUser: jest.fn(async () => [ROW]),
    listShared: jest.fn(async () => [ROW]),
    getByIdForUser: jest.fn(async () => null),
};
jest.mock('../data/repositories/user-extension-repository', () => ({ UserExtensionRepository: jest.fn().mockImplementation(() => extRepo) }));
const mockGetById = jest.fn();
jest.mock('../data/repositories/extension-catalog-repository', () => ({
    ExtensionCatalogRepository: jest.fn().mockImplementation(() => ({ getById: mockGetById, listEnabled: async () => [] })),
    toPublicCatalogSource: (x: unknown) => x,
}));
const mockFetcherFactory = jest.fn();
jest.mock('../agents/git-ingest/git-fetcher', () => ({ GitFetcher: jest.fn().mockImplementation(() => mockFetcherFactory()) }));
const mockEntitlement = jest.fn(async (..._a: unknown[]) => 'entitled');
jest.mock('../services/addon/entitlement', () => ({ checkAddonEntitlement: (...a: unknown[]) => mockEntitlement(...a) }));

import { listBuiltinAddonDefs } from '../addon-host/builtin-registry';
import { addonGuard, mountAddonRoutes } from '../addon-host/routes';
import { loadAddonEntry } from '../addon-host/entry-loader';
import { createUserExtensionsController } from '../controllers/user-extensions.controller';
import { importExtensionFromGitTool } from '../tools/extension-ingest-tool';
import { errorHandler } from '../utils/error-handler';
import { resetExtensionSourcePolicyState } from '../services/extensions/source-policy';

const GALLERY = '/api/users/me/extensions/gallery';
const SHARING = listBuiltinAddonDefs().find((a) => a.manifest.entry?.routes?.some((r) => r.mountPath === GALLERY));
const SHARING_PATHS = [GALLERY, '/api/users/me/extensions/:id/visibility', '/api/marketplace'];

const KEYS = ['ADDON_BUILTIN_DISABLED', 'EXTENSION_SOURCE_POLICY_ENFORCED', 'EXTENSION_SOURCE_POLICY', 'EXTENSION_INGEST_ENABLED'] as const;
const ORIGINAL = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
function setEnv(k: (typeof KEYS)[number], v: string | undefined) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
    resetConfig();
}

/** 실제 앱 배선과 같은 순서 — add-on 라우트가 Base 확장 라우터보다 먼저 */
function baseApp(mountSharing: boolean): express.Express {
    const a = express();
    a.use(express.json());
    if (mountSharing && SHARING) {
        for (const r of SHARING.manifest.entry!.routes!) a.use(r.mountPath, addonGuard(SHARING.id), loadAddonEntry<express.Router>(SHARING, r.module));
    }
    a.use('/api/users/me/extensions', createUserExtensionsController());
    a.use(errorHandler);
    return a;
}

beforeEach(() => {
    jest.clearAllMocks();
    setEnv('EXTENSION_INGEST_ENABLED', 'true');
    setEnv('EXTENSION_SOURCE_POLICY_ENFORCED', 'true');
    setEnv('EXTENSION_SOURCE_POLICY', JSON.stringify({ deny: [{ type: 'github', repo: 'evil/*' }] }));
});
afterEach(() => {
    for (const k of KEYS) { if (ORIGINAL[k] === undefined) delete process.env[k]; else process.env[k] = ORIGINAL[k]; }
    resetConfig();
    resetExtensionSourcePolicyState();
});

it('공유·게시 라우트를 소유한 내장 add-on 이 있고 기본 켜짐이다(defaultState 생략)', () => {
    expect(SHARING).toBeDefined();
    expect(SHARING!.manifest.defaultState).toBeUndefined();
    expect(SHARING!.manifest.entry!.routes!.map((r) => r.mountPath)).toEqual(SHARING_PATHS);
});

describe('env 로 끈 배포', () => {
    beforeEach(() => setEnv('ADDON_BUILTIN_DISABLED', SHARING!.id));

    it('그 라우트 셋은 마운트되지 않는다(다른 add-on 라우트는 그대로)', () => {
        const paths: string[] = [];
        mountAddonRoutes({ use: (p: string) => { paths.push(p); } } as unknown as Application);
        for (const p of SHARING_PATHS) expect(paths).not.toContain(p);
        expect(paths).toContain('/api/addons');
    });

    it('Base 확장 목록은 그대로, 갤러리·공유 토글은 Base 에 없다(404)', async () => {
        const app = baseApp(false);
        const list = await request(app).get('/api/users/me/extensions');
        expect(list.status).toBe(200);
        expect(list.body.data.extensions.map((e: { id: string }) => e.id)).toEqual(['inst-1']);
        expect((await request(app).get(GALLERY)).status).toBe(404);
        expect((await request(app).patch('/api/users/me/extensions/inst-1/visibility').send({ visibility: 'shared' })).status).toBe(404);
        expect(extRepo.listShared).not.toHaveBeenCalled();
    });

    it('원본 정책(M2)은 그대로 강제된다 — 카탈로그 설치 403, 원격 조회 0', async () => {
        mockGetById.mockResolvedValue({ id: 'c1', url: 'https://github.com/evil/market', enabled: true, plugins: [] });
        const res = await request(baseApp(false)).post('/api/users/me/extensions/catalog/c1/install').send({ plugin: 'x' });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('EXTENSION_SOURCE_BLOCKED');
        expect(mockFetcherFactory).not.toHaveBeenCalled();
    });

    it('채팅 설치 도구도 원본 정책을 지난다 — 차단 원본은 설치 0', async () => {
        const r = await importExtensionFromGitTool.handler({ gitUrl: 'https://github.com/evil/pack' }, { userId: 'u-1', role: 'user' } as never);
        expect(r.isError).toBe(true);
        expect(r.content.map((c) => ('text' in c ? c.text : '')).join('\n')).toMatch(/EXTENSION_SOURCE_BLOCKED|차단|허용/);
        expect(mockFetcherFactory).not.toHaveBeenCalled();
    });
});

describe('켜진 배포 — 게이트를 지나 Base /:id 보다 먼저', () => {
    it('사용권이 있으면 add-on 이 갤러리를 답한다(Base /:id 의 404 가 아니다)', async () => {
        const res = await request(baseApp(true)).get(GALLERY);
        expect(res.status).toBe(200);
        expect(Object.keys(res.body.data).sort()).toEqual(['catalog', 'extensions']);
        expect(mockEntitlement).toHaveBeenCalledWith(SHARING!.id, 'u-1');
    });

    it('관리자가 끄면 404 ADDON_DISABLED, 조직 allowlist 밖이면 403 — Base 확장 목록은 영향 없음', async () => {
        const app = baseApp(true);
        mockEntitlement.mockResolvedValueOnce('disabled');
        const off = await request(app).get(GALLERY);
        expect(off.status).toBe(404);
        expect(off.body.error.code).toBe('ADDON_DISABLED');
        mockEntitlement.mockResolvedValueOnce('not-entitled');
        const denied = await request(app).post('/api/marketplace/publish').send({ pluginName: 'x' });
        expect(denied.status).toBe(403);
        expect(denied.body.error.code).toBe('ADDON_NOT_ENTITLED');
        mockEntitlement.mockResolvedValueOnce('disabled');
        expect((await request(app).patch('/api/users/me/extensions/inst-1/visibility').send({ visibility: 'shared' })).status).toBe(404);
        mockEntitlement.mockClear();
        expect((await request(app).get('/api/users/me/extensions')).status).toBe(200);
        expect(mockEntitlement).not.toHaveBeenCalled();
    });
});
