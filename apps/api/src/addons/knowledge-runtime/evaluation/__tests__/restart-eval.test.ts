/**
 * K08 재시작 평가 판정 — 임베딩 수는 전역 활성 색인이 아니라 그 문서 공간이 가리키는 색인 기준으로 센다(006).
 */
const queries: Array<{ sql: string; params: unknown[] }> = [];
let spaceRow: { space_id: string } | undefined = { space_id: 'sp-1' };
jest.mock('../../db', () => ({
    kdb: () => ({
        query: async (sql: string, params: unknown[] = []) => {
            queries.push({ sql, params });
            if (sql.includes('SUM(c - 1)')) return { rows: [{ n: '0' }] };
            if (sql.includes('FROM knowledge_chunks WHERE document_version_id')) return { rows: [{ n: '3' }] };
            if (sql.includes('SELECT d.space_id')) return { rows: spaceRow ? [spaceRow] : [] };
            if (sql.includes('FROM knowledge_chunk_embeddings')) return { rows: [{ n: '3' }] };
            return { rows: [] };
        },
    }),
}));
const ingestVersion = jest.fn(async () => undefined);
jest.mock('../../ingestion/pipeline', () => ({ ingestVersion: (...a: unknown[]) => ingestVersion(...(a as [])) }));
jest.mock('../../jobs/queue', () => ({ enqueueJob: jest.fn() }));
jest.mock('../../jobs/actor', () => ({ systemJobActor: jest.fn() }));
jest.mock('../../jobs/worker', () => ({ KnowledgeWorker: jest.fn() }));
const getSpaceIndex = jest.fn();
jest.mock('../../embedding/index-catalog', () => ({ getSpaceIndex: (...a: unknown[]) => getSpaceIndex(...a) }));

import { runRestartEval } from '../restart-eval';
import type { EvalDataset } from '../types';
import type { SeedContext } from '../seeding';

const dataset = { cases: [{ id: 'r1', category: 'restart', restartDocKey: 'd1', restartMode: 'double_ingest' }] } as unknown as EvalDataset;
const seedCtx = { docs: { d1: { versionId: 'v-1' } } } as unknown as SeedContext;

beforeEach(() => {
    queries.length = 0;
    spaceRow = { space_id: 'sp-1' };
    getSpaceIndex.mockReset();
});

describe('runRestartEval — 공간 색인 기준 판정', () => {
    it('문서 공간의 색인으로 임베딩 수를 세고 청크 수와 맞으면 일치', async () => {
        getSpaceIndex.mockResolvedValue({ id: 'idx-space' });
        const r = await runRestartEval(dataset, seedCtx);
        expect(ingestVersion).toHaveBeenCalledWith('v-1');
        expect(getSpaceIndex).toHaveBeenCalledWith('sp-1');
        const count = queries.find((q) => q.sql.includes('FROM knowledge_chunk_embeddings'));
        expect(count?.params).toEqual(['v-1', 'idx-space']);
        expect(queries.some((q) => /is_active/.test(q.sql))).toBe(false);
        expect(r).toMatchObject({ duplicateChunksAfterRetry: 0, embeddingMismatches: 0 });
        expect(r.perCase[0]).toMatchObject({ chunkCount: 3, embeddingCount: 3, embeddingsMatch: true });
    });

    it('공간에 색인이 없으면 임베딩 0 — 불일치로 센다', async () => {
        getSpaceIndex.mockResolvedValue(null);
        const r = await runRestartEval(dataset, seedCtx);
        expect(queries.some((q) => q.sql.includes('FROM knowledge_chunk_embeddings'))).toBe(false);
        expect(r.embeddingMismatches).toBe(1);
        expect(r.perCase[0]).toMatchObject({ embeddingCount: 0, embeddingsMatch: false });
    });
});
