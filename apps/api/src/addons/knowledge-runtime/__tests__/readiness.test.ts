/**
 * 공간 임베딩 상태(서버 판정, 설계 §6.8) — 색인 없음 unpinned · 재색인 작업 reindexing · 미배정 unassigned
 * · 거절 메모 key_rejected · 키 행 없음 key_missing · 그 외 ready. mismatch 는 색인 모델 ≠ 현재 설정.
 * 가용성은 providerRef 별 1회만 본다(복호화 없음 — checkEmbeddingAvailability 는 키 행만 본다).
 * 업로드·재시도 선검사(assertSpaceEmbeddingReady)는 412 코드로 거절하고 공급자를 부르지 않는다.
 */
let reindexingRows: Array<{ space_id: string }> = [];
jest.mock('../db', () => ({
    kdb: () => ({ query: async (sql: string) => (sql.includes("kind = 'reindex'") ? { rows: reindexingRows } : { rows: [] }) }),
}));
const describeLiveEmbedding = jest.fn();
const checkEmbeddingAvailability = jest.fn();
jest.mock('../embedding/provider', () => ({
    describeLiveEmbedding: (...a: unknown[]) => describeLiveEmbedding(...a),
    checkEmbeddingAvailability: (...a: unknown[]) => checkEmbeddingAvailability(...a),
    probeDimension: jest.fn(),
    classifyEmbedError: () => 'provider',
}));
const indexes = new Map<string, Record<string, unknown>>();
jest.mock('../embedding/index-catalog', () => ({
    getIndexesByIds: async (ids: string[]) => new Map(ids.filter((id) => indexes.has(id)).map((id) => [id, indexes.get(id)])),
    getIndexById: async (id: string) => indexes.get(id) ?? null,
    ensureIndexForTarget: jest.fn(),
}));

import { describeSpaceEmbeddings, assertSpaceEmbeddingReady, ensureLiveIndex } from '../embedding/readiness';

const idx = (id: string, providerRef: string, dimension = 3) => ({ id, providerRef, modelId: providerRef.replace(':', '/'), dimension, metric: 'cosine', status: 'ready', requestParams: {} });
const liveOf = (fullId: string, params: Record<string, string> = {}) => ({ fullId, providerId: fullId.split(':')[0], model: fullId.replace(':', '/'), params, source: 'user' });

beforeEach(() => {
    reindexingRows = [];
    indexes.clear();
    describeLiveEmbedding.mockReset();
    checkEmbeddingAvailability.mockReset();
    describeLiveEmbedding.mockResolvedValue({ live: liveOf('gemini:emb-1'), failure: null });
    checkEmbeddingAvailability.mockResolvedValue({ ok: true });
});

describe('describeSpaceEmbeddings', () => {
    it('표의 각 분기 — unpinned·reindexing·key_rejected·key_missing·ready', async () => {
        indexes.set('i-g', idx('i-g', 'gemini:emb-1'));
        indexes.set('i-n', idx('i-n', 'nvidia:emb-2'));
        indexes.set('i-l', idx('i-l', 'local-llm:bge-m3', 1024));
        reindexingRows = [{ space_id: 's-reidx' }];
        checkEmbeddingAvailability.mockImplementation(async (ref: string) => (
            ref === 'nvidia:emb-2' ? { ok: false, reason: 'key_missing', message: '키 없음' }
                : ref === 'local-llm:bge-m3' ? { ok: false, reason: 'key_rejected', message: '거절' } : { ok: true }));

        const out = await describeSpaceEmbeddings([
            { id: 's-none', embedding_index_id: null },
            { id: 's-reidx', embedding_index_id: 'i-n' },
            { id: 's-rej', embedding_index_id: 'i-l' },
            { id: 's-miss', embedding_index_id: 'i-n' },
            { id: 's-ok', embedding_index_id: 'i-g' },
        ], 'u1');

        expect(out.get('s-none')).toMatchObject({ index: null, status: 'unpinned', mismatch: false });
        expect(out.get('s-reidx')?.status).toBe('reindexing');
        expect(out.get('s-rej')?.status).toBe('key_rejected');
        expect(out.get('s-miss')?.status).toBe('key_missing');
        expect(out.get('s-ok')).toEqual({
            index: { id: 'i-g', providerRef: 'gemini:emb-1', modelId: 'gemini/emb-1', dimension: 3, distanceMetric: 'cosine' },
            status: 'ready',
            effective: { providerRef: 'gemini:emb-1', modelId: 'gemini/emb-1', source: 'user' },
            mismatch: false,
        });
        // providerRef 별 1회, 라이브 해석은 요청당 1회
        expect(checkEmbeddingAvailability).toHaveBeenCalledTimes(3);
        expect(describeLiveEmbedding).toHaveBeenCalledTimes(1);
        expect(describeLiveEmbedding).toHaveBeenCalledWith('u1');
    });

    it('미배정이면 unassigned·effective null, 색인 모델 ≠ 현재 설정이면 mismatch', async () => {
        indexes.set('i-l', idx('i-l', 'local-llm:bge-m3', 1024));
        describeLiveEmbedding.mockResolvedValueOnce({ live: null, failure: { reason: 'unassigned', message: '미배정' } });
        const un = await describeSpaceEmbeddings([{ id: 's', embedding_index_id: 'i-l' }], 'u1');
        expect(un.get('s')).toMatchObject({ status: 'unassigned', effective: null, mismatch: false });

        const mm = await describeSpaceEmbeddings([{ id: 's', embedding_index_id: 'i-l' }], 'u1');
        expect(mm.get('s')).toMatchObject({ status: 'ready', mismatch: true, effective: { providerRef: 'gemini:emb-1' } });
    });

    it('같은 모델이라도 설정 차원(dimensions)이 색인 차원과 다르면 mismatch', async () => {
        indexes.set('i-g', idx('i-g', 'gemini:emb-1', 3072));
        describeLiveEmbedding.mockResolvedValueOnce({ live: liveOf('gemini:emb-1', { dimensions: '768' }), failure: null });
        expect((await describeSpaceEmbeddings([{ id: 's', embedding_index_id: 'i-g' }], 'u1')).get('s')?.mismatch).toBe(true);
    });

    it('라이브 키가 없어도 effective 는 배정 모델을 보인다(상태는 공간 색인 기준)', async () => {
        indexes.set('i-g', idx('i-g', 'gemini:emb-1'));
        describeLiveEmbedding.mockResolvedValueOnce({ live: liveOf('gemini:emb-1'), failure: { reason: 'key_missing', message: '키 없음' } });
        expect((await describeSpaceEmbeddings([{ id: 's', embedding_index_id: 'i-g' }], 'u1')).get('s')).toMatchObject({
            status: 'ready', effective: { providerRef: 'gemini:emb-1' },
        });
    });
});

