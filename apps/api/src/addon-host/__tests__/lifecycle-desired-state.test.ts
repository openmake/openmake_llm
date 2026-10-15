/**
 * 관리자 의도 반영(applyDesiredState) — 같은 프로세스에서 끄면 drain 정지, 켜면 resume 이 있는 런타임만 재개.
 */
// 진입점 유무는 내장 레지스트리로 판단한다 — 테스트가 발견 목록을 정한다
const mockDefs: unknown[] = [];
jest.mock('../builtin-registry', () => ({
    ...jest.requireActual('../builtin-registry'),
    listBuiltinAddonDefs: () => mockDefs,
}));
import { bootAddons, type AddonBootDeps } from '../index';
import { getAddonRuntimeStatus, resetAddonRuntimeStatusesForTest, resolveAddonActivation } from '../activation';
import { applyDesiredState, resetAddonLifecyclesForTest } from '../lifecycle';
import type { AddonRuntimeHandle, AddonRuntimeStopOptions } from '../lifecycle-types';
import { resetCapabilityRuntimeForTest } from '../../runtime-ports/capability-runtime';
import { resetLegacyCapabilityBridgeForTest } from '../legacy-capability-bridge';
import type { BuiltinAddon } from '../builtin-registry';

const addon = (id: string, withRuntime = true): BuiltinAddon => ({
    id, dir: `/packs/${id}`,
    manifest: {
        id, name: id, version: '1.0.0', requires: { openmake: '>=1.0.0 <2.0.0' }, scope: 'system', components: {},
        ...(withRuntime ? { entry: { runtime: 'boot#start' } } : {}),
    },
} as unknown as BuiltinAddon);

function bootWith(id: string, handle: AddonRuntimeHandle | undefined, withRuntime = true): Promise<unknown> {
    const deps: AddonBootDeps = {
        appVersion: '1.84.0',
        async readInstallations() { return new Map(); },
        async applyMigrations(targets) { return targets.map(t => ({ id: t.id, applied: [] })); },
        async startRuntime() { return handle; },
        async markFailed() { /* 기록 생략 */ },
        async markSucceeded() { /* 기록 생략 */ },
    };
    const def = addon(id, withRuntime);
    mockDefs.push(def);
    return bootAddons([def], deps);
}

beforeEach(() => {
    mockDefs.length = 0;
    resetAddonRuntimeStatusesForTest();
    resetCapabilityRuntimeForTest();
    resetLegacyCapabilityBridgeForTest();
    resetAddonLifecyclesForTest();
});

