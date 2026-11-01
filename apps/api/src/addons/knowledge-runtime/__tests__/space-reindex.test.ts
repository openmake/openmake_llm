/**
 * 공간 재색인 실행(runSpaceReindexJob) — 그 공간의 ready·현재 버전·미삭제 문서 청크만 대상 색인으로 임베딩하고,
 * 검증 뒤 공간 포인터를 옛 색인 조건부로 바꾼다(옛 벡터는 지우지 않는다). 배치 삽입·전환 트랜잭션 첫 문장은 lease 검사,
 * 키 오류는 영구 실패(KnowledgeJobPermanentError). reindex-lease.test.ts 를 흡수했다.
 */
import { createJobLease, LeaseLostError } from '../jobs/lease';

const queries: Array<{ sql: string; params: unknown[] }> = [];
let leaseRowCount = 1;
let batches = 1;
let switchRowCount = 1;
let pointer: string | null = 'idx-old';
let targetStatus = 'ready';
let verifyCounts = { expected: '1', got: '1' };
const fakeQuery = async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    if (sql.includes('FROM knowledge_ingestion_jobs')) return { rows: leaseRowCount ? [{ '?column?': 1 }] : [], rowCount: leaseRowCount };
    if (sql.includes('SELECT * FROM knowledge_embedding_indexes WHERE id')) {
        return { rows: [{ id: 'idx-new', provider_ref: 'gemini:emb-1', model_id: 'gemini/emb-1', dimension: 2, distance_metric: 'cosine', status: targetStatus, request_params: {} }], rowCount: 1 };
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
    kdb: () => ({ query: fakeQuery }),
    inTransaction: async (fn: (c: unknown) => Promise<unknown>) => fn({ query: fakeQuery }),
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
import { EmbeddingError } from '../embedding/provider';

const JOB = { spaceId: 's1', indexId: 'idx-new', actorUserId: 'u1' };
const embed = async (t: string[]) => t.map(() => [1, 0]);
const sqlWith = (s: string) => queries.filter((q) => q.sql.includes(s));

beforeEach(() => {
    queries.length = 0; leaseRowCount = 1; batches = 1; switchRowCount = 1; pointer = 'idx-old'; targetStatus = 'ready';
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

    it('전환 UPDATE 가 0행(다른 전환이 먼저)이면 영구 실패', async () => {
        switchRowCount = 0;
        await expect(runSpaceReindexJob(JOB, { embed })).rejects.toBeInstanceOf(KnowledgeJobPermanentError);
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
        const failing = (reason: string) => async () => { throw new EmbeddingError(reason, '키'); };
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
