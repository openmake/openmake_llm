/**
 * 색인 카탈로그 — 같은 (providerRef, 차원, 척도) ready 색인은 재사용, 없으면 차원 측정 1회 뒤 ready·비활성으로 만든다.
 * 공간 고정(ensureSpaceIndex)은 이미 고정됐으면 해석하지 않고, 비었으면 행위자의 라이브 배정으로 고정한다(경합 시 재조회).
 * DB 는 SQL 문자열로 응답하는 fake.
 */
type Row = Record<string, unknown>;
const calls: Array<{ sql: string; params: unknown[] }> = [];
let respond: (sql: string, params: unknown[]) => { rows: Row[]; rowCount?: number } = () => ({ rows: [] });
const fakeQuery = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const r = respond(sql, params);
    return { rowCount: r.rows.length, ...r };
};
jest.mock('../db', () => ({
    kdb: () => ({ query: fakeQuery }),
    inTransaction: async (fn: (c: unknown) => Promise<unknown>) => fn({ query: fakeQuery }),
}));
jest.mock('../embedding/provider', () => {
    class EmbeddingError extends Error { constructor(public readonly reason: string, m: string) { super(m); } }
    return { EmbeddingError, describeLiveEmbedding: jest.fn(), probeDimension: jest.fn() };
});
// 한 문장당 행 수 상한을 작게 — 배치 분할을 본다
jest.mock('../constants', () => {
    const actual = jest.requireActual('../constants');
    return { ...actual, KNOWLEDGE_RUNTIME: { ...actual.KNOWLEDGE_RUNTIME, WRITE_BATCH_ROWS: 2 } };
});

import { ensureIndexForTarget, ensureSpaceIndex, findReadyIndex, insertEmbeddings, DEFAULT_METRIC } from '../embedding/index-catalog';
import type { PoolClient } from 'pg';
import type { LiveEmbedding } from '../embedding/provider';

const indexRow = (over: Row = {}): Row => ({
    id: 'idx-1', provider_ref: 'gemini:emb-1', model_id: 'gemini/emb-1', dimension: 3, distance_metric: 'cosine',
    status: 'ready', request_params: {}, ...over,
});
const live: LiveEmbedding = { fullId: 'gemini:emb-1', providerId: 'gemini', model: 'gemini/emb-1', params: {}, source: 'user' };
const sqlWith = (s: string) => calls.filter((c) => c.sql.includes(s));

beforeEach(() => {
    calls.length = 0;
    respond = () => ({ rows: [] });
});

describe('findReadyIndex · ensureIndexForTarget', () => {
    it('같은 모델의 ready 색인이 있으면 재사용하고 차원 측정을 하지 않는다', async () => {
        respond = (sql) => (sql.includes('SELECT * FROM knowledge_embedding_indexes') ? { rows: [indexRow()] } : { rows: [] });
        const probe = jest.fn();
        const idx = await ensureIndexForTarget(live, probe);
        expect(idx).toMatchObject({ id: 'idx-1', providerRef: 'gemini:emb-1', dimension: 3, metric: 'cosine', requestParams: {} });
        expect(probe).not.toHaveBeenCalled();
        expect(sqlWith('INSERT')).toHaveLength(0);
    });

    it('params.dimensions 가 있으면 그 차원의 색인만 찾는다', async () => {
        await findReadyIndex('gemini:emb-1', { dimensions: '768' });
        const q = sqlWith('SELECT * FROM knowledge_embedding_indexes')[0];
        expect(q.params).toEqual(['gemini:emb-1', DEFAULT_METRIC, 768]);
    });

    it('없으면 측정 1회 뒤 ready·is_active FALSE·request_params 를 기록해 만든다', async () => {
        let inserted = false;
        respond = (sql) => {
            if (sql.includes('INSERT INTO knowledge_embedding_indexes')) { inserted = true; return { rows: [indexRow({ id: 'new', dimension: 768, request_params: { dimensions: '768' } })] }; }
            return { rows: [] };
        };
        const probe = jest.fn(async () => ({ dimension: 768, model: 'gemini/emb-1' }));
        const idx = await ensureIndexForTarget({ ...live, params: { dimensions: '768' } }, probe);
        expect(probe).toHaveBeenCalledTimes(1);
        expect(inserted).toBe(true);
        const ins = sqlWith('INSERT INTO knowledge_embedding_indexes')[0];
        expect(ins.sql).toMatch(/'ready', FALSE/);
        expect(ins.sql).toMatch(/ON CONFLICT/);
        // [id, provider_ref, model_id, dimension, metric, request_params]
        expect(ins.params.slice(1)).toEqual(['gemini:emb-1', 'gemini/emb-1', 768, DEFAULT_METRIC, JSON.stringify({ dimensions: '768' })]);
        expect(idx).toMatchObject({ id: 'new', dimension: 768 });
    });

    it('유니크 충돌(동시 생성)이면 같은 (모델, 측정 차원, 척도) 의 ready 색인을 다시 읽는다', async () => {
        let selects = 0;
        respond = (sql) => {
            if (sql.includes('INSERT INTO knowledge_embedding_indexes')) return { rows: [] }; // DO NOTHING
            if (sql.includes('SELECT * FROM knowledge_embedding_indexes')) { selects++; return selects === 1 ? { rows: [] } : { rows: [indexRow({ id: 'winner' })] }; }
            return { rows: [] };
        };
        const idx = await ensureIndexForTarget(live, async () => ({ dimension: 3, model: 'gemini/emb-1' }));
        expect(idx.id).toBe('winner');
        expect(sqlWith('SELECT * FROM knowledge_embedding_indexes')[1].params).toEqual(['gemini:emb-1', DEFAULT_METRIC, 3]);
    });
});

