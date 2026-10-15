/** rechunkSpace 의 lease — 새 버전 INSERT 도 assertLeaseHeld 와 같은 트랜잭션에서, 잃은 lease 는 고아 uploaded 행을 남기지 않는다. */
import { createJobLease, LeaseLostError } from '../jobs/lease';

const queries: Array<{ sql: string; params: unknown[] }> = [];
let leaseRowCount = 1;
const fakeQuery = async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    if (sql.includes('FROM knowledge_documents d')) {
        return {
            rows: [{ document_id: 'd1', content_hash: 'a'.repeat(64), mime_type: 'text/plain', original_filename: 'f.txt', storage_ref: 'ref', source_size: '5' }],
            rowCount: 1,
        };
    }
    if (sql.includes('FROM knowledge_ingestion_jobs')) return { rows: leaseRowCount ? [{ '?column?': 1 }] : [], rowCount: leaseRowCount };
    return { rows: [], rowCount: 1 };
};
jest.mock('../db', () => ({
    kdb: () => ({ query: fakeQuery }),
    inTransaction: async (fn: (c: unknown) => Promise<unknown>) => fn({ query: fakeQuery }),
}));
jest.mock('../ingestion/pipeline', () => ({ ingestVersion: jest.fn(async () => ({ status: 'ready', chunkCount: 1 })) }));

import { rechunkSpace } from '../jobs/rechunk';
import { ingestVersion } from '../ingestion/pipeline';

const INSERT_VERSION = 'INSERT INTO knowledge_document_versions';
const sqlWith = (s: string) => queries.filter((q) => q.sql.includes(s));
beforeEach(() => { queries.length = 0; leaseRowCount = 1; (ingestVersion as jest.Mock).mockClear(); });

describe('rechunkSpace + lease', () => {
    it('lease 가 있으면 새 버전 INSERT 직전에 lease 검사가 같은 트랜잭션에서 돈다', async () => {
        const lease = createJobLease({ jobId: 'j', token: '1', owner: 'o' });
        await rechunkSpace('s1', { lease });
        const insertIdx = queries.findIndex((q) => q.sql.includes(INSERT_VERSION));
        expect(insertIdx).toBeGreaterThan(0);
        expect(queries[insertIdx - 1].sql).toContain('FROM knowledge_ingestion_jobs');
        expect(ingestVersion).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ lease }));
    });

    it('검사가 0행이면 INSERT 하지 않고 LeaseLostError', async () => {
        leaseRowCount = 0;
        const lease = createJobLease({ jobId: 'j', token: '1', owner: 'o' });
        await expect(rechunkSpace('s1', { lease })).rejects.toThrow(LeaseLostError);
        expect(sqlWith(INSERT_VERSION)).toHaveLength(0);
        expect(ingestVersion).not.toHaveBeenCalled();
    });

    it('lease 없이 부르면 검사 없이 종전대로 INSERT 한다', async () => {
        await rechunkSpace('s1');
        expect(sqlWith('FROM knowledge_ingestion_jobs')).toHaveLength(0);
        expect(sqlWith(INSERT_VERSION)).toHaveLength(1);
        expect(ingestVersion).toHaveBeenCalledTimes(1);
    });
});
