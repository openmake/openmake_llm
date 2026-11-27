/**
 * 매니페스트 `defaultState`(2026-11-27, 마켓플레이스 계획 v3.4 A1) — 새 add-on 을 꺼진 채 들이는 일반 필드.
 *  - 스키마: enabled·disabled 만, 생략 가능
 *  - 기존 add-on 무영향: 지금 내장 add-on 은 아무도 선언하지 않는다 → 기본 enabled(종전 동작)
 *  - 부팅: 설치 표에 행이 없거나 의도를 읽지 못하면 defaultState 를 따른다(disabled 면 제외), 행이 있으면 행이 이긴다
 *  - 켜짐 판정: 행을 읽기 전·미등록이면 defaultState(disabled 면 fail-closed)
 *  - 클라이언트 목록: defaultState disabled add-on 만 DB 상태를 겹친다
 */
import { addonManifestSchema } from '../manifest';
import type { BuiltinAddon } from '../builtin-registry';

const mockDefs: BuiltinAddon[] = [];
jest.mock('../builtin-registry', () => {
    const actual = jest.requireActual('../builtin-registry');
    return {
        ...actual,
        listBuiltinAddonDefs: () => (mockDefs.length ? mockDefs : actual.listBuiltinAddonDefs()),
        builtinAddonDefaultState: (id: string) => mockDefs.length
            ? (mockDefs.find(a => a.id === id)?.manifest.defaultState ?? 'enabled')
            : actual.builtinAddonDefaultState(id),
    };
});
const listRows = jest.fn();
const getRow = jest.fn();
const upsertDiscovered = jest.fn(async () => undefined);
jest.mock('../../data/repositories/addon-state-repository', () => ({
    AddonStateRepository: jest.fn().mockImplementation(() => ({ list: listRows, get: getRow, upsertDiscovered })),
}));
jest.mock('../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));

import { bootAddons, syncAddonInstallations, type AddonBootDeps } from '../index';
import { resetAddonRuntimeStatusesForTest } from '../activation';
import { resetCapabilityRuntimeForTest } from '../../runtime-ports/capability-runtime';
import { resetLegacyCapabilityBridgeForTest } from '../legacy-capability-bridge';
import { __resetAddonStateCacheForTest, isAddonEnabledSync, readAddonEnabledStrict, readAddonStateStrict } from '../../services/addon/addon-state';
import { listAddonsForClient } from '../routes';
import type { AddonInstallationIntent } from '@openmake/plugin-contracts';

const MANIFEST = { id: 'x-pack', name: 'X', version: '1.0.0', requires: { openmake: '>=1.0.0 <99.0.0' }, scope: 'system', components: {} };
const def = (id: string, defaultState?: 'enabled' | 'disabled'): BuiltinAddon => ({
    id, dir: `/packs/${id}`, manifest: { ...MANIFEST, id, name: id, ...(defaultState ? { defaultState } : {}) },
} as unknown as BuiltinAddon);

beforeEach(() => {
    mockDefs.length = 0;
    jest.clearAllMocks();
    __resetAddonStateCacheForTest();
    resetAddonRuntimeStatusesForTest();
    resetCapabilityRuntimeForTest();
    resetLegacyCapabilityBridgeForTest();
    delete process.env.ADDON_BUILTIN_DISABLED;
});

describe('매니페스트 defaultState 스키마', () => {
    it('enabled·disabled 를 받고 생략할 수 있다', () => {
        expect(addonManifestSchema.parse({ ...MANIFEST, defaultState: 'disabled' }).defaultState).toBe('disabled');
        expect(addonManifestSchema.parse({ ...MANIFEST, defaultState: 'enabled' }).defaultState).toBe('enabled');
        expect(addonManifestSchema.parse(MANIFEST).defaultState).toBeUndefined();
    });
    it('다른 값은 거절한다', () => {
        expect(addonManifestSchema.safeParse({ ...MANIFEST, defaultState: 'off' }).success).toBe(false);
    });
});

describe('기존 내장 add-on 무영향', () => {
    it('지금 내장 add-on 은 defaultState 를 선언하지 않는다 → 전부 enabled(종전 동작)', () => {
        const { listBuiltinAddonDefs, builtinAddonDefaultState } = jest.requireActual('../builtin-registry');
        const defs = listBuiltinAddonDefs() as BuiltinAddon[];
        expect(defs.length).toBeGreaterThan(5);
        // 기본 꺼짐 add-on 을 새로 들이면(마켓플레이스 등) 이 목록에 그 id 를 더한다
        expect(defs.filter(a => a.manifest.defaultState !== undefined).map(a => a.id)).toEqual([]);
        for (const a of defs) expect(builtinAddonDefaultState(a.id)).toBe('enabled');
        expect(builtinAddonDefaultState('ext:some-extension')).toBe('enabled');
    });
});

describe('발견 동기화 — defaultState 를 첫 insert 의 initialState 로', () => {
    it('disabled 선언만 initialState 를 넘기고, 선언 없음은 종전 인자 그대로', async () => {
        mockDefs.push(def('off-pack', 'disabled'), def('plain-pack'));
        await syncAddonInstallations();
        const calls = (upsertDiscovered.mock.calls as unknown as Array<[Record<string, unknown>]>).map(c => c[0]);
        expect(calls.find(c => c.addonId === 'off-pack')).toMatchObject({ initialState: 'disabled' });
        expect(calls.find(c => c.addonId === 'plain-pack')).not.toHaveProperty('initialState');
    });
});

describe('부팅 — 행이 없으면 defaultState, 행이 있으면 행', () => {
    function deps(rows: Map<string, AddonInstallationIntent> | Error): AddonBootDeps {
        return {
            appVersion: '1.150.0',
            async readInstallations() { if (rows instanceof Error) throw rows; return rows; },
            async applyMigrations(targets) { return targets.map(t => ({ id: t.id, applied: [] })); },
            async startRuntime() { return undefined; },
            async markFailed() { /* 생략 */ },
            async markSucceeded() { /* 생략 */ },
        };
    }
    const intent = (desiredState: 'enabled' | 'disabled') => ({ desiredState } as unknown as AddonInstallationIntent);

    it('행 없음: disabled 선언은 제외, 선언 없음은 종전대로 부팅', async () => {
        mockDefs.push(def('off-pack', 'disabled'), def('plain-pack'));
        const r = await bootAddons(mockDefs, deps(new Map()));
        expect(r.find(x => x.id === 'off-pack')).toMatchObject({ stage: 'excluded' });
        expect(r.find(x => x.id === 'plain-pack')).toMatchObject({ stage: 'ready' });
    });

    it('의도 조회 실패: disabled 선언은 DB 장애로 켜지지 않는다, 선언 없음은 env 판정으로 부팅', async () => {
        mockDefs.push(def('off-pack', 'disabled'), def('plain-pack'));
        const r = await bootAddons(mockDefs, deps(new Error('db down')));
        expect(r.find(x => x.id === 'off-pack')).toMatchObject({ stage: 'excluded' });
        expect(r.find(x => x.id === 'plain-pack')).toMatchObject({ stage: 'ready' });
    });

    it('관리자가 켠 행(enabled)이 있으면 defaultState 와 무관하게 부팅한다', async () => {
        mockDefs.push(def('off-pack', 'disabled'));
        const r = await bootAddons(mockDefs, deps(new Map([['off-pack', intent('enabled')]])));
        expect(r[0]).toMatchObject({ id: 'off-pack', stage: 'ready' });
    });
});

describe('켜짐 판정 — 미등록·미적재는 defaultState', () => {
    it('첫 적재 전: disabled 선언은 꺼짐(fail-closed), 선언 없음은 켜짐(종전 fail-open)', () => {
        mockDefs.push(def('off-pack', 'disabled'), def('plain-pack'));
        expect(isAddonEnabledSync('off-pack')).toBe(false);
        expect(isAddonEnabledSync('plain-pack')).toBe(true);
    });

    it('적재 후 행 없음: disabled 선언은 state disabled, 행이 enabled 면 켜짐', async () => {
        mockDefs.push(def('off-pack', 'disabled'), def('on-pack', 'disabled'));
        listRows.mockResolvedValue([{ addon_id: 'on-pack', state: 'enabled' }]);
        expect(await readAddonEnabledStrict('off-pack')).toEqual({ known: true, enabled: false, state: 'disabled' });
        expect(await readAddonEnabledStrict('on-pack')).toEqual({ known: true, enabled: true, state: 'enabled' });
    });

    it('strict 조회 미등록: disabled 선언은 의도 disabled, 선언 없음은 enabled', async () => {
        mockDefs.push(def('off-pack', 'disabled'), def('plain-pack'));
        getRow.mockResolvedValue(null);
        expect(await readAddonStateStrict('off-pack')).toMatchObject({ known: true, registered: false, state: 'disabled', desiredState: 'disabled' });
        expect(await readAddonStateStrict('plain-pack')).toMatchObject({ known: true, registered: false, state: 'enabled', desiredState: 'enabled' });
    });
});

describe('클라이언트 목록(GET /api/addons)', () => {
    it('disabled 선언 add-on 만 DB 상태를 겹친다 — 행이 없거나 읽지 못하면 꺼짐', async () => {
        mockDefs.push(def('off-pack', 'disabled'), def('on-pack', 'disabled'), def('plain-pack'));
        listRows.mockResolvedValue([{ addon_id: 'on-pack', state: 'enabled' }, { addon_id: 'plain-pack', state: 'disabled' }]);
        let list: Array<{ id: string; enabled: boolean }> = [];
        await jest.isolateModulesAsync(async () => {
            list = await (require('../routes') as { listAddonsForClient: typeof listAddonsForClient }).listAddonsForClient();
        });
        const byId = Object.fromEntries(list.map(a => [a.id, a.enabled]));
        // plain-pack 은 종전대로 env 판정 — DB 에서 꺼져 있어도 목록은 enabled(기존 계약 유지)
        expect(byId).toEqual({ 'off-pack': false, 'on-pack': true, 'plain-pack': true });

        listRows.mockRejectedValue(new Error('db down'));
        __resetAddonStateCacheForTest();
        await jest.isolateModulesAsync(async () => {
            list = await (require('../routes') as { listAddonsForClient: typeof listAddonsForClient }).listAddonsForClient();
        });
        expect(Object.fromEntries(list.map(a => [a.id, a.enabled]))).toEqual({ 'off-pack': false, 'on-pack': false, 'plain-pack': true });
    });
});
