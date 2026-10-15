/**
 * 관리자 의도 반영(applyDesiredState) — 같은 프로세스에서 끄면 drain 정지, 켜면 resume 이 있는 런타임만 재개.
 */
import { bootAddons, type AddonBootDeps } from '../index';
import { getAddonRuntimeStatus, resetAddonRuntimeStatusesForTest } from '../activation';
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
    return bootAddons([addon(id, withRuntime)], deps);
}

beforeEach(() => {
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

    it('런타임 진입점이 없는 add-on(팩): 수명주기 기록이 없어 disabled → not_loaded, enabled → restart_required', async () => {
        await bootWith('pack', undefined, false);
        expect(getAddonRuntimeStatus('pack').status).toBe('ready');
        expect(await applyDesiredState('pack', 'disabled')).toBe('not_loaded');
        expect(await applyDesiredState('pack', 'enabled')).toBe('restart_required');
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
