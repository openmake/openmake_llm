/**
 * 배선 테스트 — retrieve·수집·reindex 가 어느 임베더를 고르는지 검증한다(DB 는 mock).
 * - retrieve/수집: 활성 index 의 모델(makeIndexEmbedder(index)) — 라이브 embedTexts 아님
 * - reindex: startReindex 가 라이브 배정을 building index 에 기록하고, runReindexJob 은 그 index 모델로 임베딩
 */
const mockQuery = jest.fn();

jest.mock('../db', () => ({
    kdb: () => ({ query: (...a: unknown[]) => mockQuery(...a), connect: async () => ({ query: (...a: unknown[]) => mockQuery(...a), release() { /* noop */ } }) }),
    inTransaction: async (fn: (c: { query: (...a: unknown[]) => unknown }) => unknown) => fn({ query: (...a: unknown[]) => mockQuery(...a) }),
}));
jest.mock('../embedding/provider', () => ({
    makeIndexEmbedder: jest.fn(),
    embedTexts: jest.fn(),
    describeEmbeddingProvider: jest.fn(),
}));
jest.mock('../config/profiles', () => ({
    getDefaultLimits: jest.fn(async () => ({ allowedMimeTypes: ['text/plain'], maxFileBytes: 1_000_000, minCharsPerPdfPage: 1, embedBatchSize: 16 })),
    resolveSpaceProfiles: jest.fn(async () => ({
        chunker: { id: 'c1', strategy: 'fixed-token', size: 50, overlap: 0 },
        retrieval: { id: 'r1', topK: 5, candidateCount: 10, minSimilarity: 0, maxContextChars: 5000, maxTopK: 10 },
        limits: { id: 'l1', allowedMimeTypes: ['text/plain'], maxFileBytes: 1_000_000, minCharsPerPdfPage: 1, embedBatchSize: 16 },
    })),
    applyRetrievalOverride: (p: unknown) => p,
}));
jest.mock('../retrieval/search', () => ({ searchChunks: jest.fn(async () => []) }));
jest.mock('../jobs/queue', () => ({ enqueueJob: jest.fn() }));

import { retrieve } from '../retrieval/service';
import { ingestVersion } from '../ingestion/pipeline';
import { startReindex, runReindexJob, type KnowledgeIndex } from '../embedding/index-manager';
import { makeIndexEmbedder, embedTexts, describeEmbeddingProvider } from '../embedding/provider';
import type { KnowledgeActor } from '../config/scope-policy';

const mockMakeIndexEmbedder = makeIndexEmbedder as jest.Mock;
const mockEmbedTexts = embedTexts as jest.Mock;
const mockDescribe = describeEmbeddingProvider as jest.Mock;

const actor: KnowledgeActor = { userId: 'u1', activeOrg: null, orgWriteRoles: [] };

function activeIndex(over: Partial<KnowledgeIndex> = {}): KnowledgeIndex {
    return { id: 'idx-1', providerRef: 'local-llm:idx-model', modelId: 'idx-model', dimension: 2, metric: 'cosine', status: 'ready', isActive: true, ...over };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
});

describe('retrieve — 활성 index 모델로 질의 임베딩', () => {
    it('라이브 배정이 바뀌어도 makeIndexEmbedder(activeIndex) 를 쓰고 embedTexts 는 쓰지 않는다', async () => {
        const embedder = jest.fn(async (t: string[]) => t.map(() => [0.1, 0.2]));
        mockMakeIndexEmbedder.mockReturnValue(embedder);
        const index = activeIndex();

        await retrieve(
            { actor, spaceIds: ['s1'], query: 'q', sourceOffset: 0, userLang: 'en' },
            { getActiveIndex: async () => index },
        );

        expect(mockMakeIndexEmbedder).toHaveBeenCalledWith(index);
        expect(embedder).toHaveBeenCalledWith(['q']);
        expect(mockEmbedTexts).not.toHaveBeenCalled();
    });
});

