// apps/api/src/addons/knowledge-runtime/jobs/__tests__/worker-cancel.test.ts
/**
 * worker 취소 — heartbeat 가 cancel_requested_at 을 읽으면 단계 경계에서 멈추고 lease 를 쥔 채 cancelled 로 마감.
 * 취소 요청된 채 다시 집힌 작업은 핸들러 없이 cancelled. 핸들러가 끝난 뒤 취소가 표시되면 done.
 * DB 는 SQL 문자열로 분기하는 가짜 kdb.
 */
import type { JobLease } from '../lease';
import type { AdmissionPort } from '../admission';

const queries: Array<{ sql: string; params: unknown[] }> = [];
let claimRows: unknown[] = [];
let cancelAt: Date | null = null;
jest.mock('../../db', () => {
    const query = async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        if (sql.includes("SET state = 'running'")) {
            const rows = claimRows;
            claimRows = [];
            return { rows, rowCount: rows.length };
        }
        if (sql.includes('RETURNING cancel_requested_at')) return { rows: [{ cancel_requested_at: cancelAt }], rowCount: 1 };
        if (sql.includes('RETURNING kind, document_version_id')) return { rows: [{ kind: 'ingest', document_version_id: 'v1' }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
    };
    return { kdb: () => ({ query }), inTransaction: async (fn: (c: { query: typeof query }) => Promise<unknown>) => fn({ query }) };
});
jest.mock('../../config/profiles', () => ({
    getDefaultLimits: async () => ({ ingestConcurrency: 1, jobLeaseMs: 60_000, jobMaxAttempts: 3 }),
}));
const ingestVersion = jest.fn();
jest.mock('../../ingestion/pipeline', () => ({ ingestVersion: (...a: unknown[]) => ingestVersion(...a) }));
jest.mock('../../embedding/index-manager', () => ({ runReindexJob: jest.fn() }));
jest.mock('../rechunk', () => ({ rechunkSpace: jest.fn() }));
jest.mock('../cleanup', () => ({ runCleanup: jest.fn() }));
jest.mock('../../documents/storage', () => ({ deleteStoredFile: jest.fn() }));
jest.mock('../../../../runtime-ports/addon-admission', () => ({
    readAddonRunVerdict: jest.fn(), checkUserEntitlement: jest.fn(), readAddonStateRevision: jest.fn(), warmAddonStates: jest.fn(),
}));

import { KnowledgeWorker } from '../worker';

const OK: AdmissionPort = { readRunVerdict: async () => ({ run: true }), checkUserEntitlement: async () => 'ok' };
const JOB = {
    id: 'job-1', kind: 'ingest', document_version_id: 'v1', space_id: 's1', embedding_index_id: null, attempts: 1, fencing_token: '7',
    actor_kind: 'user', actor_user_id: 'u-1', org_id: null, policy_revision: 3, cancel_requested_at: null,
};
const sqlWith = (s: string) => queries.filter((q) => q.sql.includes(s));
const flush = (): Promise<void> => new Promise((r) => setImmediate(r));
type Internals = { renew(lease: JobLease, leaseMs: number): Promise<void> };

beforeEach(() => {
    queries.length = 0;
    claimRows = [];
    cancelAt = null;
    ingestVersion.mockReset();
});

describe('KnowledgeWorker 취소', () => {
    it('실행 중 heartbeat 가 취소 요청을 읽으면 단계 경계에서 멈추고 cancelled(문서 버전 CANCELLED)로 마감한다', async () => {
        let seen: JobLease | undefined;
        ingestVersion.mockImplementation(async (_v: string, deps: { lease: JobLease }) => {
            seen = deps.lease;
            await new Promise<void>((resolve) => deps.lease.signal.addEventListener('abort', () => resolve(), { once: true }));
            deps.lease.throwIfLost();
        });
        claimRows = [JOB];
        const w = new KnowledgeWorker({ admission: OK });
        const ticking = w.tick();
        await flush();
        expect(seen).toBeDefined();

        cancelAt = new Date();
        await (w as unknown as Internals).renew(seen as JobLease, 60_000);
        await ticking;

        expect(seen?.isCancelled()).toBe(true);
        const terminal = sqlWith('SET state = $4');
        expect(terminal).toHaveLength(1);
        expect(terminal[0].params).toEqual(['job-1', '7', w.id, 'cancelled', expect.stringContaining('취소됨')]);
        expect(sqlWith('UPDATE knowledge_document_versions')[0].params).toEqual(['v1', 'CANCELLED']);
        expect(sqlWith("SET state = 'done'")).toHaveLength(0);
        expect(sqlWith("SET state = 'queued'")).toHaveLength(0);
        expect(sqlWith("SET state = 'failed'")).toHaveLength(0);
    });

    it('heartbeat 의 취소 열이 비어 있으면 계속 돈다', async () => {
        let seen: JobLease | undefined;
        ingestVersion.mockImplementation(async (_v: string, deps: { lease: JobLease }) => {
            seen = deps.lease;
            return { status: 'ready', chunkCount: 1 };
        });
        claimRows = [JOB];
        const w = new KnowledgeWorker({ admission: OK });
        await w.tick();
        await (w as unknown as Internals).renew(seen as JobLease, 60_000);
        expect(seen?.signal.aborted).toBe(false);
    });

    it('취소 요청된 채 다시 집힌 작업은 핸들러 없이 cancelled', async () => {
        claimRows = [{ ...JOB, cancel_requested_at: new Date(), attempts: 2, fencing_token: '9' }];
        const w = new KnowledgeWorker({ admission: OK });
        expect(await w.tick()).toBe(1);
        expect(ingestVersion).not.toHaveBeenCalled();
        const terminal = sqlWith('SET state = $4');
        expect(terminal[0].params).toEqual(['job-1', '9', w.id, 'cancelled', expect.stringContaining('다시 집음')]);
    });

    it('핸들러가 끝난 뒤 취소가 표시돼도 done 으로 마감한다(완성된 결과를 failed 로 덮지 않는다)', async () => {
        ingestVersion.mockImplementation(async (_v: string, deps: { lease: JobLease }) => {
            deps.lease.markCancelled('늦게 도착한 취소');
            return { status: 'ready', chunkCount: 1 };
        });
        claimRows = [JOB];
        const w = new KnowledgeWorker({ admission: OK });
        await w.tick();
        expect(sqlWith("SET state = 'done'")).toHaveLength(1);
        expect(sqlWith('SET state = $4')).toHaveLength(0);
    });
});
