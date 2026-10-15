// apps/api/src/addon-host/__tests__/lifecycle.test.ts
/**
 * Add-on 수명주기(lifecycle.ts) — 가짜 런타임으로 고정한다.
 *   정상 시작·종료 / 타이머·정리 함수·기여 도구 등록 뒤 시작 실패 → 자원 0 / 게시 대조 실패 시 handle 즉시 정지 /
 *   반복 회수 멱등 / 동시 정지 경합 / drain 시간 초과 뒤 취소 / 시작 시간 초과
 */
import { bootAddons, type AddonBootDeps } from '../index';
import { getAddonRuntimeStatus, resetAddonRuntimeStatusesForTest } from '../activation';
import {
    getAddonLifecycleRecord, releaseAddonResources, resetAddonLifecyclesForTest, stopAddon, stopAllAddons,
} from '../lifecycle';
import type { AddonRuntimeStopOptions } from '../lifecycle-types';
import { resetCapabilityRuntimeForTest } from '../../runtime-ports/capability-runtime';
import { resetLegacyCapabilityBridgeForTest } from '../legacy-capability-bridge';
import {
    contributeBuiltInTools, contributedBuiltInTools, resetBuiltInToolContributions,
} from '../../runtime-ports/builtin-tool-contributions';
import type { BuiltinAddon } from '../builtin-registry';
import type { MCPToolDefinition } from '../../tool-contract/types';

const addon = (id: string, provides?: string[]): BuiltinAddon => ({
    id, dir: `/packs/${id}`,
    manifest: {
        id, name: id, version: '1.0.0', requires: { openmake: '>=1.0.0 <2.0.0' }, scope: 'system', components: {},
        entry: { runtime: 'boot#start' },
        ...(provides ? { provides: { capabilities: provides } } : {}),
    },
} as unknown as BuiltinAddon);

const fakeTool = (name: string): MCPToolDefinition => ({
    tool: { name, description: name, inputSchema: { type: 'object', properties: {} } },
    handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
} as unknown as MCPToolDefinition);

function deps(startRuntime: AddonBootDeps['startRuntime'], over: Partial<AddonBootDeps> = {}): AddonBootDeps {
    return {
        appVersion: '1.84.0',
        async readInstallations() { return new Map(); },
        async applyMigrations(targets) { return targets.map(t => ({ id: t.id, applied: [] })); },
        startRuntime,
        async markFailed() { /* 이 테스트는 기록을 보지 않는다 */ },
        async markSucceeded() { /* 이 테스트는 기록을 보지 않는다 */ },
        ...over,
    };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
    resetAddonRuntimeStatusesForTest();
    resetCapabilityRuntimeForTest();
    resetLegacyCapabilityBridgeForTest();
    resetBuiltInToolContributions();
    resetAddonLifecyclesForTest();
});