describe('ingestVersion — 활성 index 모델로 청크 임베딩', () => {
    it('makeIndexEmbedder(ensuredIndex) 로 임베딩하고 embedTexts 는 쓰지 않는다', async () => {
        const index = activeIndex();
        const embedder = jest.fn(async (t: string[]) => t.map(() => [0.1, 0.2]));
        mockMakeIndexEmbedder.mockReturnValue(embedder);

        mockQuery.mockImplementation(async (sql: string) => {
            if (/v\.storage_ref/.test(sql)) {
                return { rows: [{ id: 'v1', document_id: 'd1', storage_ref: 'ref', mime_type: 'text/plain', source_size: '11', space_id: 's1', config_profile_id: null }] };
            }
            if (/SELECT id, content FROM knowledge_chunks WHERE document_version_id/.test(sql)) {
                return { rows: [{ id: 'ch1', content: 'hello world' }] };
            }
            if (/COUNT\(\*\)::text AS n FROM knowledge_chunk_embeddings/.test(sql)) return { rows: [{ n: '1' }] };
            if (/SELECT id FROM knowledge_embedding_indexes WHERE is_active/.test(sql)) return { rows: [{ id: index.id }] };
            return { rows: [] };
        });

        const res = await ingestVersion('v1', {
            ensureIndex: async () => index,
            readFile: async () => Buffer.from('hello world'),
        });

        expect(res.status).toBe('ready');
        expect(mockMakeIndexEmbedder).toHaveBeenCalledWith(index);
        expect(embedder).toHaveBeenCalledTimes(1);
        expect(mockEmbedTexts).not.toHaveBeenCalled();
    });
});

describe('reindex — 라이브 배정으로', () => {
    it('startReindex 는 라이브 배정(describeEmbeddingProvider)을 building index 에 기록한다', async () => {
        mockDescribe.mockResolvedValue({ providerRef: 'local-llm:new-model', modelId: 'new-model', dimension: 3 });

        await startReindex();

        const insert = mockQuery.mock.calls.find((c) => /INSERT INTO knowledge_embedding_indexes/.test(String(c[0])));
        expect(insert).toBeDefined();
        // params: [id, provider_ref, model_id, dimension, metric]
        expect(insert![1][1]).toBe('local-llm:new-model');
        expect(insert![1][2]).toBe('new-model');
        expect(mockDescribe).toHaveBeenCalled();
    });

    it('runReindexJob 은 building index 의 (라이브에서 기록된) 모델로 임베딩한다', async () => {
        const embedder = jest.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3]));
        mockMakeIndexEmbedder.mockReturnValue(embedder);
        let batchServed = false;

        mockQuery.mockImplementation(async (sql: string) => {
            if (/knowledge_embedding_indexes WHERE id = \$1/.test(sql)) {
                return { rows: [{ id: 'bi', provider_ref: 'local-llm:new-model', model_id: 'new-model', dimension: 3, distance_metric: 'cosine', status: 'building', is_active: false }] };
            }
            if (/COUNT\(\*\)::text AS n FROM knowledge_chunk_embeddings/.test(sql)) return { rows: [{ n: '1' }] }; // got
            if (/COUNT\(\*\)::text AS n/.test(sql) && /NOT EXISTS/.test(sql)) return { rows: [{ n: '0' }] }; // 전환 직전 missing
            if (/COUNT\(\*\)::text AS n/.test(sql)) return { rows: [{ n: '1' }] }; // expected
            if (/LIMIT \$2/.test(sql)) {
                if (!batchServed) { batchServed = true; return { rows: [{ id: 'ch1', content: 'x' }] }; }
                return { rows: [] };
            }
            return { rows: [] };
        });

        await runReindexJob('bi');

        expect(mockMakeIndexEmbedder).toHaveBeenCalledWith(
            expect.objectContaining({ providerRef: 'local-llm:new-model', modelId: 'new-model', dimension: 3 }),
        );
        expect(embedder).toHaveBeenCalled();
        expect(mockEmbedTexts).not.toHaveBeenCalled();
    });
});
