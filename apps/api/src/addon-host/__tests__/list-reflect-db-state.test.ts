/**
 * `ADDON_LIST_REFLECT_DB_STATE`(§8-4, opt-in) — `GET /api/addons` 가 종전 add-on 에도 DB 상태를 반영한다.
 *  - ON: DB 에서 끈 종전 add-on 은 목록 enabled:false 이고, 같은 판정의 라우트 게이트는 404 — 둘이 일치한다
 *  - ON: 이 프로세스에서 준비되지 않은(runtime failed) add-on 은 목록 false · 게이트 503 ADDON_FAILED
 *  - ON: 상태 확인 불가(DB 장애)는 꺼짐을 주장하지 않는다(종전 env 판정) — 게이트는 재시도 가능한 503 으로 구분한다
 *  - OFF: 응답 본문이 종전과 바이트 단위로 같다(동기 경로, DB 를 읽지 않는다)
 *  - defaultState add-on 은 ON/OFF 동일
 */
import express from 'express';
import request from 'supertest';
import type { BuiltinAddon } from '../builtin-registry';

const mockDefs: BuiltinAddon[] = [];
jest.mock('../builtin-registry', () => {
    const actual = jest.requireActual('../builtin-registry');
    return {
        ...actual,
        listBuiltinAddonDefs: () => mockDefs,
        enabledBuiltinAddons: () => [],
        builtinAddonDefaultState: (id: string) => mockDefs.find(a => a.id === id)?.manifest.defaultState ?? 'enabled',
    };
});
const listRows = jest.fn();
jest.mock('../../data/repositories/addon-state-repository', () => ({
    AddonStateRepository: jest.fn().mockImplementation(() => ({ list: listRows })),
}));
jest.mock('../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));
// 게스트 — 조직 축은 보지 않는다(목록도 사용자 무관 배포 판정이다)
jest.mock('../../auth', () => ({ optionalAuth: (_req: unknown, _res: unknown, next: () => void) => next() }));

import { resetConfig } from '../../config/env';
const KEY = 'ADDON_LIST_REFLECT_DB_STATE';
const ORIGINAL = process.env[KEY];
/** 플래그는 실제 env → loadConfig 배선을 거친다(getConfig 캐시를 비운다) */
function setReflect(on: boolean | undefined): void {
    if (on === undefined) delete process.env[KEY]; else process.env[KEY] = String(on);
    resetConfig();
}
afterAll(() => { if (ORIGINAL === undefined) delete process.env[KEY]; else process.env[KEY] = ORIGINAL; resetConfig(); });

import { __resetAddonListCacheForTest, addonGuard, mountAddonRoutes } from '../routes';
import { __resetAddonStateCacheForTest } from '../../services/addon/addon-state';
import { resetAddonRuntimeStatusesForTest, setAddonRuntimeStatus } from '../activation';

const MANIFEST = { name: 'X', version: '1.0.0', requires: { openmake: '>=1.0.0 <99.0.0' }, scope: 'system', components: {} };
const def = (id: string, extra: Record<string, unknown> = {}): BuiltinAddon => ({
    id, dir: `/packs/${id}`, manifest: { ...MANIFEST, id, name: id, kind: 'integration', ...extra },
} as unknown as BuiltinAddon);

/** 앱마다 목록·상태 캐시를 비우고 마운트한다(요청 사이에 매니페스트·env·DB 응답을 바꾼다) */
function buildApp(): express.Express {
    __resetAddonListCacheForTest();
    __resetAddonStateCacheForTest();
    const app = express();
    mountAddonRoutes(app);
    for (const a of mockDefs) app.use(`/api/test/${a.id}`, addonGuard(a.id), (_req, res) => { res.json({ ok: true }); });
    return app;
}

const enabledById = (body: { data: { addons: Array<{ id: string; enabled: boolean }> } }) =>
    Object.fromEntries(body.data.addons.map(a => [a.id, a.enabled]));

beforeEach(() => {
    mockDefs.length = 0;
    setReflect(undefined);
    jest.clearAllMocks();
    resetAddonRuntimeStatusesForTest();
    delete process.env.ADDON_BUILTIN_DISABLED;
    mockDefs.push(def('plain-on'), def('plain-off'), def('guarded', { defaultState: 'disabled' }));
    listRows.mockResolvedValue([
        { addon_id: 'plain-off', state: 'disabled' },
        { addon_id: 'guarded', state: 'enabled' },
    ]);
});

describe('ADDON_LIST_REFLECT_DB_STATE=ON', () => {
    beforeEach(() => { setReflect(true); });

    it('DB 에서 끈 종전 add-on 은 목록 enabled:false — 라우트 게이트 404 와 일치', async () => {
        const app = buildApp();
        const list = await request(app).get('/api/addons');
        expect(list.status).toBe(200);
        expect(enabledById(list.body)).toEqual({ 'plain-on': true, 'plain-off': false, guarded: true });

        const off = await request(app).get('/api/test/plain-off');
        expect(off.status).toBe(404);
        expect(off.body.error.code).toBe('ADDON_DISABLED');
        expect((await request(app).get('/api/test/plain-on')).status).toBe(200);
        expect((await request(app).get('/api/test/guarded')).status).toBe(200);
    });

    it('defaultState add-on 이 하나도 없어도 DB 상태를 반영한다(동기 경로를 타지 않는다)', async () => {
        mockDefs.splice(2, 1);
        const list = await request(buildApp()).get('/api/addons');
        expect(enabledById(list.body)).toEqual({ 'plain-on': true, 'plain-off': false });
    });

    it('env 로 끈 add-on 은 종전대로 false', async () => {
        process.env.ADDON_BUILTIN_DISABLED = 'plain-on';
        const list = await request(buildApp()).get('/api/addons');
        expect(enabledById(list.body)).toMatchObject({ 'plain-on': false });
    });

    it('이 프로세스에서 준비되지 않은 add-on 은 false — 게이트는 503 ADDON_FAILED', async () => {
        setAddonRuntimeStatus('plain-on', 'failed', { code: 'runtime_failed', reason: 'boot failed' } as never);
        const app = buildApp();
        expect(enabledById((await request(app).get('/api/addons')).body)).toMatchObject({ 'plain-on': false });
        const r = await request(app).get('/api/test/plain-on');
        expect(r.status).toBe(503);
        expect(r.body.error.code).toBe('ADDON_FAILED');
    });

    it('상태 확인 불가면 종전 add-on 은 꺼짐을 주장하지 않는다(env 판정) — 게이트는 재시도 가능한 503 으로 구분', async () => {
        listRows.mockRejectedValue(new Error('db down'));
        const app = buildApp();
        expect(enabledById((await request(app).get('/api/addons')).body)).toEqual({ 'plain-on': true, 'plain-off': true, guarded: false });
        const r = await request(app).get('/api/test/plain-off');
        expect(r.status).toBe(503);
        expect(r.body.error.code).toBe('ADDON_STATE_UNKNOWN');
        expect(r.headers['retry-after']).toBe('5');
    });
});

describe('ADDON_LIST_REFLECT_DB_STATE=OFF (기본)', () => {
    it('종전 응답 그대로 — 종전 add-on 은 DB 에서 꺼져 있어도 enabled:true, defaultState add-on 만 DB 반영', async () => {
        const iso = jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-11-28T00:00:00.000Z');
        const res = await request(buildApp()).get('/api/addons');
        iso.mockRestore();
        expect(res.text).toBe(JSON.stringify({
            success: true,
            data: { addons: [
                { id: 'plain-on', name: 'plain-on', version: '1.0.0', kind: 'integration', enabled: true },
                { id: 'plain-off', name: 'plain-off', version: '1.0.0', kind: 'integration', enabled: true },
                { id: 'guarded', name: 'guarded', version: '1.0.0', kind: 'integration', enabled: true },
            ] },
            meta: { timestamp: '2026-11-28T00:00:00.000Z' },
        }));
    });

    it('defaultState add-on 이 없으면 DB 를 읽지 않는 동기 경로(종전)', async () => {
        mockDefs.splice(2, 1);
        const res = await request(buildApp()).get('/api/addons');
        expect(enabledById(res.body)).toEqual({ 'plain-on': true, 'plain-off': true });
        expect(listRows).not.toHaveBeenCalled();
    });

    it('defaultState add-on 판정은 ON/OFF 동일', async () => {
        const off = enabledById((await request(buildApp()).get('/api/addons')).body).guarded;
        setReflect(true);
        const on = enabledById((await request(buildApp()).get('/api/addons')).body).guarded;
        expect(off).toBe(true);
        expect(on).toBe(off);

        listRows.mockResolvedValue([]);
        setReflect(false);
        const offNoRow = enabledById((await request(buildApp()).get('/api/addons')).body).guarded;
        setReflect(true);
        const onNoRow = enabledById((await request(buildApp()).get('/api/addons')).body).guarded;
        expect(offNoRow).toBe(false);
        expect(onNoRow).toBe(offNoRow);
    });
});