describe('add-on 수명주기', () => {
    it('정상 시작은 handle 을 기록하고, 종료(stopAllAddons)는 drain 정지 뒤 정리 함수를 등록 역순으로 회수한다', async () => {
        const order: string[] = [];
        const stop = jest.fn(async (_o: AddonRuntimeStopOptions) => { order.push('stop'); });
        let hostSignal: AbortSignal | undefined;
        const r = await bootAddons([addon('alpha')], deps(async (_a, _ref, host) => {
            hostSignal = host.signal;
            host.registerDisposable('first', () => { order.push('dispose:first'); });
            host.setInterval(() => undefined, 60_000);
            host.registerDisposable('last', () => { order.push('dispose:last'); });
            return { stop };
        }));
        expect(r[0].stage).toBe('ready');
        expect(getAddonLifecycleRecord('alpha')?.handle).not.toBeNull();
        expect(hostSignal?.aborted).toBe(false);

        await stopAllAddons({ drain: true, budgetMs: 1_000 });

        expect(stop).toHaveBeenCalledTimes(1);
        expect(stop.mock.calls[0][0].drain).toBe(true);
        expect(stop.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
        expect(order).toEqual(['stop', 'dispose:last', 'dispose:first']);
        expect(getAddonRuntimeStatus('alpha').status).toBe('stopped');
        expect(hostSignal?.aborted).toBe(true);
        expect(getAddonLifecycleRecord('alpha')?.disposables).toEqual([]);
    });

    it('타이머·정리 함수·기여 도구를 등록한 뒤 시작이 실패하면 전부 회수된다(자원 0)', async () => {
        let ticks = 0;
        const close = jest.fn();
        let hostSignal: AbortSignal | undefined;
        const r = await bootAddons([addon('beta')], deps(async (_a, _ref, host) => {
            hostSignal = host.signal;
            host.setInterval(() => { ticks++; }, 5);
            host.setTimeout(() => { ticks++; }, 5);
            host.registerDisposable('conn', close);
            contributeBuiltInTools('beta', [fakeTool('beta_tool')]);
            throw new Error('후반 초기화 실패');
        }));
        expect(r[0]).toMatchObject({ stage: 'runtime_failed', reason: '후반 초기화 실패' });
        expect(close).toHaveBeenCalledTimes(1);
        expect(contributedBuiltInTools().map((t) => t.tool.name)).not.toContain('beta_tool');
        expect(hostSignal?.aborted).toBe(true);
        expect(getAddonLifecycleRecord('beta')?.disposables).toEqual([]);
        const before = ticks;
        await sleep(30);
        expect(ticks).toBe(before); // 타이머가 지워져 더 발화하지 않는다
    });

    it('시작은 끝났지만 게시 대조에 실패하면 돌려준 handle 도 즉시 정지(drain=false)한다', async () => {
        const stop = jest.fn(async (_o: AddonRuntimeStopOptions) => undefined);
        const r = await bootAddons([addon('gamma', ['knowledge.retrieve'])], deps(async () => ({ stop })));
        expect(r[0].stage).toBe('runtime_failed');
        expect(stop).toHaveBeenCalledTimes(1);
        expect(stop.mock.calls[0][0].drain).toBe(false);
        expect(getAddonLifecycleRecord('gamma')?.handle).toBeNull();
    });

    it('회수는 두 번 불러도 안전하다(정리 함수 1회, 두 번째는 0건)', async () => {
        const close = jest.fn();
        await bootAddons([addon('delta')], deps(async (_a, _ref, host) => {
            host.registerDisposable('conn', close);
            contributeBuiltInTools('delta', [fakeTool('delta_tool')]);
        }));
        const first = await releaseAddonResources('delta');
        const second = await releaseAddonResources('delta');
        expect(first).toEqual({ disposed: ['conn'], tools: 1, capabilities: [] });
        expect(second).toEqual({ disposed: [], tools: 0, capabilities: [] });
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('동시에 두 번 정지해도 handle.stop 은 한 번만 불리고 둘 다 끝난다', async () => {
        let release!: () => void;
        const stop = jest.fn((_o: AddonRuntimeStopOptions) => new Promise<void>((r) => { release = r; }));
        await bootAddons([addon('eps')], deps(async () => ({ stop })));
        const a = stopAddon('eps', { drain: true, timeoutMs: 1_000 });
        const b = stopAddon('eps', { drain: true, timeoutMs: 1_000 });
        await sleep(5);
        expect(getAddonRuntimeStatus('eps').status).toBe('stopping');
        release();
        expect(await Promise.all([a, b])).toEqual(['stopped', 'already_stopped']);
        expect(stop).toHaveBeenCalledTimes(1);
    });

    it('drain 이 시간 제한을 넘으면 signal 로 취소를 알리고 더 기다리지 않는다', async () => {
        let sawAbort = false;
        // 취소 신호를 받고도 끝내지 않는 런타임 — 호스트는 그래도 돌아와야 한다
        const stop = jest.fn((o: AddonRuntimeStopOptions) => new Promise<void>(() => {
            o.signal.addEventListener('abort', () => { sawAbort = true; }, { once: true });
        }));
        await bootAddons([addon('zeta')], deps(async () => ({ stop })));
        const startedAt = Date.now();
        expect(await stopAddon('zeta', { drain: true, timeoutMs: 30 })).toBe('stopped');
        expect(Date.now() - startedAt).toBeLessThan(1_000);
        expect(sawAbort).toBe(true);
        expect(getAddonRuntimeStatus('zeta').status).toBe('stopped');
    });

    it('시작이 시간 제한을 넘으면 runtime_failed 로 회수하고 host.signal 을 끊는다', async () => {
        let hostSignal: AbortSignal | undefined;
        const r = await bootAddons([addon('eta')], deps(async (_a, _ref, host) => {
            hostSignal = host.signal;
            await new Promise<void>(() => undefined);
        }, { startTimeoutMs: 30 }));
        expect(r[0].stage).toBe('runtime_failed');
        expect(r[0].reason).toContain('시작 시간 초과');
        expect(hostSignal?.aborted).toBe(true);
    });

    it('handle 을 돌려주지 않은 기존 진입점은 ready 이고, 정지는 상태만 바꾼다', async () => {
        const r = await bootAddons([addon('theta')], deps(async () => undefined));
        expect(r[0].stage).toBe('ready');
        expect(getAddonLifecycleRecord('theta')?.handle).toBeNull();
        expect(await stopAddon('theta', { drain: true, timeoutMs: 30 })).toBe('stopped');
        expect(getAddonRuntimeStatus('theta').status).toBe('stopped');
    });

    it('시간 제한 값이 잘못돼도(env 오입력 NaN) 시작은 상한 없이 진행되고, 정지는 즉시 취소로 끝난다', async () => {
        let sawAbort = false;
        // 이미 끊긴 signal 은 abort 이벤트가 다시 오지 않는다 — 런타임은 signal.aborted 로 본다
        const stop = jest.fn((o: AddonRuntimeStopOptions) => new Promise<void>(() => { sawAbort = o.signal.aborted; }));
        const r = await bootAddons([addon('iota')], deps(async () => ({ stop }), { startTimeoutMs: Number.NaN }));
        expect(r[0].stage).toBe('ready');
        expect(await stopAddon('iota', { drain: true, timeoutMs: Number.NaN })).toBe('stopped');
        expect(sawAbort).toBe(true);
        expect(getAddonRuntimeStatus('iota').status).toBe('stopped');
    });

    it('Node 타이머 상한(2^31-1)을 넘는 값도 잘못된 값으로 본다 — 1ms 로 바뀌어 즉시 시간 초과되지 않는다', async () => {
        const r = await bootAddons([addon('kappa')], deps(async () => { await sleep(20); }, { startTimeoutMs: 2 ** 31 }));
        expect(r[0].stage).toBe('ready');
    });

    it('시작 실패 보상은 끝나지 않는 stop·정리 함수가 있어도 상한 안에 돌아오고 나머지 정리는 계속한다', async () => {
        const close = jest.fn();
        const stop = jest.fn((_o: AddonRuntimeStopOptions) => new Promise<void>(() => undefined));
        await bootAddons([addon('lambda')], deps(async (_a, _ref, host) => {
            host.registerDisposable('first', close);
            host.registerDisposable('stuck', () => new Promise<void>(() => undefined));
            return { stop };
        }));
        const startedAt = Date.now();
        const released = await releaseAddonResources('lambda', 30);
        expect(Date.now() - startedAt).toBeLessThan(1_000);
        expect(stop).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
        expect(released.disposed).toEqual(['first']);
    });

    it('전체 정지는 끝나지 않는 정리 함수가 있어도 예산 안에 돌아온다', async () => {
        const close = jest.fn();
        await bootAddons([addon('mu')], deps(async (_a, _ref, host) => {
            host.registerDisposable('first', close);
            host.registerDisposable('stuck', () => new Promise<void>(() => undefined));
        }));
        const startedAt = Date.now();
        await stopAllAddons({ drain: true, budgetMs: 30 });
        expect(Date.now() - startedAt).toBeLessThan(1_000);
        expect(close).toHaveBeenCalledTimes(1);
        expect(getAddonRuntimeStatus('mu').status).toBe('stopped');
    });
});
