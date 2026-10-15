// apps/api/src/addons/knowledge-runtime/__tests__/pipeline-lease.test.ts
/**
 * ingestVersion 의 lease 처리 — 청크 교체·게시 트랜잭션 첫 문장이 assertLeaseHeld, lease 상실은 markFailed 없이 LeaseLostError.
 * DB 는 SQL 로 분기하는 가짜. 파서·청커는 text/plain 실물(DB 불필요).
 */
import { createJobLease, LeaseLostError } from '../jobs/lease';

const queries: Array<{ sql: string; params: unknown[] }> = [];
let leaseRowCount = 1;
const fakeQuery = async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    if (sql.includes('FROM knowledge_ingestion_jobs')) return { rows: leaseRowCount ? [{ '?column?': 1 }] : [], rowCount: leaseRowCount };
    if (sql.includes('FROM knowledge_document_versions v')) {
        return { rows: [{ id: 'v1', document_id: 'd1', storage_ref: 'ref', mime_type: 'text/plain', source_size: '5', space_id: 's1', config_profile_id: null }], rowCount: 1 };
    }
    if (sql.includes('SELECT id, content FROM knowledge_chunks')) return { rows: [{ id: 'c1', content: 'hello' }], rowCount: 1 };
    if (sql.includes('SELECT id FROM knowledge_embedding_indexes WHERE is_active')) return { rows: [{ id: 'idx' }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
};
jest.mock('../db', () => ({
    kdb: () => ({ query: fakeQuery }),
    inTransaction: async (fn: (c: unknown) => Promise<unknown>) => fn({ query: fakeQuery }),
}));
jest.mock('../config/profiles', () => ({
    resolveSpaceProfiles: async () => ({
        limits: { allowedMimeTypes: ['text/plain'], maxFileBytes: 1_000_000, minCharsPerPdfPage: 20 },
        chunker: { id: 'p', strategy: 'fixed-token', size: 50, overlap: 0 },
    }),
}));
jest.mock('../embedding/index-manager', () => ({
    ensureActiveIndex: async () => ({ id: 'idx', providerRef: 'fake', modelId: 'fake', dimension: 2, metric: 'cosine', status: 'ready', isActive: true }),
    insertEmbeddings: async () => undefined,
    countEmbeddings: async (_i: string, ids: string[]) => ids.length,
}));
jest.mock('../embedding/provider', () => ({ makeIndexEmbedder: () => async (t: string[]) => t.map(() => [1, 0]) }));

import { ingestVersion } from '../ingestion/pipeline';

const sqlWith = (s: string) => queries.filter((q) => q.sql.includes(s));
const deps = { readFile: async () => Buffer.from('hello'), embed: async (t: string[]) => t.map(() => [1, 0]) };

beforeEach(() => { queries.length = 0; leaseRowCount = 1; });

describe('ingestVersion + lease', () => {
    it('lease 가 있으면 청크 교체·임베딩 삽입·게시 트랜잭션마다 lease 검사를 먼저 한다', async () => {
        const lease = createJobLease({ jobId: 'j', token: '2', owner: 'o' });
        const r = await ingestVersion('v1', { ...deps, lease });
        expect(r.status).toBe('ready');
        expect(sqlWith('FROM knowledge_ingestion_jobs').length).toBeGreaterThanOrEqual(3);
        const firstDelete = queries.findIndex((q) => q.sql.includes('DELETE FROM knowledge_chunks'));
        const checkBefore = queries.slice(0, firstDelete).some((q) => q.sql.includes('FROM knowledge_ingestion_jobs'));
        expect(checkBefore).toBe(true);
    });

    it('lease 가 없으면(레거시 호출) 검사 쿼리가 없다', async () => {
        const r = await ingestVersion('v1', deps);
        expect(r.status).toBe('ready');
        expect(sqlWith('FROM knowledge_ingestion_jobs')).toHaveLength(0);
    });

    it('확정 쓰기 직전 검사가 0행이면 LeaseLostError 를 던지고 markFailed 를 부르지 않는다', async () => {
        leaseRowCount = 0;
        const lease = createJobLease({ jobId: 'j', token: '2', owner: 'o' });
        await expect(ingestVersion('v1', { ...deps, lease })).rejects.toThrow(LeaseLostError);
        expect(sqlWith("status = 'failed'")).toHaveLength(0);
        expect(sqlWith("SET status = 'ready'")).toHaveLength(0);
    });

    it('이미 잃은 lease 는 첫 단계에서 멈춘다(validating 상태 갱신 전)', async () => {
        const lease = createJobLease({ jobId: 'j', token: '2', owner: 'o' });
        lease.markLost('heartbeat');
        await expect(ingestVersion('v1', { ...deps, lease })).rejects.toThrow(LeaseLostError);
        expect(sqlWith("SET status = $2")).toHaveLength(0);
        expect(sqlWith("status = 'failed'")).toHaveLength(0);
    });

    it('단계 상태·파서 메타 갱신도 lease 검사 뒤에만 쓴다(옛 실행자가 새 실행자의 ready 를 validating 으로 되돌리지 않게)', async () => {
        const lease = createJobLease({ jobId: 'j', token: '2', owner: 'o' });
        await ingestVersion('v1', { ...deps, lease });
        const firstStage = queries.findIndex((q) => q.sql.includes('SET status = $2'));
        expect(firstStage).toBeGreaterThan(0);
        expect(queries[firstStage - 1].sql).toMatch(/FROM knowledge_ingestion_jobs/);
        const parserMeta = queries.findIndex((q) => q.sql.includes('SET parser_id = $2'));
        expect(queries[parserMeta - 1].sql).toMatch(/FROM knowledge_ingestion_jobs/);
    });

    it('heartbeat 로 lease 를 잃은 뒤 일반 오류가 나도 failed 를 쓰지 않는다(새 실행자의 상태 보호)', async () => {
        const lease = createJobLease({ jobId: 'j', token: '2', owner: 'o' });
        const readFile = async () => { lease.markLost('heartbeat 0행'); throw new Error('읽기 실패'); };
        await expect(ingestVersion('v1', { ...deps, readFile, lease })).rejects.toThrow(LeaseLostError);
        expect(sqlWith("status = 'failed'")).toHaveLength(0);
    });

    it('failed 기록 직전 검사가 0행이면(재선점) failed 를 쓰지 않고 LeaseLostError', async () => {
        const lease = createJobLease({ jobId: 'j', token: '2', owner: 'o' });
        const readFile = async () => { leaseRowCount = 0; throw new Error('읽기 실패'); };
        await expect(ingestVersion('v1', { ...deps, readFile, lease })).rejects.toThrow(LeaseLostError);
        expect(sqlWith("status = 'failed'")).toHaveLength(0);
    });

    it('lease 가 없는 레거시 호출의 실패는 종전처럼 failed 를 기록한다', async () => {
        const readFile = async () => { throw new Error('읽기 실패'); };
        const r = await ingestVersion('v1', { ...deps, readFile });
        expect(r.status).toBe('failed');
        expect(sqlWith("status = 'failed'")).toHaveLength(2); // 버전·문서 두 행
    });
});
