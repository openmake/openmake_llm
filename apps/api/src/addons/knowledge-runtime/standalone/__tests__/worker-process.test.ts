/**
 * 별도 worker 본체 — 스키마 대기·설정 오류, external 소비자 기동·즉시 heartbeat, 127.0.0.1 /health, drain 정지(멱등).
 * DB·worker·heartbeat 는 mock. /health 는 실제 HTTP(빈 포트)로 확인한다.
 */
import { createServer } from 'node:net';

let mockSchemaRows = 1;
jest.mock('../../db', () => ({
    kdb: () => ({
        query: async (sql: string) => (sql.includes('FROM migration_versions') ? { rows: [], rowCount: mockSchemaRows } : { rows: [], rowCount: 0 }),
    }),
}));
const writeWorkerHeartbeat = jest.fn(async (..._a: unknown[]) => ({ dbMode: 'external', generation: 4 }));
const removeWorkerHeartbeat = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../jobs/heartbeat-row', () => ({
    writeWorkerHeartbeat: (...a: unknown[]) => writeWorkerHeartbeat(...a),
    removeWorkerHeartbeat: (...a: unknown[]) => removeWorkerHeartbeat(...a),
}));
const warmAddonStates = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../../../runtime-ports/addon-admission', () => ({ warmAddonStates: (...a: unknown[]) => warmAddonStates(...a) }));
const ctorArgs: unknown[] = [];
const workerStop = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../jobs/worker', () => ({
    KnowledgeWorker: class {
        readonly id = 'w-test';
        constructor(deps: unknown) { ctorArgs.push(deps); }
        async tick(): Promise<number> { return 0; }
        stop(...a: unknown[]): Promise<void> { return workerStop(...a); }
        health() { return { status: 'running', inflight: 0 }; }
        lastClaimAt(): number | null { return null; }
    },
}));

import { AddonWorkerConfigError } from '../../../../addon-host/worker-entry';
import { runKnowledgeWorkerProcess } from '../worker-process';
import { KNOWLEDGE_RUNTIME } from '../../constants';

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const s = createServer();
        s.once('error', reject);
        s.listen(0, '127.0.0.1', () => {
            const a = s.address();
            s.close(() => resolve(typeof a === 'object' && a ? a.port : 0));
        });
    });
}

beforeEach(() => {
    mockSchemaRows = 1;
    ctorArgs.length = 0;
    writeWorkerHeartbeat.mockClear();
    removeWorkerHeartbeat.mockClear();
    warmAddonStates.mockClear();
    workerStop.mockClear();
});

describe('runKnowledgeWorkerProcess', () => {
    it('필수 스키마(004)가 끝내 없으면 WorkerConfigError — heartbeat·worker 없음', async () => {
        mockSchemaRows = 0;
        await expect(runKnowledgeWorkerProcess({ healthPort: 0, migrationWaitMs: 0 })).rejects.toBeInstanceOf(AddonWorkerConfigError);
        expect(writeWorkerHeartbeat).not.toHaveBeenCalled();
        expect(ctorArgs).toHaveLength(0);
    });

    it('스키마가 있으면 상태 캐시를 채우고 external 소비자로 기동해 heartbeat 를 바로 한 번 쓴다', async () => {
        const handle = await runKnowledgeWorkerProcess({ healthPort: 0 });
        try {
            expect(warmAddonStates).toHaveBeenCalledTimes(1);
            expect(ctorArgs).toEqual([{ consumerKind: 'external' }]);
            expect(writeWorkerHeartbeat).toHaveBeenCalledWith({ workerId: 'w-test', kind: 'external', inflight: 0 });
            expect(handle.workerId).toBe('w-test');
            expect(handle.healthPort()).toBeNull();
            expect(handle.shutdownTimeoutMs).toBe(KNOWLEDGE_RUNTIME.WORKER_SHUTDOWN_TIMEOUT_MS);
        } finally {
            await handle.stop('test');
        }
    });

    it('/health 는 127.0.0.1 에서 상태를 JSON 으로, 다른 경로는 404', async () => {
        const port = await freePort();
        const handle = await runKnowledgeWorkerProcess({ healthPort: port });
        try {
            expect(handle.healthPort()).toBe(port);
            const res = await fetch(`http://127.0.0.1:${port}/health`);
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({
                status: 'running', inflight: 0, kind: 'external', workerId: 'w-test', dbMode: 'external', generation: 4,
                lastClaimAt: null, lastHeartbeatAt: expect.any(String),
            });
            expect((await fetch(`http://127.0.0.1:${port}/metrics`)).status).toBe(404);
        } finally {
            await handle.stop('test');
        }
    });

    it('stop 은 drain 으로 worker 를 멈추고 heartbeat 행을 지우고 /health 를 닫는다 — 두 번 불러도 한 번', async () => {
        const port = await freePort();
        const handle = await runKnowledgeWorkerProcess({ healthPort: port, drainTimeoutMs: 1_000 });
        await handle.stop('SIGTERM');
        await handle.stop('again');
        expect(workerStop).toHaveBeenCalledTimes(1);
        const [opts] = workerStop.mock.calls[0] as unknown as [{ drain: boolean; signal: AbortSignal }];
        expect(opts.drain).toBe(true);
        expect(opts.signal).toBeInstanceOf(AbortSignal);
        expect(removeWorkerHeartbeat).toHaveBeenCalledWith('w-test');
        expect(handle.healthPort()).toBeNull();
        await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
    });
});
