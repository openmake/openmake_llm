/**
 * Knowledge 런타임은 두 모드 모두 /api/health 에 knowledge 절을 등록하고, 정리 때 해제한다.
 */
import type { AddonRuntimeHost } from '../../../addon-host';

jest.mock('../db', () => ({ kdb: () => ({ query: async () => ({ rows: [], rowCount: 0 }) }), inTransaction: jest.fn() }));
jest.mock('../config/profiles', () => ({ getDefaultLimits: async () => ({ ingestConcurrency: 1, jobLeaseMs: 60_000, jobMaxAttempts: 3 }) }));
jest.mock('../ingestion/pipeline', () => ({ ingestVersion: jest.fn() }));
jest.mock('../embedding/index-manager', () => ({ runReindexJob: jest.fn() }));
jest.mock('../jobs/rechunk', () => ({ rechunkSpace: jest.fn() }));
jest.mock('../jobs/cleanup', () => ({ runCleanup: jest.fn() }));
jest.mock('../documents/storage', () => ({ deleteStoredFile: jest.fn() }));
jest.mock('../../../runtime-ports/addon-admission', () => ({
    readAddonRunVerdict: async () => ({ run: true }), checkUserEntitlement: async () => 'ok',
    readAddonStateRevision: async () => 1, warmAddonStates: async () => undefined,
}));
jest.mock('../jobs/heartbeat-row', () => ({ writeWorkerHeartbeat: jest.fn(async () => ({ dbMode: null, generation: null })), removeWorkerHeartbeat: jest.fn(async () => undefined) }));
let mockMode: 'inprocess' | 'external' = 'inprocess';
jest.mock('../config/worker-mode', () => ({ configuredWorkerMode: () => mockMode, configuredWorkerHealthPort: () => 0 }));
const queueHealth = { mode: 'external', generation: 7, workerHeartbeatAgeMs: 900, queueOldestAgeMs: null, inflight: 1 };
jest.mock('../jobs/worker-status', () => ({ readKnowledgeQueueHealth: async () => queueHealth }));

import { collectHealthSections, resetHealthSectionsForTest } from '../../../runtime-ports/health-sections';
import { startKnowledgeRuntime, stopKnowledgeRuntime } from '../index';

function capturingHost(disposables: Array<{ name: string; dispose: () => void | Promise<void> }>): AddonRuntimeHost {
    return {
        owner: { addonId: 'knowledge-runtime', addonVersion: '1.0.0', source: 'builtin' },
        signal: new AbortController().signal,
        registerCapabilities: () => undefined,
        registerDisposable: (name, dispose) => { disposables.push({ name, dispose }); },
        setInterval: () => setTimeout(() => undefined, 0),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
    };
}

afterEach(async () => {
    await stopKnowledgeRuntime();
    resetHealthSectionsForTest();
});

describe('knowledge 헬스 절', () => {
    it.each(['inprocess', 'external'] as const)('%s 모드에서도 knowledge 절을 등록하고 정리 때 해제한다', async (mode) => {
        mockMode = mode;
        const disposables: Array<{ name: string; dispose: () => void | Promise<void> }> = [];
        await startKnowledgeRuntime(capturingHost(disposables));
        await expect(collectHealthSections()).resolves.toEqual({ knowledge: queueHealth });
        await disposables.find((d) => d.name === 'knowledge-health-section')?.dispose();
        await expect(collectHealthSections()).resolves.toEqual({});
    });
});

describe('정지된 inprocess worker 의 heartbeat', () => {
    it('관리자 정지(handle.stop) 뒤에는 heartbeat 행을 갱신하지 않는다 — /api/health 가 정지된 소비자를 살아 있다고 보지 않게', async () => {
        mockMode = 'inprocess';
        const { writeWorkerHeartbeat } = jest.requireMock('../jobs/heartbeat-row') as { writeWorkerHeartbeat: jest.Mock };
        writeWorkerHeartbeat.mockClear();
        const intervals: Array<() => void> = [];
        const host: AddonRuntimeHost = {
            ...capturingHost([]),
            setInterval: (fn) => { intervals.push(fn); return setTimeout(() => undefined, 0); },
        };
        const handle = await startKnowledgeRuntime(host);
        const beat = intervals[1];
        beat?.();
        await new Promise((r) => setImmediate(r));
        expect(writeWorkerHeartbeat).toHaveBeenCalledTimes(1);
        await handle.stop({ drain: true, signal: new AbortController().signal });
        beat?.();
        await new Promise((r) => setImmediate(r));
        expect(writeWorkerHeartbeat).toHaveBeenCalledTimes(1);
        await handle.resume?.();
        beat?.();
        await new Promise((r) => setImmediate(r));
        expect(writeWorkerHeartbeat).toHaveBeenCalledTimes(2);
    });
});
