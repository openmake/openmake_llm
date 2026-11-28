/**
 * `/api/extension-marketplace/registry/*` — add-on 게이트를 지난다. 사용자 보기는 승인 항목만, 레지스트리·사본 장애에도
 * 갤러리(판정)와 목록이 깨지지 않는다, 관리자 전용 큐레이션·카탈로그 올리기·지금 동기화.
 */
import express from 'express';
import request from 'supertest';

const checkAddonEntitlement = jest.fn();
jest.mock('../../../services/addon/entitlement', () => ({ checkAddonEntitlement: (...a: unknown[]) => checkAddonEntitlement(...a) }));

let role: string | null = 'user';
jest.mock('../../../auth', () => ({
    optionalAuth: (req: { user?: unknown }, _res: unknown, next: () => void) => { if (role) req.user = { id: 3, userId: '3', role }; next(); },
}));

const getCatalogVerdicts = jest.fn();
jest.mock('../service', () => ({ getCatalogVerdicts: (...a: unknown[]) => getCatalogVerdicts(...a) }));

const repo = {
    list: jest.fn(), get: jest.fn(), setCuration: jest.fn(), setPromoted: jest.fn(), getState: jest.fn(), counts: jest.fn(),
};
jest.mock('../registry/registry-repository', () => ({ RegistryRepository: jest.fn().mockImplementation(() => repo) }));
jest.mock('../../../runtime-ports/db-access', () => ({ getPool: () => ({}) }));

const recordAddonAudit = jest.fn();
jest.mock('../../../runtime-ports/audit-port', () => ({ recordAddonAudit: (...a: unknown[]) => recordAddonAudit(...a) }));
const createMcpCatalogDraft = jest.fn();
jest.mock('../../../runtime-ports/mcp-catalog-templates', () => ({ createMcpCatalogDraft: (...a: unknown[]) => createMcpCatalogDraft(...a) }));

const syncEnabled = jest.fn();
const quickActions = jest.fn();
const triggerRegistrySync = jest.fn();
jest.mock('../registry/runtime', () => ({
    registrySyncEnabled: () => syncEnabled(),
    registryQuickActionsEnabled: () => quickActions(),
    triggerRegistrySync: (...a: unknown[]) => triggerRegistrySync(...a),
}));

import { addonGuard } from '../../../addon-host/routes';
import { errorHandler } from '../../../utils/error-handler';
import { extensionMarketplaceRouter } from '../routes';

const BASE = '/api/extension-marketplace';

function app() {
    const a = express();
    a.use(express.json());
    a.use(BASE, addonGuard('extension-marketplace'), extensionMarketplaceRouter);
    a.use(errorHandler);
    return a;
}

const entry = {
    serverName: 'io.github.acme/weather', namespace: 'io.github.acme', version: '1.2.0', title: 'Weather', description: '날씨',
    websiteUrl: null, repositoryUrl: null, remotes: [{ type: 'streamable-http', url: 'https://mcp.acme.dev/mcp' }], packages: [],
    status: 'active', statusMessage: null, publishedAt: null, registryUpdatedAt: null, tombstonedAt: null, curation: 'approved',
    curatedAt: '2026-11-27T00:00:00.000Z', promotedCatalogId: null, lastSeenAt: '2026-11-28T00:00:00.000Z',
};

beforeEach(() => {
    jest.clearAllMocks();
    role = 'user';
    checkAddonEntitlement.mockResolvedValue('ok');
    syncEnabled.mockReturnValue(false);
    quickActions.mockReturnValue(false);
    repo.list.mockResolvedValue({ entries: [entry], total: 1 });
    repo.get.mockResolvedValue(entry);
    repo.setCuration.mockResolvedValue(true);
    getCatalogVerdicts.mockResolvedValue({ catalogId: 'ext-cat-1', verdictVersion: 1, verdicts: [] });
});

describe('registry 사용자 보기', () => {
    it('add-on 꺼짐 404 · 게스트 401', async () => {
        checkAddonEntitlement.mockResolvedValueOnce('disabled');
        expect((await request(app()).get(`${BASE}/registry/entries`)).status).toBe(404);
        role = null;
        expect((await request(app()).get(`${BASE}/registry/entries`)).status).toBe(401);
    });

    it('승인 항목만 묻고, 원본 종류·게시자 확인만 싣는다(큐레이션 메모 없음)', async () => {
        const r = await request(app()).get(`${BASE}/registry/entries?search=wea`);
        expect(r.status).toBe(200);
        expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ curation: 'approved', search: 'wea' }));
        expect(r.body.data).toMatchObject({ sourceKind: 'mcp-registry', available: true, total: 1 });
        expect(r.body.data.entries[0]).toMatchObject({ serverName: 'io.github.acme/weather', publisherVerified: true });
        expect(r.body.data.entries[0]).not.toHaveProperty('curatedAt');
        expect(r.body.data.entries[0]).not.toHaveProperty('curation');
    });

    it('사본 조회가 실패해도 200 빈 목록(available:false), 판정 API 는 그대로', async () => {
        repo.list.mockRejectedValue(new Error('relation does not exist'));
        const r = await request(app()).get(`${BASE}/registry/entries`);
        expect(r.status).toBe(200);
        expect(r.body.data).toMatchObject({ available: false, entries: [] });
        const v = await request(app()).get(`${BASE}/verdicts?catalogId=ext-cat-1`);
        expect(v.status).toBe(200);
        expect(triggerRegistrySync).not.toHaveBeenCalled();
    });
});

