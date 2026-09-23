/**
 * 부팅 절차(P01) — 실패한 add-on 의 후속 단계를 막고 다른 add-on 은 계속 세운다.
 *   T04 migration 실패 → 해당 entry 실행 0회, 다른 정상 add-on 시작
 *   버전 불일치·관리자 의도 disabled → 제외(런타임 미호출), 실패 코드 기록
 *   T05 런타임 실패 → failed 로 기록, 다른 add-on 은 ready
 */
import { bootAddons, type AddonBootDeps } from '../index';
import { getAddonRuntimeStatus, resetAddonRuntimeStatusesForTest, resolveAddonActivation } from '../activation';
import { getCapabilityRegistry, resetCapabilityRuntimeForTest } from '../../runtime-ports/capability-runtime';
import { resetLegacyCapabilityBridgeForTest } from '../legacy-capability-bridge';
import type { BuiltinAddon } from '../builtin-registry';
import type { CapabilityDefinition, CapabilityHandler } from '../../capability-contract/types';

const addon = (id: string, extra: Partial<{ migrations: string; permissions: string[]; runtime: string; requires: string; provides: string[]; contract: number }> = {}): BuiltinAddon => ({
    id, dir: `/packs/${id}`,
    manifest: {
        id, name: id, version: '1.0.0', requires: { openmake: extra.requires ?? '>=1.0.0 <2.0.0', ...(extra.contract !== undefined ? { capabilityContract: extra.contract } : {}) }, scope: 'system',
        components: { ...(extra.migrations ? { migrations: extra.migrations } : {}) },
        ...(extra.permissions ? { permissions: extra.permissions } : {}),
        ...(extra.runtime ? { entry: { runtime: extra.runtime } } : {}),
        ...(extra.provides ? { provides: { capabilities: extra.provides } } : {}),
    },
} as unknown as BuiltinAddon);

const capDef = (id: string): CapabilityDefinition => ({
    id, contractVersion: 1, assignable: true, plannable: true, display: { label: id, group: 'x', order: 0 }, plannerHint: '',
    inputSchema: { type: 'object', properties: {} }, settingsSchema: { type: 'object', properties: {} },
    execution: { mode: 'sync', timeoutMs: 1000, supportsCancellation: true }, output: { mimeTypes: [] },
});
const capHandler: CapabilityHandler = { execute: async () => ({ ok: true, text: '', media: [] }) };

function deps(over: Partial<AddonBootDeps> = {}): AddonBootDeps & { started: string[]; failed: Array<[string, string]>; succeeded: string[] } {
    const started: string[] = []; const failed: Array<[string, string]> = []; const succeeded: string[] = [];
    return {
        started, failed, succeeded,
        appVersion: '1.84.0',
        async readInstallations() { return new Map(); },
        async applyMigrations(targets) { return targets.map(t => ({ id: t.id, applied: [] })); },
        async startRuntime(a) { started.push(a.id); },
        async markFailed(id, code) { failed.push([id, code]); },
        async markSucceeded(id) { succeeded.push(id); },
        ...over,
    };
}

beforeEach(() => { resetAddonRuntimeStatusesForTest(); resetCapabilityRuntimeForTest(); resetLegacyCapabilityBridgeForTest(); });

