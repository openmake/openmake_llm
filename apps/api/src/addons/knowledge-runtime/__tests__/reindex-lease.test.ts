/** runReindexJob 의 lease — 배치 삽입·index 전환 트랜잭션 첫 문장이 assertLeaseHeld, 잃은 lease 는 배치 경계에서 멈춘다. */
import { createJobLease, LeaseLostError } from '../jobs/lease';

const queries: Array<{ sql: string; params: unknown[] }> = [];
let leaseRowCount = 1;
let batches = 1;
const fakeQuery = async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    if (sql.includes('FROM knowledge_ingestion_jobs')) return { rows: leaseRowCount ? [{ '?column?': 1 }] : [], rowCount: leaseRowCount };
    if (sql.includes('SELECT * FROM knowledge_embedding_indexes WHERE id')) {
        return { rows: [{ id: 'new', provider_ref: 'fake', model_id: 'fake', dimension: 2, distance_metric: 'cosine', status: 'building', is_active: false }], rowCount: 1 };
    }
    if (sql.includes('SELECT c.id, c.content')) { if (batches > 0) { batches -= 1; return { rows: [{ id: 'c1', content: 'x' }], rowCount: 1 }; } return { rows: [], rowCount: 0 }; }
    if (sql.includes('COUNT(*)::text AS n')) return { rows: [{ n: sql.includes('NOT EXISTS') ? '0' : '1' }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
};
jest.mock('../db', () => ({
    kdb: () => ({ query: fakeQuery }),
    inTransaction: async (fn: (c: unknown) => Promise<unknown>) => fn({ query: fakeQuery }),
}));
jest.mock('../embedding/provider', () => ({ makeIndexEmbedder: () => async (t: string[]) => t.map(() => [1, 0]) }));

import { runReindexJob } from '../embedding/index-manager';

const sqlWith = (s: string) => queries.filter((q) => q.sql.includes(s));
beforeEach(() => { queries.length = 0; leaseRowCount = 1; batches = 1; });

describe('runReindexJob + lease', () => {
    it('배치 삽입과 전환 트랜잭션 앞에 lease 검사가 있다', async () => {
        const lease = createJobLease({ jobId: 'j', token: '1', owner: 'o' });
        await runReindexJob('new', { embed: async (t) => t.map(() => [1, 0]), lease });
        expect(sqlWith('FROM knowledge_ingestion_jobs').length).toBeGreaterThanOrEqual(2);
        const switchIdx = queries.findIndex((q) => q.sql.includes('SET is_active = TRUE'));
        expect(queries.slice(0, switchIdx).filter((q) => q.sql.includes('FROM knowledge_ingestion_jobs')).length).toBeGreaterThanOrEqual(2);
    });

    it('검사가 0행이면 전환하지 않고 LeaseLostError', async () => {
        leaseRowCount = 0;
        const lease = createJobLease({ jobId: 'j', token: '1', owner: 'o' });
        await expect(runReindexJob('new', { embed: async (t) => t.map(() => [1, 0]), lease })).rejects.toThrow(LeaseLostError);
        expect(sqlWith('SET is_active = TRUE')).toHaveLength(0);
    });

    it('lease 없이 부르면 종전처럼 검사 없이 돈다', async () => {
        await runReindexJob('new', { embed: async (t) => t.map(() => [1, 0]) });
        expect(sqlWith('FROM knowledge_ingestion_jobs')).toHaveLength(0);
        expect(sqlWith('SET is_active = TRUE')).toHaveLength(1);
    });
});
