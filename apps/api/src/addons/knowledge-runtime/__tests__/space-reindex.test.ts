/**
 * 공간 재색인 실행(runSpaceReindexJob) — 그 공간의 ready·현재 버전·미삭제 문서 청크만 대상 색인으로 임베딩하고,
 * 검증 뒤 공간 포인터를 옛 색인 조건부로 바꾼다(옛 벡터는 지우지 않는다). 배치 삽입·전환 트랜잭션 첫 문장은 lease 검사,
 * 키 오류는 영구 실패(KnowledgeJobPermanentError). reindex-lease.test.ts 를 흡수했다.
 * 전환한 트랜잭션에서 그 공간의 실패 현재 버전을 "다시 시도" 와 같게 초기화하고 ingest 를 넣는다(설계 2026-11-01 PR-A).
 */
import { createJobLease, LeaseLostError } from '../jobs/lease';

/** tx: 0 은 kdb(트랜잭션 밖), 1 이상은 inTransaction 호출 순번 */
const queries: Array<{ sql: string; params: unknown[]; tx: number }> = [];
let txSeq = 0;
/** 실패 현재 버전 조회 결과 */
let failedRows: Array<{ document_id: string; version_id: string }> = [];
let leaseRowCount = 1;
let batches = 1;
let switchRowCount = 1;
let pointer: string | null = 'idx-old';
/** 전환 트랜잭션이 잠금 뒤 다시 읽는 포인터(FOR UPDATE) — undefined 면 pointer 와 같다 */
let lockedPointer: string | null | undefined;
let targetStatus = 'ready';
let verifyCounts = { expected: '1', got: '1' };
const fakeQuery = async (sql: string, params: unknown[] = [], tx = 0) => {
    queries.push({ sql, params, tx });
    if (sql.includes("v.status = 'failed'")) return { rows: failedRows, rowCount: failedRows.length };
    if (sql.includes('FROM knowledge_ingestion_jobs')) return { rows: leaseRowCount ? [{ '?column?': 1 }] : [], rowCount: leaseRowCount };
    if (sql.includes('SELECT * FROM knowledge_embedding_indexes WHERE id')) {
        return { rows: [{ id: 'idx-new', provider_ref: 'gemini:emb-1', model_id: 'gemini/emb-1', dimension: 2, distance_metric: 'cosine', status: targetStatus, request_params: {} }], rowCount: 1 };
    }
    if (sql.includes('SELECT embedding_index_id FROM knowledge_spaces') && sql.includes('FOR UPDATE')) {
        return { rows: [{ embedding_index_id: lockedPointer === undefined ? pointer : lockedPointer }], rowCount: 1 };
    }
    if (sql.includes('SELECT embedding_index_id FROM knowledge_spaces')) return { rows: [{ embedding_index_id: pointer }], rowCount: 1 };
    if (sql.includes('SELECT c.id, c.content')) { if (batches > 0) { batches -= 1; return { rows: [{ id: 'c1', content: 'x' }], rowCount: 1 }; } return { rows: [], rowCount: 0 }; }
    if (sql.includes('COUNT(*)::text AS n') && sql.includes('NOT EXISTS')) return { rows: [{ n: '0' }], rowCount: 1 };
    if (sql.includes('COUNT(*)::text AS n') && sql.includes('JOIN knowledge_chunk_embeddings')) return { rows: [{ n: verifyCounts.got }], rowCount: 1 };
    if (sql.includes('COUNT(*)::text AS n')) return { rows: [{ n: verifyCounts.expected }], rowCount: 1 };
    if (sql.includes('UPDATE knowledge_spaces SET embedding_index_id')) return { rows: [], rowCount: switchRowCount };
    return { rows: [], rowCount: 1 };
};
jest.mock('../db', () => ({
    kdb: () => ({ query: (sql: string, params?: unknown[]) => fakeQuery(sql, params, 0) }),
    inTransaction: async (fn: (c: unknown) => Promise<unknown>) => {
        const tx = ++txSeq;
        return fn({ query: (sql: string, params?: unknown[]) => fakeQuery(sql, params, tx) });
    },
}));
jest.mock('../../../runtime-ports/addon-admission', () => ({
    ...jest.requireActual('../../../runtime-ports/addon-admission'),
    readAddonStateRevision: async () => 3,
}));
const makeIndexEmbedder = jest.fn();
jest.mock('../embedding/provider', () => {
    class EmbeddingError extends Error { constructor(public readonly reason: string, m: string) { super(m); } }
    return {
        EmbeddingError,
        makeIndexEmbedder: (...a: unknown[]) => makeIndexEmbedder(...a),
        classifyEmbedError: (e: unknown) => (e instanceof EmbeddingError ? e.reason : 'provider'),
        describeLiveEmbedding: jest.fn(),
        probeDimension: jest.fn(),
    };
});

import { runSpaceReindexJob } from '../embedding/space-reindex';
import { KnowledgeJobPermanentError } from '../jobs/errors';
import { EmbeddingError, type EmbeddingFailureReason } from '../embedding/provider';