describe('bootAddons', () => {
    it('T04: migration 실패 add-on 은 런타임을 시작하지 않고, 다른 add-on 은 정상 시작한다', async () => {
        const d = deps({
            async applyMigrations(targets) {
                return targets.map(t => t.id === 'broken' ? { id: t.id, applied: [], error: 'relation exists' } : { id: t.id, applied: ['001'] });
            },
        });
        const r = await bootAddons([
            addon('broken', { migrations: './migrations', permissions: ['database:addon'], runtime: 'boot#start' }),
            addon('fine', { migrations: './migrations', permissions: ['database:addon'], runtime: 'boot#start' }),
            addon('plain', { runtime: 'boot#start' }),
        ], d);
        expect(d.started).toEqual(['fine', 'plain']);
        expect(r).toEqual([
            { id: 'broken', stage: 'migration_failed', reason: 'relation exists' },
            { id: 'fine', stage: 'ready' },
            { id: 'plain', stage: 'ready' },
        ]);
        expect(d.failed).toEqual([['broken', 'migration_failed']]);
        expect(getAddonRuntimeStatus('broken')).toMatchObject({ status: 'failed', failureCode: 'migration_failed' });
        expect(getAddonRuntimeStatus('fine').status).toBe('ready');
    });

    it('버전 불일치는 경고 후 계속이 아니라 제외 — 런타임 미호출·version_mismatch 기록', async () => {
        const d = deps();
        const r = await bootAddons([addon('old', { runtime: 'boot#start', requires: '>=9.0.0' }), addon('ok', { runtime: 'boot#start' })], d);
        expect(d.started).toEqual(['ok']);
        expect(r[0]).toMatchObject({ id: 'old', stage: 'version_mismatch' });
        expect(d.failed).toEqual([['old', 'version_mismatch']]);
    });

    it('관리자 의도 disabled 는 env 가 켜져 있어도 부팅 대상에서 제외한다(실패로 기록하지 않는다)', async () => {
        const d = deps({ async readInstallations() { return new Map([['off', { desired_state: 'disabled', state: 'disabled' }]]); } });
        const r = await bootAddons([addon('off', { runtime: 'boot#start' }), addon('on', { runtime: 'boot#start' })], d);
        expect(d.started).toEqual(['on']);
        expect(r[0]).toMatchObject({ id: 'off', stage: 'excluded' });
        expect(d.failed).toEqual([]);
        expect(getAddonRuntimeStatus('off').status).toBe('not_loaded');
    });

    it('의도 조회 실패는 env 판정만으로 계속한다(기존 팩 부팅을 DB 장애가 막지 않는다)', async () => {
        const d = deps({ async readInstallations() { throw new Error('db down'); } });
        const r = await bootAddons([addon('a', { runtime: 'boot#start' })], d);
        expect(d.started).toEqual(['a']);
        expect(r[0].stage).toBe('ready');
    });

    it('T05: 런타임 등록 실패는 failed 로 남기고(의도는 손대지 않는다) 다른 add-on 은 ready', async () => {
        const d = deps({ async startRuntime(a) { if (a.id === 'bad') throw new Error('port refused'); } });
        const r = await bootAddons([addon('bad', { runtime: 'boot#start' }), addon('good', { runtime: 'boot#start' })], d);
        expect(r).toEqual([{ id: 'bad', stage: 'runtime_failed', reason: 'port refused' }, { id: 'good', stage: 'ready' }]);
        expect(d.failed).toEqual([['bad', 'runtime_failed']]);
        expect(d.succeeded).toEqual(['good']);
        expect(getAddonRuntimeStatus('bad')).toMatchObject({ status: 'failed', failureCode: 'runtime_failed', reason: 'port refused' });
    });

    it('migration 실행 자체가 throw 하면 대상 add-on 전부를 migration_failed 로 제외하고 나머지는 계속', async () => {
        const d = deps({ async applyMigrations() { throw new Error('lock timeout'); } });
        const r = await bootAddons([
            addon('m', { migrations: './migrations', permissions: ['database:addon'], runtime: 'boot#start' }),
            addon('n', { runtime: 'boot#start' }),
        ], d);
        expect(r[0]).toMatchObject({ id: 'm', stage: 'migration_failed', reason: 'lock timeout' });
        expect(d.started).toEqual(['n']);
    });
});

describe('bootAddons — capability 게시 (P02)', () => {
    it('T29: 같은 capability 를 두 add-on 이 선언하면 양쪽 다 게시 차단, Base 예약 ID 는 그 add-on 만 거절되고 Base 등록은 유지', async () => {
        const d = deps();
        const r = await bootAddons([
            addon('img-a', { runtime: 'boot#start', provides: ['knowledge.retrieve'] }),
            addon('img-b', { runtime: 'boot#start', provides: ['knowledge.retrieve'] }),
            addon('txt', { runtime: 'boot#start', provides: ['text.reason'] }),
            addon('plain', { runtime: 'boot#start' }),
        ], d);
        expect(r.map(x => x.stage)).toEqual(['ownership_conflict', 'ownership_conflict', 'ownership_conflict', 'ready']);
        expect(d.started).toEqual(['plain']);
        expect(d.failed.map(f => f[1])).toEqual(['registration_failed', 'registration_failed', 'registration_failed']);
        expect(getCapabilityRegistry().get('text.reason')?.owner.addonId).toBe('base');
    });

    it('런타임이 호스트 문맥으로 게시하면 manifest 선언과 일치할 때만 ready', async () => {
        const d = deps({ async startRuntime(_a, _ref, host) { host.registerCapabilities([{ definition: capDef('knowledge.retrieve'), handler: capHandler }]); } });
        const r = await bootAddons([addon('kn', { runtime: 'boot#start', provides: ['knowledge.retrieve'] })], d);
        expect(r[0].stage).toBe('ready');
        expect(getCapabilityRegistry().get('knowledge.retrieve')?.owner).toEqual({ addonId: 'kn', addonVersion: '1.0.0', source: 'builtin' });
    });

    it('T05: 선언만 하고 등록하지 않으면 실패로 기록되고 부분 등록은 Registry 에 남지 않는다', async () => {
        const d = deps({ async startRuntime(_a, _ref, host) {
            host.registerCapabilities([{ definition: capDef('knowledge.retrieve'), handler: capHandler }]);
            throw new Error('후반 초기화 실패');
        } });
        const r = await bootAddons([addon('kn', { runtime: 'boot#start', provides: ['knowledge.retrieve'] })], d);
        expect(r[0]).toMatchObject({ stage: 'runtime_failed', reason: '후반 초기화 실패' });
        expect(getCapabilityRegistry().has('knowledge.retrieve')).toBe(false);
        expect(d.failed).toEqual([['kn', 'runtime_failed']]);
    });

    it('게시 결과가 manifest 와 다르면(선언 2·등록 1) 게시되지 않고 실패', async () => {
        const d = deps({ async startRuntime(_a, _ref, host) {
            expect(() => host.registerCapabilities([{ definition: capDef('knowledge.retrieve'), handler: capHandler }])).toThrow(/다릅니다/);
        } });
        const r = await bootAddons([addon('kn', { runtime: 'boot#start', provides: ['knowledge.retrieve', 'knowledge.ingest'] })], d);
        expect(r[0].stage).toBe('runtime_failed');
        expect(getCapabilityRegistry().has('knowledge.retrieve')).toBe(false);
    });

    it('capabilityContract 버전이 다르면 version_mismatch 로 제외', async () => {
        const d = deps();
        const r = await bootAddons([addon('kn', { runtime: 'boot#start', contract: 2 })], d);
        expect(r[0].stage).toBe('version_mismatch');
        expect(d.started).toEqual([]);
    });
});