describe('applyDesiredState', () => {
    it('disabled → drain 정지(stopped), enabled → resume 이 있으면 resumed·ready', async () => {
        const stop = jest.fn(async (_o: AddonRuntimeStopOptions) => undefined);
        const resume = jest.fn(async () => undefined);
        await bootWith('kn', { stop, resume });

        expect(await applyDesiredState('kn', 'disabled')).toBe('stopped');
        expect(stop).toHaveBeenCalledTimes(1);
        expect(stop.mock.calls[0][0].drain).toBe(true);
        expect(getAddonRuntimeStatus('kn').status).toBe('stopped');

        expect(await applyDesiredState('kn', 'enabled')).toBe('resumed');
        expect(resume).toHaveBeenCalledTimes(1);
        expect(getAddonRuntimeStatus('kn').status).toBe('ready');
    });

    it('resume 이 없으면 enabled 는 restart_required 이고 상태는 stopped 로 남는다', async () => {
        await bootWith('mc', { stop: async () => undefined });
        expect(await applyDesiredState('mc', 'disabled')).toBe('stopped');
        expect(await applyDesiredState('mc', 'enabled')).toBe('restart_required');
        expect(getAddonRuntimeStatus('mc').status).toBe('stopped');
    });

    it('resume 이 던지면 restart_required 이고 stopped 로 남는다', async () => {
        await bootWith('rf', { stop: async () => undefined, resume: async () => { throw new Error('재개 불가'); } });
        await applyDesiredState('rf', 'disabled');
        expect(await applyDesiredState('rf', 'enabled')).toBe('restart_required');
        expect(getAddonRuntimeStatus('rf').status).toBe('stopped');
    });

    it('이미 ready 인 add-on 을 enabled 로 다시 적용하면 unchanged', async () => {
        await bootWith('ok', { stop: async () => undefined, resume: async () => undefined });
        expect(await applyDesiredState('ok', 'enabled')).toBe('unchanged');
    });

    it('이 프로세스가 세우지 않은 add-on: enabled → restart_required, disabled → not_loaded', async () => {
        expect(await applyDesiredState('never', 'enabled')).toBe('restart_required');
        expect(await applyDesiredState('never', 'disabled')).toBe('not_loaded');
    });

    it('런타임 진입점이 없는 add-on(팩): 적용할 런타임이 없어 끄기·켜기 모두 unchanged', async () => {
        await bootWith('pack', undefined, false);
        expect(getAddonRuntimeStatus('pack').status).toBe('ready');
        expect(await applyDesiredState('pack', 'disabled')).toBe('unchanged');
        expect(await applyDesiredState('pack', 'enabled')).toBe('unchanged');
    });

    it('handle 을 돌려주지 않은 런타임 add-on: 멈춘 것이 없어 끄기·켜기 모두 unchanged, 상태는 ready 유지', async () => {
        await bootWith('void-rt', undefined);
        expect(await applyDesiredState('void-rt', 'disabled')).toBe('unchanged');
        expect(getAddonRuntimeStatus('void-rt').status).toBe('ready');
        expect(await applyDesiredState('void-rt', 'enabled')).toBe('unchanged');
        expect(getAddonRuntimeStatus('void-rt').status).toBe('ready');
    });

    it('handle 없는 런타임 add-on 을 끄고 켠 뒤에도 즉시 available 이고 재시작이 필요 없다', async () => {
        await bootWith('void-on', undefined);
        await applyDesiredState('void-on', 'disabled');
        await applyDesiredState('void-on', 'enabled');
        const activation = resolveAddonActivation({
            addonId: 'void-on', hasRuntimeEntry: true, versionCompatible: true,
            row: { known: true, desiredState: 'enabled', state: 'enabled', stateRevision: 2, lastFailureCode: null },
        });
        expect(activation.effectiveAvailability).toBe('available');
        expect(activation.restartRequired).toBe(false);
    });

    it('진입점은 있는데 이 프로세스가 세우지 않은 add-on(부팅 때 꺼짐): enabled → restart_required, disabled → not_loaded', async () => {
        mockDefs.push(addon('off-at-boot'));
        expect(await applyDesiredState('off-at-boot', 'enabled')).toBe('restart_required');
        expect(await applyDesiredState('off-at-boot', 'disabled')).toBe('not_loaded');
    });

    it('정지 중에 재개를 요청하면 정지가 끝난 뒤 재개한다(경합)', async () => {
        const order: string[] = [];
        let finishStop!: () => void;
        const stop = jest.fn((_o: AddonRuntimeStopOptions) => new Promise<void>((r) => { order.push('stop:start'); finishStop = () => { order.push('stop:end'); r(); }; }));
        const resume = jest.fn(async () => { order.push('resume'); });
        await bootWith('race', { stop, resume });

        const off = applyDesiredState('race', 'disabled');
        const on = applyDesiredState('race', 'enabled');
        await new Promise((r) => setTimeout(r, 5));
        expect(order).toEqual(['stop:start']);
        finishStop();
        expect(await off).toBe('stopped');
        expect(await on).toBe('resumed');
        expect(order).toEqual(['stop:start', 'stop:end', 'resume']);
        expect(getAddonRuntimeStatus('race').status).toBe('ready');
    });
});
