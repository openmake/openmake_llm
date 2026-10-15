// apps/api/src/addons/knowledge-runtime/jobs/__tests__/worker-lease.test.ts
/**
 * worker 의 lease 처리 — 핸들러가 lease 를 받는다, heartbeat 0행이면 lease 상실, 상실로 끝난 작업은 job 행을 건드리지 않는다.
 * DB 는 SQL 문자열로 분기하는 가짜 kdb. 핸들러(ingestVersion)는 mock.
 */
import type { JobLease } from '../lease';

const queries: Array<{ sql: string; params: unknown[] }> = [];
let claimRows: unknown[] = [];
let renewRowCount = 1;
let renewThrows = false;
jest.mock('../../db', () => ({
    kdb: () => ({
        query: async (sql: string, params: unknown[]) => {
            queries.push({ sql, params });
            if (sql.includes("SET state = 'running'")) return { rows: claimRows, rowCount: claimRows.length };
            if (sql.includes('SET lease_expires_at = NOW()')) {
                if (renewThrows) throw new Error('DB 연결 끊김');
                return { rows: [], rowCount: renewRowCount };
            }
            return { rows: [], rowCount: 1 };
        },
    }),
    inTransaction: async () => { throw new Error('이 테스트는 트랜잭션을 쓰지 않는다'); },
}));
jest.mock('../../config/profiles', () => ({
    getDefaultLimits: async () => ({ ingestConcurrency: 1, jobLeaseMs: 60_000, jobMaxAttempts: 3 }),
}));
const ingestVersion = jest.fn();
jest.mock('../../ingestion/pipeline', () => ({ ingestVersion: (...a: unknown[]) => ingestVersion(...a) }));
jest.mock('../../embedding/index-manager', () => ({ runReindexJob: jest.fn() }));
jest.mock('../rechunk', () => ({ rechunkSpace: jest.fn() }));
jest.mock('../cleanup', () => ({ runCleanup: jest.fn() }));
jest.mock('../../documents/storage', () => ({ deleteStoredFile: jest.fn() }));

import { KnowledgeWorker } from '../worker';
import { LeaseLostError } from '../lease';

const JOB = { id: 'job-1', kind: 'ingest', document_version_id: 'v1', space_id: null, embedding_index_id: null, attempts: 1, fencing_token: '7' };
const sqlWith = (s: string) => queries.filter((q) => q.sql.includes(s));

beforeEach(() => {
    queries.length = 0;
    claimRows = [JOB];
    renewRowCount = 1;
    renewThrows = false;
    ingestVersion.mockReset();
});

