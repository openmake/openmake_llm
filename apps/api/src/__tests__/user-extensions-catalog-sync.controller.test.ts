/**
 * 카탈로그 원본 자격증명·동기화 상태·하위 경로 라우트(M4, 무DB).
 *  - 토큰은 암호화해 저장하고 어떤 응답에도 값·암호문을 싣지 않는다(write-only, has_credential 만)
 *  - 동기화는 요청 토큰이 없으면 저장 토큰으로 받고 결과를 기록한다
 *  - 하위 경로는 정규화해 저장, `..` 는 400
 */
import { resetConfig } from '../config/env';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

jest.mock('../auth/middleware', () => ({
    requireAuth: (req: Request & { user?: object }, _res: Response, next: NextFunction) => {
        req.user = { id: 'admin-1', userId: 'admin-1', role: 'admin' };
        next();
    },
    requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
jest.mock('../data/models/unified-database', () => ({ getPool: () => ({}), getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));

const SECRET = 'ghp_controllerSecret987654';
const mockRepo = {
    listAll: jest.fn(),
    getById: jest.fn(),
    setCredential: jest.fn(async () => true),
    setSubpath: jest.fn(),
    updateSnapshot: jest.fn(),
    recordSyncResult: jest.fn(async () => undefined),
    setAlias: jest.fn(),
};
jest.mock('../data/repositories/extension-catalog-repository', () => {
    const actual = jest.requireActual('../data/repositories/extension-catalog-repository');
    return { ...actual, ExtensionCatalogRepository: jest.fn().mockImplementation(() => mockRepo) };
});
const mockFetchSnapshot = jest.fn();
jest.mock('../services/extensions/ingest-service-factory', () => ({
    buildExtensionIngestService: async () => ({
        fetchCatalogSnapshot: mockFetchSnapshot,
        translateCatalogSnapshot: async () => undefined,
    }),
}));

import { createUserExtensionsController } from '../controllers/user-extensions.controller';
import { errorHandler } from '../utils/error-handler';
import { decryptToken, encryptToken } from '../utils/token-crypto';

const ORIGINAL_KEY = process.env.TOKEN_ENCRYPTION_KEY;

function app(): express.Express {
    const a = express();
    a.use(express.json());
    a.use('/api/users/me/extensions', createUserExtensionsController());
    a.use(errorHandler);
    return a;
}

function baseRow(over: Record<string, unknown> = {}) {
    return {
        id: 'c1', url: 'https://github.com/acme/market', name: 'm', description: null, plugins: [], enabled: true,
        added_by: null, last_synced_at: new Date(0), created_at: new Date(0), updated_at: new Date(0), ...over,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    process.env.TOKEN_ENCRYPTION_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
    resetConfig();
});
afterAll(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.TOKEN_ENCRYPTION_KEY; else process.env.TOKEN_ENCRYPTION_KEY = ORIGINAL_KEY;
    resetConfig();
});

it('PUT credential: 암호화해 저장, 응답에 값 없음', async () => {
    const res = await request(app()).put('/api/users/me/extensions/catalog/c1/credential').send({ token: SECRET });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(res.body.data).toEqual({ id: 'c1', has_credential: true });
    const stored = (mockRepo.setCredential.mock.calls[0] as unknown as [string, string])[1];
    expect(stored).not.toBe(SECRET);
    expect(decryptToken(stored)).toBe(SECRET);
});

it('PUT credential null: 삭제', async () => {
    const res = await request(app()).put('/api/users/me/extensions/catalog/c1/credential').send({ token: null });
    expect(res.status).toBe(200);
    expect(mockRepo.setCredential).toHaveBeenCalledWith('c1', null);
    expect(res.body.data.has_credential).toBe(false);
});

it('GET catalog/admin: 암호문을 싣지 않고 has_credential 만', async () => {
    mockRepo.listAll.mockResolvedValue([baseRow({ credential_encrypted: encryptToken(SECRET), sync_status: 'error', last_sync_error: 'x' })]);
    const res = await request(app()).get('/api/users/me/extensions/catalog/admin');
    expect(res.status).toBe(200);
    const src = res.body.data.sources[0];
    expect(src.credential_encrypted).toBeUndefined();
    expect(src.has_credential).toBe(true);
    expect(src.sync_status).toBe('error');
    expect(JSON.stringify(res.body)).not.toContain('v1:');
});

it('POST sync: 요청 토큰 없으면 저장 토큰 사용 + ok 기록 + 응답에 토큰 없음', async () => {
    const r = baseRow({ credential_encrypted: encryptToken(SECRET), source_subpath: 'cat' });
    mockRepo.getById.mockResolvedValue(r);
    mockRepo.updateSnapshot.mockResolvedValue({ ...r, sync_status: 'ok' });
    mockFetchSnapshot.mockResolvedValue({ name: 'm', description: null, plugins: [] });
    const res = await request(app()).post('/api/users/me/extensions/catalog/c1/sync').send({});
    expect(res.status).toBe(200);
    expect(mockFetchSnapshot).toHaveBeenCalledWith(r.url, SECRET, expect.objectContaining({ action: 'catalog-sync' }), 'cat');
    expect(mockRepo.recordSyncResult).toHaveBeenCalledWith('c1', 'ok', null);
    expect(res.body.data.source.credential_encrypted).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
});

it('POST sync 실패: 400 종전대로 + 상태 기록, 사유에 토큰 없음', async () => {
    mockRepo.getById.mockResolvedValue(baseRow({ credential_encrypted: encryptToken(SECRET) }));
    mockFetchSnapshot.mockRejectedValue(new Error(`UPSTREAM_FETCH_FAIL: 500 token=${SECRET}`));
    const res = await request(app()).post('/api/users/me/extensions/catalog/c1/sync').send({});
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(mockRepo.recordSyncResult).toHaveBeenCalledWith('c1', 'error', expect.not.stringContaining(SECRET));
});

it('PATCH 별칭(M5): 저장 · 예약어·규칙 위반 400 · 충돌 409', async () => {
    mockRepo.getById.mockResolvedValue(baseRow());
    mockRepo.setAlias.mockResolvedValueOnce({ row: baseRow({ alias: 'team' }), conflict: false });
    const ok = await request(app()).patch('/api/users/me/extensions/catalog/c1').send({ alias: 'team' });
    expect(ok.status).toBe(200);
    expect(mockRepo.setAlias).toHaveBeenCalledWith('c1', 'team');
    expect(ok.body.data.source.alias).toBe('team');

    expect((await request(app()).patch('/api/users/me/extensions/catalog/c1').send({ alias: 'internal' })).status).toBe(400);
    expect((await request(app()).patch('/api/users/me/extensions/catalog/c1').send({ alias: 'a..b' })).status).toBe(400);

    mockRepo.setAlias.mockResolvedValueOnce({ row: null, conflict: true });
    expect((await request(app()).patch('/api/users/me/extensions/catalog/c1').send({ alias: 'taken' })).status).toBe(409);
    expect((await request(app()).patch('/api/users/me/extensions/catalog/c1').send({})).status).toBe(400);
});

it('PATCH 하위 경로: 정규화 저장 · .. 는 400', async () => {
    mockRepo.getById.mockResolvedValue(baseRow());
    mockRepo.setSubpath.mockResolvedValue(baseRow({ source_subpath: 'plugins/team' }));
    const ok = await request(app()).patch('/api/users/me/extensions/catalog/c1').send({ sourceSubpath: './plugins/team/' });
    expect(ok.status).toBe(200);
    expect(mockRepo.setSubpath).toHaveBeenCalledWith('c1', 'plugins/team');

    const bad = await request(app()).patch('/api/users/me/extensions/catalog/c1').send({ sourceSubpath: '../etc' });
    expect(bad.status).toBe(400);
});