describe('registry 관리자', () => {
    it('관리자가 아니면 403 — 저장소에 닿지 않는다', async () => {
        for (const [method, path] of [['get', '/registry/admin/status'], ['get', '/registry/admin/entries'], ['put', '/registry/admin/entries/curation'], ['post', '/registry/admin/entries/promote'], ['post', '/registry/admin/sync']] as const) {
            const r = await request(app())[method](`${BASE}${path}`).send({ serverName: entry.serverName, curation: 'approved' });
            expect(r.status).toBe(403);
        }
        expect(repo.setCuration).not.toHaveBeenCalled();
        expect(createMcpCatalogDraft).not.toHaveBeenCalled();
    });

    it('큐레이션 — 저장 + 감사, 없는(지워진) 항목은 404', async () => {
        role = 'admin';
        const r = await request(app()).put(`${BASE}/registry/admin/entries/curation`).send({ serverName: entry.serverName, curation: 'approved' });
        expect(r.status).toBe(200);
        expect(repo.setCuration).toHaveBeenCalledWith(entry.serverName, 'approved', '3');
        expect(recordAddonAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'extension_marketplace.registry_curated', resourceId: entry.serverName }));
        repo.setCuration.mockResolvedValueOnce(false);
        expect((await request(app()).put(`${BASE}/registry/admin/entries/curation`).send({ serverName: entry.serverName, curation: 'approved' })).status).toBe(404);
        expect((await request(app()).put(`${BASE}/registry/admin/entries/curation`).send({ serverName: 'bad', curation: 'approved' })).status).toBe(400);
    });

    it('카탈로그로 올리기 — 꺼진 초안 포트 호출, 결과 기록·감사', async () => {
        role = 'admin';
        createMcpCatalogDraft.mockResolvedValue({ status: 'created', id: 'mcp-reg-io-github-acme-weather' });
        const r = await request(app()).post(`${BASE}/registry/admin/entries/promote`).send({ serverName: entry.serverName });
        expect(r.status).toBe(200);
        expect(createMcpCatalogDraft).toHaveBeenCalledWith(expect.objectContaining({ id: 'mcp-reg-io-github-acme-weather', transportType: 'streamable-http', urlTemplate: 'https://mcp.acme.dev/mcp' }));
        expect(repo.setPromoted).toHaveBeenCalledWith(entry.serverName, 'mcp-reg-io-github-acme-weather');
        expect(recordAddonAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'extension_marketplace.registry_promoted' }));
    });

    it('카탈로그로 올리기 실패 — 승인 전 409 · MCP 런타임 꺼짐 409 · 없는 항목 404', async () => {
        role = 'admin';
        repo.get.mockResolvedValueOnce({ ...entry, curation: 'pending' });
        const p = await request(app()).post(`${BASE}/registry/admin/entries/promote`).send({ serverName: entry.serverName });
        expect(p.status).toBe(409);
        expect(p.body.error.code).toBe('REGISTRY_PROMOTE_NOT_APPROVED');
        createMcpCatalogDraft.mockResolvedValueOnce({ status: 'unavailable' });
        const u = await request(app()).post(`${BASE}/registry/admin/entries/promote`).send({ serverName: entry.serverName });
        expect(u.status).toBe(409);
        expect(u.body.error.code).toBe('MCP_CATALOG_UNAVAILABLE');
        expect(repo.setPromoted).not.toHaveBeenCalled();
        repo.get.mockResolvedValueOnce(null);
        expect((await request(app()).post(`${BASE}/registry/admin/entries/promote`).send({ serverName: entry.serverName })).status).toBe(404);
    });

    it('빠른 작업 OFF(기본) — 승인+올리기 404, 목록은 이름순(rank 없음), 상태에 quickActions 없음', async () => {
        role = 'admin';
        const r = await request(app()).post(`${BASE}/registry/admin/entries/approve-promote`).send({ serverName: entry.serverName });
        expect(r.status).toBe(404);
        expect(r.body.error.code).toBe('REGISTRY_QUICK_ACTIONS_DISABLED');
        expect(repo.setCuration).not.toHaveBeenCalled();
        repo.list.mockResolvedValue({ entries: [], total: 0 });
        await request(app()).get(`${BASE}/registry/admin/entries?search=notion`);
        expect(repo.list).toHaveBeenCalledWith(expect.not.objectContaining({ rank: true }));
        repo.getState.mockResolvedValue({ cursor: null });
        repo.counts.mockResolvedValue({ pending: 0, approved: 0, hidden: 0, tombstoned: 0 });
        expect((await request(app()).get(`${BASE}/registry/admin/status`)).body.data).not.toHaveProperty('quickActions');
    });

    it('빠른 작업 ON — 대기 항목을 승인하고 올린다(감사 2건), 상태 quickActions, 목록 rank', async () => {
        role = 'admin';
        quickActions.mockReturnValue(true);
        repo.get.mockResolvedValueOnce({ ...entry, curation: 'pending' }).mockResolvedValue(entry);
        repo.setCuration.mockResolvedValue(true);
        createMcpCatalogDraft.mockResolvedValue({ status: 'created', id: 'mcp-reg-io-github-acme-weather' });
        const r = await request(app()).post(`${BASE}/registry/admin/entries/approve-promote`).send({ serverName: entry.serverName });
        expect(r.status).toBe(200);
        expect(r.body.data).toMatchObject({ catalogId: 'mcp-reg-io-github-acme-weather', status: 'created', curation: 'approved' });
        expect(repo.setCuration).toHaveBeenCalledWith(entry.serverName, 'approved', '3');
        expect(repo.setPromoted).toHaveBeenCalledWith(entry.serverName, 'mcp-reg-io-github-acme-weather');
        expect(recordAddonAudit.mock.calls.map((c) => c[0].action)).toEqual(['extension_marketplace.registry_curated', 'extension_marketplace.registry_promoted']);
        repo.list.mockResolvedValue({ entries: [], total: 0 });
        await request(app()).get(`${BASE}/registry/admin/entries?search=notion`);
        expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ search: 'notion', rank: true }));
        repo.getState.mockResolvedValue({ cursor: null });
        repo.counts.mockResolvedValue({ pending: 0, approved: 0, hidden: 0, tombstoned: 0 });
        expect((await request(app()).get(`${BASE}/registry/admin/status`)).body.data.quickActions).toBe(true);
    });

    it('빠른 작업 ON — 올릴 수 없는 항목은 승인하지 않는다(409), 지워진 항목 404, 관리자 아니면 403', async () => {
        role = 'admin';
        quickActions.mockReturnValue(true);
        repo.get.mockResolvedValueOnce({ ...entry, curation: 'pending', remotes: [], packages: [] });
        const r = await request(app()).post(`${BASE}/registry/admin/entries/approve-promote`).send({ serverName: entry.serverName });
        expect(r.status).toBe(409);
        expect(r.body.error.code).toBe('REGISTRY_PROMOTE_NO_SUPPORTED_INSTALL');
        expect(repo.setCuration).not.toHaveBeenCalled();
        repo.get.mockResolvedValueOnce({ ...entry, tombstonedAt: '2026-11-28T00:00:00.000Z' });
        expect((await request(app()).post(`${BASE}/registry/admin/entries/approve-promote`).send({ serverName: entry.serverName })).status).toBe(404);
        role = 'user';
        expect((await request(app()).post(`${BASE}/registry/admin/entries/approve-promote`).send({ serverName: entry.serverName })).status).toBe(403);
        expect(createMcpCatalogDraft).not.toHaveBeenCalled();
    });

    it('지금 동기화 — 플래그 OFF 면 409(외부 호출 없음), ON 이면 force', async () => {
        role = 'admin';
        const off = await request(app()).post(`${BASE}/registry/admin/sync`);
        expect(off.status).toBe(409);
        expect(off.body.error.code).toBe('REGISTRY_SYNC_DISABLED');
        expect(triggerRegistrySync).not.toHaveBeenCalled();
        syncEnabled.mockReturnValue(true);
        triggerRegistrySync.mockResolvedValue({ status: 'complete', pages: 1, stats: {} });
        const on = await request(app()).post(`${BASE}/registry/admin/sync`);
        expect(on.status).toBe(200);
        expect(triggerRegistrySync).toHaveBeenCalledWith({ force: true });
    });

    it('상태 — 플래그·커서·건수', async () => {
        role = 'admin';
        repo.getState.mockResolvedValue({ cursor: null, lastError: 'HTTP 503' });
        repo.counts.mockResolvedValue({ pending: 2, approved: 1, hidden: 0, tombstoned: 1 });
        const r = await request(app()).get(`${BASE}/registry/admin/status`);
        expect(r.status).toBe(200);
        expect(r.body.data).toMatchObject({ syncEnabled: false, state: { lastError: 'HTTP 503' }, counts: { pending: 2 } });
    });
});