const JOB = { spaceId: 's1', indexId: 'idx-new', actor: { kind: 'org' as const, userId: 'u1', orgId: 'o1' } };
const embed = async (t: string[]) => t.map(() => [1, 0]);
const sqlWith = (s: string) => queries.filter((q) => q.sql.includes(s));

beforeEach(() => {
    queries.length = 0; txSeq = 0; failedRows = []; leaseRowCount = 1; batches = 1; switchRowCount = 1; pointer = 'idx-old'; lockedPointer = undefined; targetStatus = 'ready';
    verifyCounts = { expected: '1', got: '1' };
    makeIndexEmbedder.mockReset();
});

describe('runSpaceReindexJob', () => {
    it('행위자 키 임베더로 공간 범위 청크만 임베딩하고, 포인터를 옛 색인 조건부로 바꾼다(옛 벡터 삭제 없음)', async () => {
        makeIndexEmbedder.mockReturnValue(embed);
        await runSpaceReindexJob(JOB);
        expect(makeIndexEmbedder).toHaveBeenCalledWith(expect.objectContaining({ id: 'idx-new', providerRef: 'gemini:emb-1' }), { userId: 'u1' }, { spaceId: 's1' });
        const batch = sqlWith('SELECT c.id, c.content')[0];
        expect(batch.sql).toMatch(/d\.space_id = \$2/);
        expect(batch.params[0]).toBe('idx-new');
        expect(batch.params[1]).toBe('s1');
        const sw = sqlWith('UPDATE knowledge_spaces SET embedding_index_id')[0];
        expect(sw.sql).toMatch(/IS NOT DISTINCT FROM \$3/);
        expect(sw.params).toEqual(['s1', 'idx-new', 'idx-old']);
        expect(queries.some((q) => /DELETE FROM knowledge_chunk_embeddings/.test(q.sql))).toBe(false);
        expect(queries.some((q) => /is_active/.test(q.sql))).toBe(false);
    });

    it('검증 불일치(공간 청크 수 ≠ 대상 색인의 그 공간 임베딩 수)면 throw — 전환 없음(재시도가 채운다)', async () => {
        verifyCounts = { expected: '3', got: '1' };
        await expect(runSpaceReindexJob(JOB, { embed })).rejects.toThrow(/검증 실패/);
        expect(sqlWith('UPDATE knowledge_spaces SET embedding_index_id')).toHaveLength(0);
    });

    it('전환 UPDATE 가 0행이면 영구 실패', async () => {
        switchRowCount = 0;
        await expect(runSpaceReindexJob(JOB, { embed })).rejects.toBeInstanceOf(KnowledgeJobPermanentError);
    });

    it('잠금 뒤 다시 읽은 포인터가 이미 대상 색인이면(같은 공간의 다른 작업이 먼저 전환) 성공 — UPDATE 없음', async () => {
        lockedPointer = 'idx-new';
        await expect(runSpaceReindexJob(JOB, { embed })).resolves.toBeUndefined();
        const lockIdx = queries.findIndex((q) => q.sql.includes('pg_advisory_xact_lock'));
        const reread = queries.findIndex((q) => q.sql.includes('FOR UPDATE'));
        expect(lockIdx).toBeGreaterThanOrEqual(0);
        expect(reread).toBeGreaterThan(lockIdx);
        expect(sqlWith('UPDATE knowledge_spaces SET embedding_index_id')).toHaveLength(0);
    });

    it('잠금 뒤 포인터가 제3의 색인으로 바뀌었으면 영구 실패 — UPDATE 없음', async () => {
        lockedPointer = 'idx-third';
        await expect(runSpaceReindexJob(JOB, { embed })).rejects.toBeInstanceOf(KnowledgeJobPermanentError);
        expect(sqlWith('UPDATE knowledge_spaces SET embedding_index_id')).toHaveLength(0);
    });

    it('이미 대상 색인을 가리키면(전환 뒤 재실행) 아무것도 하지 않는다', async () => {
        pointer = 'idx-new';
        await runSpaceReindexJob(JOB, { embed });
        expect(sqlWith('SELECT c.id, c.content')).toHaveLength(0);
        expect(sqlWith('UPDATE knowledge_spaces')).toHaveLength(0);
    });

    it('대상 색인이 ready 가 아니면 영구 실패', async () => {
        targetStatus = 'retired';
        await expect(runSpaceReindexJob(JOB, { embed })).rejects.toBeInstanceOf(KnowledgeJobPermanentError);
    });

    it('키 오류(key_missing·key_rejected)는 코드를 담은 영구 실패, 그 밖 오류는 그대로 throw(백오프 재시도)', async () => {
        const failing = (reason: EmbeddingFailureReason) => async () => { throw new EmbeddingError(reason, '키'); };
        await expect(runSpaceReindexJob(JOB, { embed: failing('key_rejected') })).rejects.toMatchObject({ code: 'EMBEDDING_KEY_REJECTED' });
        batches = 1;
        await expect(runSpaceReindexJob(JOB, { embed: failing('key_missing') })).rejects.toMatchObject({ code: 'EMBEDDING_KEY_MISSING' });
        batches = 1;
        const err = await runSpaceReindexJob(JOB, { embed: failing('provider') }).catch((e) => e);
        expect(err).not.toBeInstanceOf(KnowledgeJobPermanentError);
    });

    it('lease: 배치 삽입과 전환 트랜잭션 앞에 lease 검사, 검사 0행이면 전환하지 않고 LeaseLostError', async () => {
        const lease = createJobLease({ jobId: 'j', token: '1', owner: 'o' });
        await runSpaceReindexJob(JOB, { embed, lease });
        const switchIdx = queries.findIndex((q) => q.sql.includes('UPDATE knowledge_spaces SET embedding_index_id'));
        expect(queries.slice(0, switchIdx).filter((q) => q.sql.includes('FROM knowledge_ingestion_jobs')).length).toBeGreaterThanOrEqual(2);

        queries.length = 0; batches = 1; leaseRowCount = 0;
        await expect(runSpaceReindexJob(JOB, { embed, lease: createJobLease({ jobId: 'j', token: '1', owner: 'o' }) })).rejects.toThrow(LeaseLostError);
        expect(sqlWith('UPDATE knowledge_spaces SET embedding_index_id')).toHaveLength(0);
    });
});

