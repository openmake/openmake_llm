/**
 * API inprocess 소비자도 heartbeat 행을 쓴다(/api/health 가 현재 모드 소비자의 생존을 본다) — 호스트 타이머로 걸고 정리 때 지운다.
 * external 설정이면 이 프로세스는 소비자가 아니라 쓰지 않는다.
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
let mockMode: 'inprocess' | 'external' = 'inprocess';
jest.mock('../config/worker-mode', () => ({ configuredWorkerMode: () => mockMode, configuredWorkerHealthPort: () => 0 }));
const writeWorkerHeartbeat = jest.fn(async (..._a: unknown[]) => ({ dbMode: 'inprocess', generation: 1 }));
const removeWorkerHeartbeat = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../jobs/heartbeat-row', () => ({
    writeWorkerHeartbeat: (...a: unknown[]) => writeWorkerHeartbeat(...a),
    removeWorkerHeartbeat: (...a: unknown[]) => removeWorkerHeartbeat(...a),
}));

import { startKnowledgeRuntime, stopKnowledgeRuntime } from '../index';
import { KNOWLEDGE_RUNTIME } from '../constants';

function capturingHost(): { host: AddonRuntimeHost; intervals: Array<{ fn: () => void; ms: number }>; disposables: Array<{ name: string; dispose: () => void | Promise<void> }> } {
    const intervals: Array<{ fn: () => void; ms: number }> = [];
    const disposables: Array<{ name: string; dispose: () => void | Promise<void> }> = [];
    const host: AddonRuntimeHost = {
        owner: { addonId: 'knowledge-runtime', addonVersion: '1.0.0', source: 'builtin' },
        signal: new AbortController().signal,
        registerCapabilities: () => undefined,
        registerDisposable: (name, dispose) => { disposables.push({ name, dispose }); },
        setInterval: (fn, ms) => { intervals.push({ fn, ms }); return setTimeout(() => undefined, 0); },
        setTimeout: (fn, ms) => setTimeout(fn, ms),
    };
    return { host, intervals, disposables };
}

beforeEach(() => { writeWorkerHeartbeat.mockClear(); removeWorkerHeartbeat.mockClear(); });
afterEach(async () => { await stopKnowledgeRuntime(); });

describe('API inprocess heartbeat 행', () => {
    it('heartbeat 주기 타이머가 inprocess 행을 쓰고, 정리 함수가 그 행을 지운다', async () => {
        mockMode = 'inprocess';
        const { host, intervals, disposables } = capturingHost();
        await startKnowledgeRuntime(host);
        // 폴링 주기와 heartbeat 주기의 기본값이 같다(5초) — 값이 아니라 등록 순서(폴링 → heartbeat)로 고른다
        expect(intervals.map((i) => i.ms)).toEqual([KNOWLEDGE_RUNTIME.JOB_POLL_INTERVAL_MS, KNOWLEDGE_RUNTIME.WORKER_HEARTBEAT_MS]);
        const beat = intervals[1];
        beat?.fn();
        await new Promise((r) => setImmediate(r));
        expect(writeWorkerHeartbeat).toHaveBeenCalledWith({ workerId: expect.stringMatching(/#\d+#[0-9a-f]{8}$/), kind: 'inprocess', inflight: 0 });
        const dispose = disposables.find((d) => d.name === 'knowledge-heartbeat-row');
        await dispose?.dispose();
        expect(removeWorkerHeartbeat).toHaveBeenCalledTimes(1);
    });

    it('external 설정이면 heartbeat 타이머가 없다', async () => {
        mockMode = 'external';
        const { host, intervals } = capturingHost();
        await startKnowledgeRuntime(host);
        expect(intervals.map((i) => i.ms)).not.toContain(KNOWLEDGE_RUNTIME.WORKER_HEARTBEAT_MS);
        expect(writeWorkerHeartbeat).not.toHaveBeenCalled();
    });
});