describe('KnowledgeWorker lease', () => {
    it('핸들러는 claim 의 token(문자열)·owner 를 담은 lease 를 deps 로 받고, 성공하면 같은 token 으로 done 을 쓴다', async () => {
        ingestVersion.mockResolvedValue({ status: 'ready', chunkCount: 1 });
        const w = new KnowledgeWorker();
        expect(await w.tick()).toBe(1);
        const deps = ingestVersion.mock.calls[0][1] as { lease?: JobLease };
        expect(deps.lease?.jobId).toBe('job-1');
        expect(deps.lease?.token).toBe('7');
        expect(deps.lease?.owner).toMatch(/#\d+#[0-9a-f]{8}$/);
        expect(deps.lease?.signal.aborted).toBe(false);
        const done = sqlWith("SET state = 'done'");
        expect(done).toHaveLength(1);
        expect(done[0].params).toEqual(['job-1', '7']);
    });

    it('핸들러가 LeaseLostError 로 끝나면 done·queued·failed 어느 것도 쓰지 않는다(행은 새 실행자의 것)', async () => {
        ingestVersion.mockImplementation(async (_v: string, deps: { lease: JobLease }) => {
            deps.lease.markLost('테스트');
            deps.lease.throwIfLost();
        });
        await new KnowledgeWorker().tick();
        expect(sqlWith("SET state = 'done'")).toHaveLength(0);
        expect(sqlWith("SET state = 'queued'")).toHaveLength(0);
        expect(sqlWith("SET state = 'failed'")).toHaveLength(0);
    });

    it('일반 오류는 종전대로 재시도 예약(queued)', async () => {
        ingestVersion.mockRejectedValue(new Error('임베딩 실패'));
        await new KnowledgeWorker().tick();
        const retry = sqlWith("SET state = 'queued'");
        expect(retry).toHaveLength(1);
        expect(retry[0].params[1]).toBe('7');
    });

    it('lease 상실로 재선점이 반복돼 attempts 가 상한을 넘으면 핸들러 없이 최종 실패로 기록한다', async () => {
        claimRows = [{ ...JOB, attempts: 4 }];
        await new KnowledgeWorker().tick();
        expect(ingestVersion).not.toHaveBeenCalled();
        const failed = sqlWith("SET state = 'failed'");
        expect(failed).toHaveLength(1);
        expect(failed[0].params[0]).toBe('job-1');
        expect(failed[0].params[1]).toBe('7');
        expect(String(failed[0].params[2])).toContain('재선점 상한 초과');
        expect(String(failed[0].params[2])).toContain('attempts=4 > max=3');
    });

    it('attempts 가 상한과 같으면 종전처럼 핸들러를 부른다', async () => {
        claimRows = [{ ...JOB, attempts: 3 }];
        ingestVersion.mockResolvedValue({ status: 'ready', chunkCount: 1 });
        await new KnowledgeWorker().tick();
        expect(ingestVersion).toHaveBeenCalledTimes(1);
        expect(sqlWith("SET state = 'failed'")).toHaveLength(0);
        expect(sqlWith("SET state = 'done'")).toHaveLength(1);
    });

    it('heartbeat 갱신이 0행이면 lease 를 잃은 것으로 표시한다', async () => {
        renewRowCount = 0;
        const w = new KnowledgeWorker();
        const { createJobLease } = jest.requireActual('../lease') as typeof import('../lease');
        const lease = createJobLease({ jobId: 'job-1', token: '7', owner: 'o' });
        await (w as unknown as { renew(l: JobLease, ms: number): Promise<void> }).renew(lease, 60_000);
        expect(lease.signal.aborted).toBe(true);
        expect(() => lease.throwIfLost()).toThrow(LeaseLostError);
        const renew = sqlWith('SET lease_expires_at = NOW()');
        expect(renew[0].sql).toMatch(/lease_owner = \$4/);
        expect(renew[0].params).toEqual(['job-1', '7', 60_000, 'o']);
    });

    it('heartbeat 갱신이 1행이면 lease 는 살아 있고 renewedAt 이 갱신된다', async () => {
        let now = 1_000_000;
        const w = new KnowledgeWorker({ now: () => now });
        const { createJobLease } = jest.requireActual('../lease') as typeof import('../lease');
        const lease = createJobLease({ jobId: 'job-1', token: '7', owner: 'o', now });
        now += 5_000;
        await (w as unknown as { renew(l: JobLease, ms: number): Promise<void> }).renew(lease, 60_000);
        expect(lease.signal.aborted).toBe(false);
        expect(lease.renewedAt).toBe(1_005_000);
    });

    it('heartbeat 갱신 오류가 lease 기간을 넘겨 이어지면 lease 상실로 표시한다(그 전엔 유지)', async () => {
        renewThrows = true;
        let now = 1_000_000;
        const w = new KnowledgeWorker({ now: () => now });
        const { createJobLease } = jest.requireActual('../lease') as typeof import('../lease');
        const lease = createJobLease({ jobId: 'job-1', token: '7', owner: 'o', now });
        now += 30_000;
        await (w as unknown as { renew(l: JobLease, ms: number): Promise<void> }).renew(lease, 60_000);
        expect(lease.signal.aborted).toBe(false); // 아직 lease 기간 안 — 다음 주기에 다시 본다
        now += 30_001;
        await (w as unknown as { renew(l: JobLease, ms: number): Promise<void> }).renew(lease, 60_000);
        expect(lease.signal.aborted).toBe(true); // 마지막 성공 뒤 60초 넘게 갱신 못함 = DB 에서 lease 가 만료됐다
    });
});
