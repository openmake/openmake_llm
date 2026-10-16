/**
 * 모드 — claim 이 DB 모드 행을 FOR SHARE 로 읽어 자기 종류($4)와 대조하는지, external 설정이면 API 가 poller 를 띄우지 않는지.
 * DB 는 SQL 을 기록만 하는 가짜 kdb, 설정 모드는 config/worker-mode mock.
 */
import type { AddonRuntimeHost } from '../../../addon-host';

const queries: Array<{ sql: string; params: unknown[] }> = [];
jest.mock('../db', () => ({
    kdb: () => ({
        query: async (sql: string, params: unknown[]) => {
            queries.push({ sql, params });
            return { rows: [], rowCount: 0 };
        },
    }),
    inTransaction: async () => { throw new Error('이 테스트는 트랜잭션을 쓰지 않는다'); },
}));
jest.mock('../config/profiles', () => ({
    getDefaultLimits: async () => ({ ingestConcurrency: 1, jobLeaseMs: 60_000, jobMaxAttempts: 3 }),
}));
jest.mock('../ingestion/pipeline', () => ({ ingestVersion: jest.fn() }));
jest.mock('../embedding/index-manager', () => ({ runReindexJob: jest.fn() }));
jest.mock('../jobs/rechunk', () => ({ rechunkSpace: jest.fn() }));
jest.mock('../jobs/cleanup', () => ({ runCleanup: jest.fn() }));
jest.mock('../documents/storage', () => ({ deleteStoredFile: jest.fn() }));
jest.mock('../../../runtime-ports/addon-admission', () => ({
    readAddonRunVerdict: async () => ({ run: true }),
    checkUserEntitlement: async () => 'ok',
    readAddonStateRevision: async () => 1,
    warmAddonStates: async () => undefined,
}));
let mockMode: 'inprocess' | 'external' = 'inprocess';
jest.mock('../config/worker-mode', () => ({
    configuredWorkerMode: () => mockMode,
    configuredWorkerHealthPort: () => 0,
}));

import { KnowledgeWorker } from '../jobs/worker';
import { startKnowledgeRuntime, stopKnowledgeRuntime } from '../index';
import { KNOWLEDGE_RUNTIME } from '../constants';

const claims = () => queries.filter((q) => q.sql.includes("SET state = 'running'"));

function fakeHost(intervals: Array<{ fn: () => void; ms: number }>): AddonRuntimeHost {
    return {
        owner: { addonId: 'knowledge-runtime', addonVersion: '1.0.0', source: 'builtin' },
        signal: new AbortController().signal,
        registerCapabilities: () => undefined,
        registerDisposable: () => undefined,
        setInterval: (fn, ms) => { intervals.push({ fn, ms }); return setTimeout(() => undefined, 0); },
        setTimeout: (fn, ms) => setTimeout(fn, ms),
    };
}

beforeEach(() => { queries.length = 0; });
afterEach(async () => { await stopKnowledgeRuntime(); });

describe('claim 의 모드 대조', () => {
    it('모드 행을 FOR SHARE 로 읽고 자기 종류를 $4 로 넘긴다(기본 inprocess)', async () => {
        await new KnowledgeWorker().tick();
        const [claim] = claims();
        expect(claim.sql).toMatch(/WITH m AS \(SELECT mode FROM knowledge_worker_mode WHERE id = 1 FOR SHARE\)/);
        expect(claim.sql).toMatch(/AND EXISTS \(SELECT 1 FROM m WHERE m\.mode = \$4\)/);
        expect(claim.params[3]).toBe('inprocess');
    });

    it('별도 프로세스 worker 는 external 로 대조한다', async () => {
        await new KnowledgeWorker({ consumerKind: 'external' }).tick();
        expect(claims()[0].params[3]).toBe('external');
    });
});

describe('startKnowledgeRuntime 의 설정 모드', () => {
    it('external 이면 poller 를 띄우지 않고 handle 은 정지·재개할 것이 없다', async () => {
        mockMode = 'external';
        const intervals: Array<{ fn: () => void; ms: number }> = [];
        const handle = await startKnowledgeRuntime(fakeHost(intervals));
        expect(intervals.map((i) => i.ms)).not.toContain(KNOWLEDGE_RUNTIME.JOB_POLL_INTERVAL_MS);
        expect(handle.health?.()).toEqual({ status: 'stopped', inflight: 0, detail: expect.stringContaining('external') });
        await expect(handle.stop({ drain: true, signal: new AbortController().signal })).resolves.toBeUndefined();
        await expect(handle.resume?.()).resolves.toBeUndefined();
        expect(claims()).toHaveLength(0);
    });

    it('inprocess 면 폴링 주기로 poller 를 건다', async () => {
        mockMode = 'inprocess';
        const intervals: Array<{ fn: () => void; ms: number }> = [];
        await startKnowledgeRuntime(fakeHost(intervals));
        expect(intervals.map((i) => i.ms)).toContain(KNOWLEDGE_RUNTIME.JOB_POLL_INTERVAL_MS);
    });
});
