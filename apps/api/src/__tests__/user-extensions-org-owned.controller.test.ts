/**
 * 조직 소유 확장 라우트(P8, 212) — 플래그 OFF 면 라우트가 없는 것과 같다(다음 라우트 '/:id' 등의 종전 응답, 서비스·멤버십 호출 0),
 * ON 이면 활성 조직 관리자 설치 201 · 멤버 403 · 다른 조직 행 404. 응답에 설치자 id·내부 해시가 없다.
 * 사람 소유 행의 응답 모양은 212 열(owner_org_id·installed_by_user_id)이 붙어도 종전과 같다(toPublic).
 */
import { resetConfig } from '../config/env';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

jest.mock('../auth/middleware', () => ({
    requireAuth: (req: Request & { user?: object }, _res: Response, next: NextFunction) => {
        req.user = { id: 'u-1', userId: 'u-1', role: 'user' };
        next();
    },
    requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
const mockQuery = jest.fn();
jest.mock('../data/models/unified-database', () => ({ getPool: () => ({ query: mockQuery }), getUnifiedDatabase: () => ({ getPool: () => ({ query: mockQuery }) }) }));
const mockActiveOrg = jest.fn();
jest.mock('../services/org/membership-cache', () => ({
    activeOrgFor: (...a: unknown[]) => mockActiveOrg(...a),
    membershipsFor: async () => [],
}));
const mockLogAudit = jest.fn(async () => undefined);
jest.mock('../services/AuditService', () => ({ getAuditService: () => ({ logAudit: mockLogAudit }) }));
const mockResolve = jest.fn();
jest.mock('../services/extensions/ingest-service-factory', () => ({
    buildExtensionIngestService: async () => ({ resolveSource: mockResolve }),
}));

import { createUserExtensionsController } from '../controllers/user-extensions.controller';
import { errorHandler } from '../utils/error-handler';

const FLAG = 'EXTENSION_ORG_OWNED_INSTALL_ENABLED';
const ORIGINAL = process.env[FLAG];

function app(): express.Express {
    const a = express();
    a.use(express.json());
    a.use('/api/users/me/extensions', createUserExtensionsController());
    a.use(errorHandler);
    return a;
}
function setFlag(v: string | undefined) {
    if (v === undefined) delete process.env[FLAG]; else process.env[FLAG] = v;
    resetConfig();
}

const ORG_ROW = {
    id: 'ext-org-1', user_id: null, owner_org_id: 'org-a', installed_by_user_id: 'u-9', visibility: 'organization', org_id: 'org-a',
    name: 'acme-pack', version: '1.0.0', description: null, source_url: 'https://github.com/acme/pack', source_ref: 'a'.repeat(40),
    source_path: '.claude-plugin/plugin.json', source_hash: 'sha256:x', tracking_ref: 'main', manifest: {}, status: 'active',
    permissions_reviewed_by: null,
};

beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});
afterAll(() => setFlag(ORIGINAL));

describe('플래그 OFF — 종전과 같다', () => {
    beforeEach(() => setFlag(undefined));

    it.each([
        ['get', '/api/users/me/extensions/org-owned'],
        ['delete', '/api/users/me/extensions/org-owned'],
    ] as const)('%s %s 는 다음 라우트(/:id)의 종전 응답', async (method, path) => {
        const res = await request(app())[method](path).send({});
        // '/:id' 가 id='org-owned' 를 개인 소유 조회 → 없음 404 (종전 응답 그대로)
        expect(res.status).toBe(404);
        // 없는 개인 id 에 대한 종전 응답과 바이트 단위로 같다
        const baseline = await request(app())[method]('/api/users/me/extensions/no-such-id').send({});
        expect(res.status).toBe(baseline.status);
        const strip = (t: string) => t.replace(/"timestamp":"[^"]+"/, '"timestamp":"-"');
        expect(strip(res.text)).toBe(strip(baseline.text));
        expect(mockActiveOrg).not.toHaveBeenCalled();
        expect(mockResolve).not.toHaveBeenCalled();
        // 조직 소유 저장소 SQL 이 한 번도 돌지 않는다
        expect(mockQuery.mock.calls.some((c) => /owner_org_id/.test(String(c[0])))).toBe(false);
    });

    it('POST /org-owned 는 라우트 없음(404) — 설치·감사 없음', async () => {
        const res = await request(app()).post('/api/users/me/extensions/org-owned').send({ gitUrl: 'https://github.com/acme/pack' });
        expect(res.status).toBe(404);
        expect(mockResolve).not.toHaveBeenCalled();
        expect(mockLogAudit).not.toHaveBeenCalled();
    });

    it('개인 행 응답에 212 열이 붙어도 모양이 같다(owner_org_id·installed_by_user_id·orgOwned 없음)', async () => {
        const personal = { ...ORG_ROW, id: 'ext-p', user_id: 'u-1', owner_org_id: null, installed_by_user_id: null, visibility: 'private', org_id: null };
        mockQuery.mockImplementation(async (sql: string) => (/FROM user_extensions/.test(sql) && /WHERE id/.test(sql) ? { rows: [personal] } : { rows: [] }));
        const res = await request(app()).get('/api/users/me/extensions/ext-p');
        expect(res.status).toBe(200);
        const ext = res.body.data.extension;
        expect(ext).not.toHaveProperty('owner_org_id');
        expect(ext).not.toHaveProperty('installed_by_user_id');
        expect(ext).not.toHaveProperty('orgOwned');
        expect(ext).not.toHaveProperty('user_id');
        expect(ext).not.toHaveProperty('source_hash');
    });
});

describe('플래그 ON', () => {
    beforeEach(() => setFlag('true'));

    it('조직 admin 설치 → 201, 행은 조직 소유·설치자 id 비노출, 감사 1건', async () => {
        mockActiveOrg.mockResolvedValue({ orgId: 'org-a', orgRole: 'admin' });
        mockResolve.mockResolvedValue({
            sha: 'a'.repeat(40), effectiveGitUrl: 'https://github.com/acme/pack', effectiveTrackingRef: 'main',
            candidate: { path: '.claude-plugin/plugin.json' }, manifest: { name: 'acme-pack', version: '1.0.0', raw: {} }, warnings: [],
        });
        mockQuery.mockImplementation(async (sql: string) => (/INSERT INTO user_extensions/.test(sql) ? { rows: [ORG_ROW] } : { rows: [] }));
        const res = await request(app()).post('/api/users/me/extensions/org-owned').send({ gitUrl: 'https://github.com/acme/pack' });
        expect(res.status).toBe(201);
        expect(res.body.data.extension).toMatchObject({ id: 'ext-org-1', orgOwned: true, owner_org_id: 'org-a' });
        expect(res.body.data.extension).not.toHaveProperty('installed_by_user_id');
        expect(res.body.data.extension).not.toHaveProperty('source_hash');
        const insert = mockQuery.mock.calls.find((c) => /INSERT INTO user_extensions/.test(String(c[0])));
        expect((insert?.[1] as unknown[]).slice(1, 3)).toEqual(['org-a', 'u-1']);
        expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'extension.org_owned_installed', userId: 'u-1', resourceId: 'ext-org-1' }));
    });

    it('조직 member 설치 → 403, 원본 해석 없음', async () => {
        mockActiveOrg.mockResolvedValue({ orgId: 'org-a', orgRole: 'member' });
        const res = await request(app()).post('/api/users/me/extensions/org-owned').send({ gitUrl: 'https://github.com/acme/pack' });
        expect(res.status).toBe(403);
        expect(mockResolve).not.toHaveBeenCalled();
    });

    it('다른 조직의 행 제거 → 404(존재 숨김), 쓰기 SQL 없음', async () => {
        mockActiveOrg.mockResolvedValue({ orgId: 'org-b', orgRole: 'owner' });
        mockQuery.mockImplementation(async (sql: string) => (/SELECT \* FROM user_extensions WHERE id/.test(sql) ? { rows: [ORG_ROW] } : { rows: [] }));
        const res = await request(app()).delete('/api/users/me/extensions/org-owned/ext-org-1');
        expect(res.status).toBe(404);
        expect(mockQuery.mock.calls.some((c) => /^\s*UPDATE/i.test(String(c[0])))).toBe(false);
    });

    it('알 수 없는 본문 필드 → 400', async () => {
        mockActiveOrg.mockResolvedValue({ orgId: 'org-a', orgRole: 'admin' });
        const res = await request(app()).post('/api/users/me/extensions/org-owned').send({ gitUrl: 'https://github.com/acme/pack', orgId: 'org-z' });
        expect(res.status).toBe(400);
    });
});
