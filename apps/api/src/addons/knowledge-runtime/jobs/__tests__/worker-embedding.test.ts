// apps/api/src/addons/knowledge-runtime/jobs/__tests__/worker-embedding.test.ts
/**
 * worker 의 임베딩 키 정책 배선 — ingest 는 작업 행위자를 파이프라인에 넘기고, 키 실패 코드 둘은 재시도하지 않는다(done).
 * KnowledgeJobPermanentError 는 시도 횟수와 무관하게 즉시 최종 실패. reindex 는 space_id·embedding_index_id 둘 다 있어야 한다
 * (006 이전 전역 reindex 잔재는 명시 실패). DB 는 SQL 문자열로 분기하는 가짜 kdb.
 */
const queries: Array<{ sql: string; params: unknown[] }> = [];
let claimRows: unknown[] = [];
jest.mock('../../db', () => ({
    kdb: () => ({
        query: async (sql: string, params: unknown[]) => {
            queries.push({ sql, params });
            if (sql.includes("SET state = 'running'")) return { rows: claimRows, rowCount: claimRows.length };
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
const runSpaceReindexJob = jest.fn();
jest.mock('../../embedding/space-reindex', () => ({ runSpaceReindexJob: (...a: unknown[]) => runSpaceReindexJob(...a) }));
jest.mock('../rechunk', () => ({ rechunkSpace: jest.fn() }));
jest.mock('../cleanup', () => ({ runCleanup: jest.fn() }));
jest.mock('../../documents/storage', () => ({ deleteStoredFile: jest.fn() }));
jest.mock('../../../../runtime-ports/addon-admission', () => ({
    readAddonRunVerdict: async () => ({ run: true }),
    checkUserEntitlement: async () => 'ok',
    readAddonStateRevision: async () => 1,
    warmAddonStates: async () => undefined,
}));

import { KnowledgeWorker } from '../worker';
import { KnowledgeJobPermanentError } from '../errors';

const BASE = { attempts: 1, fencing_token: '7', actor_kind: 'user', actor_user_id: 'u1', org_id: null, policy_revision: 1, cancel_requested_at: null };
const INGEST = { ...BASE, id: 'job-1', kind: 'ingest', document_version_id: 'v1', space_id: null, embedding_index_id: null };
const REINDEX = { ...BASE, id: 'job-2', kind: 'reindex', document_version_id: null, space_id: 's1', embedding_index_id: 'idx-new' };
const sqlWith = (s: string) => queries.filter((q) => q.sql.includes(s));

beforeEach(() => {
    queries.length = 0;
    ingestVersion.mockReset();
    runSpaceReindexJob.mockReset();
});

describe('worker — 임베딩 키 정책', () => {
    it('ingest 는 job.actor_user_id 를 actorUserId 로 넘긴다(NULL 이면 undefined)', async () => {
        ingestVersion.mockResolvedValue({ status: 'ready', chunkCount: 1 });
        claimRows = [INGEST];
        await new KnowledgeWorker().tick();
        expect(ingestVersion.mock.calls[0][1]).toMatchObject({ actorUserId: 'u1' });

        claimRows = [{ ...INGEST, actor_user_id: null, actor_kind: 'system' }];
        await new KnowledgeWorker().tick();
        expect(ingestVersion.mock.calls[1][1].actorUserId).toBeUndefined();
    });

    it.each(['EMBEDDING_KEY_MISSING', 'EMBEDDING_KEY_REJECTED'])('수집 실패 %s 는 재시도하지 않는다(작업 done)', async (code) => {
        ingestVersion.mockResolvedValue({ status: 'failed', failureCode: code });
        claimRows = [INGEST];
        await new KnowledgeWorker().tick();
        expect(sqlWith("SET state = 'done'")).toHaveLength(1);
        expect(sqlWith("SET state = 'queued'")).toHaveLength(0);
    });

    it('FAILED_EMBEDDING 은 종전대로 백오프 재시도', async () => {
        ingestVersion.mockResolvedValue({ status: 'failed', failureCode: 'FAILED_EMBEDDING' });
        claimRows = [INGEST];
        await new KnowledgeWorker().tick();
        expect(sqlWith("SET state = 'queued'")).toHaveLength(1);
    });

    it('KnowledgeJobPermanentError 는 첫 시도여도 즉시 failed(last_error 에 코드)', async () => {
        runSpaceReindexJob.mockRejectedValue(new KnowledgeJobPermanentError('키 없음', 'EMBEDDING_KEY_MISSING'));
        claimRows = [REINDEX];
        await new KnowledgeWorker().tick();
        const failed = sqlWith("SET state = 'failed'");
        expect(failed).toHaveLength(1);
        expect(String(failed[0].params[2])).toContain('EMBEDDING_KEY_MISSING');
        expect(sqlWith("SET state = 'queued'")).toHaveLength(0);
    });

    it('reindex 는 공간·대상 색인·행위자로 공간 재색인을 돌린다', async () => {
        claimRows = [REINDEX];
        await new KnowledgeWorker().tick();
        expect(runSpaceReindexJob).toHaveBeenCalledWith(
            { spaceId: 's1', indexId: 'idx-new', actorUserId: 'u1' },
            expect.objectContaining({ lease: expect.anything() }),
        );
        expect(sqlWith("SET state = 'done'")).toHaveLength(1);
    });

    it('space_id 없는 reindex(006 이전 전역 잔재)는 실행 없이 즉시 failed', async () => {
        claimRows = [{ ...REINDEX, space_id: null }];
        await new KnowledgeWorker().tick();
        expect(runSpaceReindexJob).not.toHaveBeenCalled();
        const failed = sqlWith("SET state = 'failed'");
        expect(failed).toHaveLength(1);
        expect(String(failed[0].params[2])).toContain('공간 단위');
    });
});