describe('ensureSpaceIndex', () => {
    const provider = jest.requireMock('../embedding/provider') as { describeLiveEmbedding: jest.Mock; probeDimension: jest.Mock };

    beforeEach(() => {
        provider.describeLiveEmbedding.mockReset();
        provider.probeDimension.mockReset();
    });

    it('이미 고정돼 있으면 그 색인을 돌려주고 라이브 배정을 해석하지 않는다', async () => {
        respond = (sql) => (sql.includes('JOIN knowledge_embedding_indexes') ? { rows: [indexRow({ id: 'pinned' })] } : { rows: [] });
        const idx = await ensureSpaceIndex('s1', 'u1');
        expect(idx.id).toBe('pinned');
        expect(provider.describeLiveEmbedding).not.toHaveBeenCalled();
    });

    it('비었으면 행위자의 라이브 배정으로 색인을 보장하고 공간에 고정한다(측정은 행위자 키)', async () => {
        provider.describeLiveEmbedding.mockResolvedValue({ live, failure: null });
        provider.probeDimension.mockResolvedValue({ dimension: 3, model: 'gemini/emb-1' });
        respond = (sql) => {
            if (sql.includes('INSERT INTO knowledge_embedding_indexes')) return { rows: [indexRow({ id: 'made' })] };
            if (sql.includes('UPDATE knowledge_spaces SET embedding_index_id')) return { rows: [{ embedding_index_id: 'made' }] };
            return { rows: [] };
        };
        const idx = await ensureSpaceIndex('s1', 'u1');
        expect(idx.id).toBe('made');
        expect(provider.describeLiveEmbedding).toHaveBeenCalledWith('u1');
        expect(provider.probeDimension).toHaveBeenCalledWith(live, { userId: 'u1' });
        const pin = sqlWith('UPDATE knowledge_spaces SET embedding_index_id')[0];
        expect(pin.sql).toMatch(/embedding_index_id IS NULL/);
        expect(pin.params).toEqual(['s1', 'made']);
    });

    it('고정 UPDATE 가 0행이면(다른 작업이 먼저 고정) 그쪽 색인을 다시 읽는다', async () => {
        provider.describeLiveEmbedding.mockResolvedValue({ live, failure: null });
        provider.probeDimension.mockResolvedValue({ dimension: 3, model: 'gemini/emb-1' });
        respond = (sql) => {
            if (sql.includes('INSERT INTO knowledge_embedding_indexes')) return { rows: [indexRow({ id: 'mine' })] };
            if (sql.includes('UPDATE knowledge_spaces SET embedding_index_id')) return { rows: [] };
            if (sql.includes('SELECT embedding_index_id FROM knowledge_spaces')) return { rows: [{ embedding_index_id: 'theirs' }] };
            if (sql.includes('WHERE id = $1')) return { rows: [indexRow({ id: 'theirs' })] };
            return { rows: [] };
        };
        expect((await ensureSpaceIndex('s1', 'u1')).id).toBe('theirs');
    });

    it('라이브 배정이 실행 불가면 EmbeddingError(reason) — 색인·고정 쓰기 없음', async () => {
        provider.describeLiveEmbedding.mockResolvedValue({ live, failure: { reason: 'key_missing', message: '키 없음' } });
        await expect(ensureSpaceIndex('s1', 'u1')).rejects.toMatchObject({ reason: 'key_missing' });
        expect(sqlWith('INSERT')).toHaveLength(0);
        expect(sqlWith('UPDATE')).toHaveLength(0);
    });
});

describe('insertEmbeddings — 다중 행 upsert', () => {
    const client = { query: fakeQuery } as unknown as PoolClient;

    it('행마다가 아니라 상한(2행)씩 unnest 배열 한 문장으로 넣고 ON CONFLICT 갱신을 유지한다', async () => {
        const rows = [1, 2, 3, 4, 5].map((n) => ({ chunkId: `c${n}`, vector: [n, 0.5] }));
        await insertEmbeddings(client, 'idx-1', rows);
        const ins = sqlWith('INSERT INTO knowledge_chunk_embeddings');
        expect(ins).toHaveLength(3);
        for (const q of ins) {
            expect(q.sql).toMatch(/unnest\(/);
            expect(q.sql).toMatch(/::vector/);
            expect(q.sql).toMatch(/ON CONFLICT \(chunk_id, embedding_index_id\) DO UPDATE SET embedding = EXCLUDED\.embedding/);
        }
        // [indexId, ids[], chunkIds[], vectors[]] — 행 순서 유지, id 는 행마다 새 값
        expect(ins.map((q) => q.params[0])).toEqual(['idx-1', 'idx-1', 'idx-1']);
        expect(ins.map((q) => q.params[2])).toEqual([['c1', 'c2'], ['c3', 'c4'], ['c5']]);
        expect(ins[0].params[3]).toEqual(['[1,0.5]', '[2,0.5]']);
        const ids = ins.flatMap((q) => q.params[1] as string[]);
        expect(new Set(ids).size).toBe(5);
    });

    it('빈 입력이면 쿼리를 보내지 않는다', async () => {
        await insertEmbeddings(client, 'idx-1', []);
        expect(calls).toHaveLength(0);
    });
});