describe('runSpaceReindexJob — 전환 뒤 실패 문서 재수집', () => {
    it('전환한 트랜잭션에서 실패 현재 버전을 다시 시도처럼 초기화하고 작업 행위자로 ingest 를 넣는다', async () => {
        failedRows = [{ document_id: 'd1', version_id: 'v1' }, { document_id: 'd2', version_id: 'v2' }];
        await runSpaceReindexJob(JOB, { embed });
        const sw = sqlWith('UPDATE knowledge_spaces SET embedding_index_id')[0];
        const select = sqlWith("v.status = 'failed'");
        expect(select).toHaveLength(1);
        expect(select[0].sql).toMatch(/d\.space_id = \$1/);
        expect(select[0].sql).toMatch(/d\.deleted_at IS NULL/);
        expect(select[0].sql).toMatch(/d\.status <> 'deleted'/);
        expect(select[0].sql).toMatch(/v\.id = d\.current_version_id/);
        expect(select[0].sql).toMatch(/FOR UPDATE OF v/);
        expect(select[0].params).toEqual(['s1']);

        const versions = sqlWith("UPDATE knowledge_document_versions SET status = 'uploaded'");
        const docs = sqlWith("UPDATE knowledge_documents SET status = 'processing'");
        const inserts = sqlWith('INSERT INTO knowledge_ingestion_jobs');
        expect(versions.map((q) => q.params)).toEqual([['v1'], ['v2']]);
        expect(docs.map((q) => q.params)).toEqual([['d1'], ['d2']]);
        expect(inserts).toHaveLength(2);
        // [id, kind, document_version_id, space_id, embedding_index_id, run_after, actor_kind, actor_user_id, org_id, policy_revision]
        expect(inserts.map((q) => q.params.slice(1))).toEqual([
            ['ingest', 'v1', null, null, null, 'org', 'u1', 'o1', 3],
            ['ingest', 'v2', null, null, null, 'org', 'u1', 'o1', 3],
        ]);
        // 모두 전환 UPDATE 와 같은 트랜잭션, 그 UPDATE 뒤
        const swIdx = queries.indexOf(sw);
        for (const q of [...select, ...versions, ...docs, ...inserts]) {
            expect(q.tx).toBe(sw.tx);
            expect(queries.indexOf(q)).toBeGreaterThan(swIdx);
        }
    });

    it('실패 버전이 없으면 작업을 넣지 않고 정상 완료', async () => {
        await expect(runSpaceReindexJob(JOB, { embed })).resolves.toBeUndefined();
        expect(sqlWith("v.status = 'failed'")).toHaveLength(1);
        expect(sqlWith('INSERT INTO knowledge_ingestion_jobs')).toHaveLength(0);
        expect(sqlWith('UPDATE knowledge_document_versions')).toHaveLength(0);
    });

    it('전환하지 않은 경로(다른 작업이 먼저 전환·전환 뒤 재실행)는 실패 버전 조회도 작업도 없다', async () => {
        failedRows = [{ document_id: 'd1', version_id: 'v1' }];
        lockedPointer = 'idx-new';
        await runSpaceReindexJob(JOB, { embed });
        expect(sqlWith("v.status = 'failed'")).toHaveLength(0);
        expect(sqlWith('INSERT INTO knowledge_ingestion_jobs')).toHaveLength(0);

        queries.length = 0; lockedPointer = undefined; pointer = 'idx-new';
        await runSpaceReindexJob(JOB, { embed });
        expect(sqlWith("v.status = 'failed'")).toHaveLength(0);
        expect(sqlWith('INSERT INTO knowledge_ingestion_jobs')).toHaveLength(0);
    });
});