describe('assertSpaceEmbeddingReady', () => {
    it('고정된 색인의 공급자 키가 없으면 412 EMBEDDING_KEY_MISSING, 거절 메모면 412 EMBEDDING_KEY_REJECTED', async () => {
        indexes.set('i-g', idx('i-g', 'gemini:emb-1'));
        checkEmbeddingAvailability.mockResolvedValueOnce({ ok: false, reason: 'key_missing', message: '키 없음' });
        await expect(assertSpaceEmbeddingReady({ id: 's', embedding_index_id: 'i-g' }, 'u1')).rejects.toMatchObject({ statusCode: 412, code: 'EMBEDDING_KEY_MISSING' });
        checkEmbeddingAvailability.mockResolvedValueOnce({ ok: false, reason: 'key_rejected', message: '거절' });
        await expect(assertSpaceEmbeddingReady({ id: 's', embedding_index_id: 'i-g' }, 'u1')).rejects.toMatchObject({ statusCode: 412, code: 'EMBEDDING_KEY_REJECTED' });
        expect(checkEmbeddingAvailability).toHaveBeenCalledWith('gemini:emb-1', 'u1');
        expect(describeLiveEmbedding).not.toHaveBeenCalled();
    });

    it('색인이 비어 있으면 라이브 배정으로 검사 — 미배정 412 EMBEDDING_UNASSIGNED, 통과하면 아무 일 없음', async () => {
        describeLiveEmbedding.mockResolvedValueOnce({ live: null, failure: { reason: 'unassigned', message: '미배정' } });
        await expect(assertSpaceEmbeddingReady({ id: 's', embedding_index_id: null }, 'u1')).rejects.toMatchObject({ statusCode: 412, code: 'EMBEDDING_UNASSIGNED' });
        await expect(assertSpaceEmbeddingReady({ id: 's', embedding_index_id: null }, 'u1')).resolves.toBeUndefined();
    });
});

describe('개인·전역 모두 미배정(코드 기본값 없음, 2026-11-10)', () => {
    const unassigned = { live: null, failure: { reason: 'unassigned', message: '미배정' } };
    const provider = jest.requireMock('../embedding/provider') as { probeDimension: jest.Mock };
    const catalog = jest.requireMock('../embedding/index-catalog') as { ensureIndexForTarget: jest.Mock };
    beforeEach(() => {
        provider.probeDimension.mockReset();
        catalog.ensureIndexForTarget.mockReset();
    });

    it('새 색인 보장(ensureLiveIndex)은 412 EMBEDDING_UNASSIGNED — 차원 측정·색인 쓰기 없음', async () => {
        describeLiveEmbedding.mockResolvedValueOnce(unassigned);
        await expect(ensureLiveIndex('u1')).rejects.toMatchObject({ statusCode: 412, code: 'EMBEDDING_UNASSIGNED' });
        expect(catalog.ensureIndexForTarget).not.toHaveBeenCalled();
        expect(provider.probeDimension).not.toHaveBeenCalled();
    });

    it('색인이 고정된 기존 공간은 현재 배정이 없어도 기록 모델 키만 보고 통과한다', async () => {
        indexes.set('i-g', idx('i-g', 'gemini:emb-1'));
        describeLiveEmbedding.mockResolvedValue(unassigned);
        await expect(assertSpaceEmbeddingReady({ id: 's', embedding_index_id: 'i-g' }, 'u1')).resolves.toBeUndefined();
        expect(checkEmbeddingAvailability).toHaveBeenCalledWith('gemini:emb-1', 'u1');
        expect(describeLiveEmbedding).not.toHaveBeenCalled();
    });
});
