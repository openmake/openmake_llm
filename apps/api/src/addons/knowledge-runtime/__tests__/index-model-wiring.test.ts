/**
 * 수집 배선 테스트 — ingestVersion 이 어느 색인·어느 키로 임베딩하는지 검증한다(DB 는 mock).
 * - 공간 색인(ensureIndex(spaceId, actorUserId)) + 행위자 키(makeIndexEmbedder(index, { userId }))
 * - 게시 검사는 공간 포인터(knowledge_spaces.embedding_index_id)를 본다 — 전역 is_active 가 아니다
 * - 임베딩 실패 사유 → 실패 코드: key_missing·unassigned → EMBEDDING_KEY_MISSING, key_rejected → EMBEDDING_KEY_REJECTED, 그 밖 FAILED_EMBEDDING
 */
const mockQuery = jest.fn();

jest.mock('../db', () => ({
    kdb: () => ({ query: (...a: unknown[]) => mockQuery(...a), connect: async () => ({ query: (...a: unknown[]) => mockQuery(...a), release() { /* noop */ } }) }),
    inTransaction: async (fn: (c: { query: (...a: unknown[]) => unknown }) => unknown) => fn({ query: (...a: unknown[]) => mockQuery(...a) }),
}));
jest.mock('../embedding/provider', () => {
    class EmbeddingError extends Error { constructor(public readonly reason: string, m: string) { super(m); } }
    return {
        EmbeddingError,
        makeIndexEmbedder: jest.fn(),
        classifyEmbedError: (e: unknown) => (e instanceof EmbeddingError ? e.reason : 'provider'),
    };
});
jest.mock('../config/profiles', () => ({
    getDefaultLimits: jest.fn(async () => ({ allowedMimeTypes: ['text/plain'], maxFileBytes: 1_000_000, minCharsPerPdfPage: 1, embedBatchSize: 16 })),
    resolveSpaceProfiles: jest.fn(async () => ({
        chunker: { id: 'c1', strategy: 'fixed-token', size: 50, overlap: 0 },
        retrieval: { id: 'r1', topK: 5, candidateCount: 10, minSimilarity: 0, maxContextChars: 5000, maxTopK: 10 },
        limits: { id: 'l1', allowedMimeTypes: ['text/plain'], maxFileBytes: 1_000_000, minCharsPerPdfPage: 1, embedBatchSize: 16 },
    })),
    applyRetrievalOverride: (p: unknown) => p,
}));

import { ingestVersion } from '../ingestion/pipeline';
import type { KnowledgeIndex } from '../embedding/index-catalog';
import { makeIndexEmbedder, EmbeddingError } from '../embedding/provider';

const mockMakeIndexEmbedder = makeIndexEmbedder as jest.Mock;

function spaceIndex(over: Partial<KnowledgeIndex> = {}): KnowledgeIndex {
    return { id: 'idx-1', providerRef: 'gemini:emb-1', modelId: 'gemini/emb-1', dimension: 2, metric: 'cosine', status: 'ready', requestParams: {}, ...over };
}

/** 공간 포인터가 pointer 를 가리키는 수집 DB 응답 */
function respond(pointer: string): void {
    mockQuery.mockImplementation(async (sql: string) => {
        if (/v\.storage_ref/.test(sql)) {
            return { rows: [{ id: 'v1', document_id: 'd1', storage_ref: 'ref', mime_type: 'text/plain', source_size: '11', space_id: 's1', config_profile_id: null }] };
        }
        if (/SELECT id, content FROM knowledge_chunks WHERE document_version_id/.test(sql)) return { rows: [{ id: 'ch1', content: 'hello world' }] };
        if (/COUNT\(\*\)::text AS n FROM knowledge_chunk_embeddings/.test(sql)) return { rows: [{ n: '1' }] };
        if (/SELECT embedding_index_id FROM knowledge_spaces WHERE id = \$1/.test(sql)) return { rows: [{ embedding_index_id: pointer }] };
        return { rows: [] };
    });
}

const versionFailure = () => mockQuery.mock.calls.find((c) => /SET status = 'failed', failure_code/.test(String(c[0])))?.[1]?.[1];

beforeEach(() => {
    jest.clearAllMocks();
    respond('idx-1');
});

describe('ingestVersion — 공간 색인·행위자 키', () => {
    it('ensureIndex(spaceId, actorUserId) 의 색인을 행위자 키로 임베딩하고 공간 포인터를 보고 게시한다', async () => {
        const index = spaceIndex();
        const embedder = jest.fn(async (t: string[]) => t.map(() => [0.1, 0.2]));
        mockMakeIndexEmbedder.mockReturnValue(embedder);
        const ensureIndex = jest.fn(async () => index);

        const res = await ingestVersion('v1', { ensureIndex, actorUserId: 'u1', readFile: async () => Buffer.from('hello world') });

        expect(res.status).toBe('ready');
        expect(ensureIndex).toHaveBeenCalledWith('s1', 'u1');
        expect(mockMakeIndexEmbedder).toHaveBeenCalledWith(index, { userId: 'u1' }, { spaceId: 's1' });
        expect(embedder).toHaveBeenCalledTimes(1);
        expect(mockQuery.mock.calls.some((c) => /WHERE is_active/.test(String(c[0])))).toBe(false);
    });

    it('게시 직전 공간 색인이 바뀌었으면(재색인 전환) 새 색인으로 다시 임베딩한다', async () => {
        const indexes = [spaceIndex({ id: 'old' }), spaceIndex({ id: 'new' })];
        let n = 0;
        const ensureIndex = jest.fn(async () => indexes[Math.min(n++, 1)]);
        mockMakeIndexEmbedder.mockReturnValue(async (t: string[]) => t.map(() => [0.1, 0.2]));
        respond('new');

        const res = await ingestVersion('v1', { ensureIndex, actorUserId: 'u1', readFile: async () => Buffer.from('hello world') });

        expect(res.status).toBe('ready');
        expect(ensureIndex).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['key_missing', 'EMBEDDING_KEY_MISSING'],
        ['unassigned', 'EMBEDDING_KEY_MISSING'],
        ['key_rejected', 'EMBEDDING_KEY_REJECTED'],
        ['provider', 'FAILED_EMBEDDING'],
    ])('임베딩 실패 사유 %s → 버전 failed %s', async (reason, code) => {
        mockMakeIndexEmbedder.mockReturnValue(async () => { throw new EmbeddingError(reason as never, '실패'); });
        const res = await ingestVersion('v1', { ensureIndex: async () => spaceIndex(), actorUserId: 'u1', readFile: async () => Buffer.from('hello world') });
        expect(res).toEqual({ status: 'failed', failureCode: code });
        expect(versionFailure()).toBe(code);
    });

    it('색인 고정 단계의 키 문제(행위자 없음 + 외부 라이브 배정)도 EMBEDDING_KEY_MISSING', async () => {
        const ensureIndex = jest.fn(async () => { throw new EmbeddingError('key_missing', '사용자 문맥 없이 외부 모델 불가'); });
        const res = await ingestVersion('v1', { ensureIndex, readFile: async () => Buffer.from('hello world') });
        expect(res).toEqual({ status: 'failed', failureCode: 'EMBEDDING_KEY_MISSING' });
        expect(ensureIndex).toHaveBeenCalledWith('s1', undefined);
    });
});
