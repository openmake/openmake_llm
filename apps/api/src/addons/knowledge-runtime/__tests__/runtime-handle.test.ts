// apps/api/src/addons/knowledge-runtime/__tests__/runtime-handle.test.ts
/**
 * Knowledge 런타임 handle — 정지 중 claim 없음(stop-admission), drain 이 진행 작업을 기다림, 시간 초과면 lease 상실·반납,
 * resume 뒤 claim 재개, claim 진행 중 정지되면 집은 작업을 실행하지 않고 반납, 끝난 핸들러라도 lease 를 잃었으면 done 을 쓰지 않음. DB 는 SQL 문자열로 분기하는 가짜 kdb.
 */
import { createJobLease, type JobLease } from '../jobs/lease';
import type { AddonRuntimeHost } from '../../../addon-host';

const queries: Array<{ sql: string; params: unknown[] }> = [];
let claimRows: unknown[] = [];
/** 있으면 claim 쿼리가 이 약속이 풀릴 때까지 멈춘다(claim 진행 중 정지 재현) */
let claimGate: Promise<void> | null = null;
/** 있으면 heartbeat 갱신 쿼리가 이 약속이 풀릴 때까지 멈춘다(반납과 겹친 갱신 재현) */
let renewGate: Promise<void> | null = null;
jest.mock('../db', () => ({
    kdb: () => ({
        query: async (sql: string, params: unknown[]) => {
            queries.push({ sql, params });
            if (sql.includes("SET state = 'running'")) {
                if (claimGate) await claimGate;
                const rows = claimRows;
                claimRows = [];
                return { rows, rowCount: rows.length };
            }
            if (sql.includes(RENEW_SQL) && renewGate) await renewGate;
            return { rows: [], rowCount: 1 };
        },
    }),
    inTransaction: async () => { throw new Error('이 테스트는 트랜잭션을 쓰지 않는다'); },
}));
jest.mock('../config/profiles', () => ({
    getDefaultLimits: async () => ({ ingestConcurrency: 1, jobLeaseMs: 60_000, jobMaxAttempts: 3 }),
}));
const ingestVersion = jest.fn();
jest.mock('../ingestion/pipeline', () => ({ ingestVersion: (...a: unknown[]) => ingestVersion(...a) }));
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

import { KnowledgeWorker } from '../jobs/worker';
import { startKnowledgeRuntime, stopKnowledgeRuntime } from '../index';
import { KNOWLEDGE_RUNTIME } from '../constants';

const JOB = { id: 'job-1', kind: 'ingest', document_version_id: 'v1', space_id: null, embedding_index_id: null, attempts: 1, fencing_token: '7' };
const RELEASE_SQL = 'SET lease_expires_at = NOW(), updated_at = NOW()';
const RENEW_SQL = "SET lease_expires_at = NOW() + ($3::bigint";
const sqlWith = (s: string) => queries.filter((q) => q.sql.includes(s));
const claims = () => sqlWith("SET state = 'running'");
const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}

/** private heartbeat 갱신을 직접 부른다 — 주기(≥1s)를 기다리지 않고 경계만 확인한다 */
function renewOf(w: KnowledgeWorker): (lease: JobLease, leaseMs: number) => Promise<void> {
    const r = (w as unknown as { renew: (lease: JobLease, leaseMs: number) => Promise<void> }).renew;
    return (lease, leaseMs) => r.call(w, lease, leaseMs);
}

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

beforeEach(() => {
    queries.length = 0;
    claimRows = [{ ...JOB }];
    claimGate = null;
    renewGate = null;
    ingestVersion.mockReset();
});
afterEach(async () => { await stopKnowledgeRuntime(); });