describe('resolveAddonActivation', () => {
    const row = (desiredState: 'enabled' | 'disabled', state: 'enabled' | 'disabled' | 'failed' | 'installed' = 'enabled') =>
        ({ known: true as const, desiredState, state, stateRevision: 3, lastFailureCode: null });

    it('런타임 entry 가 있는데 이 프로세스에 안 올라왔으면 not_ready + restartRequired', () => {
        const a = resolveAddonActivation({ addonId: 'x', hasRuntimeEntry: true, versionCompatible: true, row: row('enabled') });
        expect(a).toMatchObject({ effectiveAvailability: 'not_ready', restartRequired: true, runtimeStatus: 'not_loaded', stateRevision: 3 });
    });

    it('T22: 상태 저장소를 읽지 못하면 state_unknown — 정책 없음으로 해석하지 않는다', () => {
        const a = resolveAddonActivation({ addonId: 'x', hasRuntimeEntry: false, versionCompatible: true, row: { known: false } });
        expect(a.effectiveAvailability).toBe('state_unknown');
        expect(a.desiredState).toBeNull();
    });

    it('의도 disabled 는 런타임이 ready 여도 disabled, 런타임 failed 는 failed, 콘텐츠 팩은 ready 없이 available', () => {
        resetAddonRuntimeStatusesForTest();
        expect(resolveAddonActivation({ addonId: 'c', hasRuntimeEntry: false, versionCompatible: true, row: row('enabled') }).effectiveAvailability).toBe('available');
        expect(resolveAddonActivation({ addonId: 'c', hasRuntimeEntry: false, versionCompatible: true, row: row('disabled', 'disabled') }).effectiveAvailability).toBe('disabled');
        expect(resolveAddonActivation({ addonId: 'c', hasRuntimeEntry: false, versionCompatible: false, row: row('enabled') }).effectiveAvailability).toBe('incompatible');
        expect(resolveAddonActivation({ addonId: 'c', hasRuntimeEntry: false, versionCompatible: true, row: row('enabled', 'failed') }).effectiveAvailability).toBe('failed');
    });
});

describe('readAddonStateStrict (T22)', () => {
    it('DB 오류를 삼키지 않고 known:false 로 돌려준다', async () => {
        jest.resetModules();
        jest.doMock('../../data/models/unified-database', () => ({
            getUnifiedDatabase: () => ({ getPool: () => ({ query: async () => { throw new Error('ECONNREFUSED'); } }) }),
        }));
        const { readAddonStateStrict } = await import('../../services/addon/addon-state');
        const r = await readAddonStateStrict('image-runtime');
        expect(r).toEqual({ known: false, reason: 'ECONNREFUSED' });
        jest.dontMock('../../data/models/unified-database');
    });

    it('행이 없으면 known:true·registered:false 로 기본 의도 enabled', async () => {
        jest.resetModules();
        jest.doMock('../../data/models/unified-database', () => ({
            getUnifiedDatabase: () => ({ getPool: () => ({ query: async () => ({ rows: [] }) }) }),
        }));
        const { readAddonStateStrict } = await import('../../services/addon/addon-state');
        expect(await readAddonStateStrict('x')).toMatchObject({ known: true, registered: false, desiredState: 'enabled' });
        jest.dontMock('../../data/models/unified-database');
    });
});