describe('KnowledgeWorker 정지·재개', () => {
    it('stop 뒤 tick 은 claim 하지 않는다(stop-admission)', async () => {
        const w = new KnowledgeWorker();
        await w.stop({ drain: true, signal: new AbortController().signal });
        expect(await w.tick()).toBe(0);
        expect(claims()).toHaveLength(0);
        expect(w.health()).toEqual({ status: 'stopped', inflight: 0 });
    });

    it('drain 은 진행 중 작업이 끝날 때까지 기다리고, 그 작업은 done 을 쓴다', async () => {
        const gate = deferred<{ status: string; chunkCount: number }>();
        ingestVersion.mockImplementation(() => gate.promise);
        const w = new KnowledgeWorker();
        const ticking = w.tick();
        await flush();
        expect(w.health()).toEqual({ status: 'running', inflight: 1 });

        let stopped = false;
        const stopping = w.stop({ drain: true, signal: new AbortController().signal }).then(() => { stopped = true; });
        await flush();
        expect(stopped).toBe(false);
        expect(w.health()).toEqual({ status: 'draining', inflight: 1 });

        gate.resolve({ status: 'ready', chunkCount: 1 });
        await ticking;
        await stopping;
        expect(stopped).toBe(true);
        expect(sqlWith("SET state = 'done'")).toHaveLength(1);
        expect(sqlWith(RELEASE_SQL)).toHaveLength(0);
    });

    it('drain 시간이 넘으면 진행 중 작업의 lease 를 상실 처리하고 반납한다 — done·queued·failed 를 쓰지 않는다', async () => {
        let seen: JobLease | undefined;
        ingestVersion.mockImplementation(async (_v: string, deps: { lease: JobLease }) => {
            seen = deps.lease;
            await new Promise<void>((resolve) => deps.lease.signal.addEventListener('abort', () => resolve(), { once: true }));
            deps.lease.throwIfLost();
        });
        const w = new KnowledgeWorker();
        const ticking = w.tick();
        await flush();

        const limit = new AbortController();
        const stopping = w.stop({ drain: true, signal: limit.signal });
        limit.abort();
        await stopping;
        await ticking;

        expect(seen?.signal.aborted).toBe(true);
        const release = sqlWith(RELEASE_SQL);
        expect(release).toHaveLength(1);
        expect(release[0].params).toEqual(['job-1', '7', seen?.owner]);
        expect(sqlWith("SET state = 'done'")).toHaveLength(0);
        expect(sqlWith("SET state = 'queued'")).toHaveLength(0);
        expect(sqlWith("SET state = 'failed'")).toHaveLength(0);
        expect(w.health()).toEqual({ status: 'stopped', inflight: 0 });
    });

    it('drain=false 는 기다리지 않고 바로 lease 를 반납한다', async () => {
        ingestVersion.mockImplementation(async (_v: string, deps: { lease: JobLease }) => {
            await new Promise<void>((resolve) => deps.lease.signal.addEventListener('abort', () => resolve(), { once: true }));
            deps.lease.throwIfLost();
        });
        const w = new KnowledgeWorker();
        const ticking = w.tick();
        await flush();
        await w.stop({ drain: false, signal: new AbortController().signal });
        await ticking;
        expect(sqlWith(RELEASE_SQL)).toHaveLength(1);
        expect(sqlWith("SET state = 'done'")).toHaveLength(0);
    });

    it('resume 뒤 다시 claim 한다', async () => {
        ingestVersion.mockResolvedValue({ status: 'ready', chunkCount: 1 });
        const w = new KnowledgeWorker();
        await w.stop({ drain: false, signal: AbortSignal.abort() });
        expect(await w.tick()).toBe(0);
        w.resume();
        expect(w.health()).toEqual({ status: 'running', inflight: 0 });
        expect(await w.tick()).toBe(1);
        expect(claims()).toHaveLength(1);
    });

    it('claim 진행 중 정지되면 집은 작업을 실행하지 않고 lease 를 반납한다 — 그동안 health 는 draining', async () => {
        const gate = deferred<void>();
        claimGate = gate.promise;
        claimRows = [{ ...JOB }, { ...JOB, id: 'job-2', fencing_token: '9' }];
        const w = new KnowledgeWorker();
        const ticking = w.tick();
        await flush();
        expect(claims()).toHaveLength(1); // claim 쿼리가 나가 멈춰 있다

        await w.stop({ drain: false, signal: new AbortController().signal });
        expect(w.health()).toEqual({ status: 'draining', inflight: 0 });

        gate.resolve();
        expect(await ticking).toBe(0);
        expect(ingestVersion).not.toHaveBeenCalled();
        const release = sqlWith(RELEASE_SQL);
        expect(release).toHaveLength(2);
        expect(release.map((q) => q.params.slice(0, 2))).toEqual([['job-1', '7'], ['job-2', '9']]);
        expect(sqlWith("SET state = 'done'")).toHaveLength(0);
        expect(sqlWith("SET state = 'queued'")).toHaveLength(0);
        expect(sqlWith("SET state = 'failed'")).toHaveLength(0);
        expect(w.health()).toEqual({ status: 'stopped', inflight: 0 });
    });

    it('lease 를 잃은 뒤의 heartbeat 는 반납한 lease 를 다시 늘리지 않는다', async () => {
        const w = new KnowledgeWorker();
        const lease = createJobLease({ jobId: 'job-1', token: '7', owner: 'o' });
        lease.markLost('테스트 — 정지 반납');
        await renewOf(w)(lease, 60_000);
        expect(sqlWith(RENEW_SQL)).toHaveLength(0);
    });

    it('반납과 겹쳐 이미 나간 heartbeat 가 뒤에 커밋되면 다시 반납한다', async () => {
        const gate = deferred<void>();
        renewGate = gate.promise;
        const w = new KnowledgeWorker();
        const lease = createJobLease({ jobId: 'job-1', token: '7', owner: 'o' });
        const renewing = renewOf(w)(lease, 60_000);
        await flush();
        lease.markLost('테스트 — 갱신 진행 중 정지');
        gate.resolve();
        await renewing;
        const release = sqlWith(RELEASE_SQL);
        expect(release).toHaveLength(1);
        expect(release[0].params).toEqual(['job-1', '7', 'o']);
    });

    it('성공한 핸들러라도 그 사이 lease 를 잃었으면 done 을 쓰지 않는다', async () => {
        ingestVersion.mockImplementation(async (_v: string, deps: { lease: JobLease }) => {
            deps.lease.markLost('테스트 — 핸들러 끝 직전 상실');
            return { status: 'ready', chunkCount: 1 };
        });
        await new KnowledgeWorker().tick();
        expect(sqlWith("SET state = 'done'")).toHaveLength(0);
        expect(sqlWith("SET state = 'queued'")).toHaveLength(0);
        expect(sqlWith("SET state = 'failed'")).toHaveLength(0);
    });
});

describe('startKnowledgeRuntime handle', () => {
    it('폴링은 host.setInterval 로 걸고, handle 의 stop·resume·health 가 worker 에 닿는다', async () => {
        ingestVersion.mockResolvedValue({ status: 'ready', chunkCount: 1 });
        const intervals: Array<{ fn: () => void; ms: number }> = [];
        const handle = await startKnowledgeRuntime(fakeHost(intervals));
        expect(intervals).toHaveLength(1);
        expect(intervals[0].ms).toBe(KNOWLEDGE_RUNTIME.JOB_POLL_INTERVAL_MS);
        expect(handle.health?.()).toEqual({ status: 'running', inflight: 0 });

        await handle.stop({ drain: true, signal: new AbortController().signal });
        intervals[0].fn();
        await flush();
        expect(claims()).toHaveLength(0);
        expect(handle.health?.()).toEqual({ status: 'stopped', inflight: 0 });

        await handle.resume?.();
        intervals[0].fn();
        await flush();
        await flush();
        expect(claims()).toHaveLength(1);
    });
});
