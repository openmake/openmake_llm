/**
 * RAGService 단위 테스트
 *
 * 테스트 범위:
 * - embedDocument: 정상 임베딩/저장, 빈 텍스트 0 청크, 기존 임베딩 삭제 후 재처리
 * - search: 정상 결과 반환, 쿼리 임베딩 실패 시 빈 배열
 * - buildRAGContext: VectorSearchResult → RAGContext 변환
 * - getRAGContextForChat: 결과 있으면 RAGContext, 없으면 null
 * - deleteDocumentEmbeddings: deleteBySource 위임
 * - hasDocumentEmbeddings: hasEmbeddings 위임
 * - getStats: DB 통계 + 모델 가용성 반환
 */

// ─────────────────────────────────────────────
// Mock 설정
// ─────────────────────────────────────────────

const mockEmbedText = jest.fn();
const mockEmbedBatch = jest.fn();
const mockIsAvailable = jest.fn();

jest.mock('../services/EmbeddingService', () => ({
    getEmbeddingService: jest.fn().mockReturnValue({
        embedText: mockEmbedText,
        embedBatch: mockEmbedBatch,
        isAvailable: mockIsAvailable,
    }),
}));

const mockChunkDocument = jest.fn();
jest.mock('../documents/chunker', () => ({
    chunkDocument: mockChunkDocument,
}));

const mockPoolQuery = jest.fn();
jest.mock('../data/models/unified-database', () => ({
    getPool: jest.fn().mockReturnValue({
        query: mockPoolQuery,
    }),
}));

jest.mock('../utils/logger', () => ({
    createLogger: jest.fn().mockReturnValue({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    }),
}));

jest.mock('../config/runtime-limits', () => ({
    RAG_CONFIG: {
        EMBEDDING_MODEL: 'test-embed-model',
        EMBEDDING_BATCH_SIZE: 2,
        CHUNK_SIZE: 1000,
        CHUNK_OVERLAP: 200,
        TOP_K: 5,
        RELEVANCE_THRESHOLD: 0.3,
        EMBEDDING_DIMENSIONS: 768,
        MAX_CONTEXT_CHARS: 4000,
    },
}));

// ─────────────────────────────────────────────
// Import after mocks
// ─────────────────────────────────────────────

import { RAGService } from '../services/RAGService';
import type { VectorSearchResult } from '../data/repositories/vector-repository';

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────

function makeSearchResult(overrides: Partial<VectorSearchResult> = {}): VectorSearchResult {
    return {
        id: 1,
        sourceType: 'document',
        sourceId: 'doc-001',
        chunkIndex: 0,
        content: '테스트 콘텐츠입니다.',
        metadata: { filename: 'test.pdf', userId: 'user-001' },
        similarity: 0.85,
        createdAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

// ─────────────────────────────────────────────
// 테스트
// ─────────────────────────────────────────────

describe('RAGService', () => {
    let service: RAGService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new RAGService();

        // VectorRepository 메서드를 spy
        // RAGService 내부에서 생성된 VectorRepository의 query를 mockPoolQuery로 대체
        mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

        // pgvectorAvailable 캐시 초기화 (테스트 간 격리)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any).vectorRepo.pgvectorAvailable = null;
    });

    describe('embedDocument', () => {
        test('정상적으로 문서를 청킹/임베딩/저장해야 함', async () => {
            // 기존 임베딩 없음
            mockPoolQuery.mockResolvedValueOnce({ rows: [{ exists: false }] });

            // 청킹 결과
            mockChunkDocument.mockReturnValue([
                { index: 0, content: '청크 1', startOffset: 0, endOffset: 10, metadata: { totalChunks: 2 } },
                { index: 1, content: '청크 2', startOffset: 10, endOffset: 20, metadata: { totalChunks: 2 } },
            ]);

            // 임베딩 결과
            mockEmbedBatch.mockResolvedValue([[0.1, 0.2], [0.3, 0.4]]);

            // 저장 (BATCH_SIZE=200 이하이므로 1회 배치 INSERT)
            mockPoolQuery.mockResolvedValueOnce({ rowCount: 2 });

            const result = await service.embedDocument({
                docId: 'doc-001',
                text: '테스트 문서 텍스트',
                filename: 'test.pdf',
                userId: 'user-001',
            });

            expect(result.docId).toBe('doc-001');
            expect(result.totalChunks).toBe(2);
            expect(result.embeddedChunks).toBe(2);
            expect(result.durationMs).toBeGreaterThanOrEqual(0);
            expect(mockChunkDocument).toHaveBeenCalledWith('테스트 문서 텍스트', 'test.pdf', undefined);
            expect(mockEmbedBatch).toHaveBeenCalledWith(['청크 1', '청크 2']);
        });

        test('청킹 결과가 없으면 0 청크 반환', async () => {
            mockPoolQuery.mockResolvedValueOnce({ rows: [{ exists: false }] });
            mockChunkDocument.mockReturnValue([]);

            const result = await service.embedDocument({
                docId: 'doc-002',
                text: '',
                filename: 'empty.txt',
            });

            expect(result.totalChunks).toBe(0);
            expect(result.embeddedChunks).toBe(0);
            expect(mockEmbedBatch).not.toHaveBeenCalled();
        });

        test('기존 임베딩이 있으면 삭제 후 재처리', async () => {
            // hasEmbeddings → true
            mockPoolQuery.mockResolvedValueOnce({ rows: [{ exists: true }] });
            // deleteBySource
            mockPoolQuery.mockResolvedValueOnce({ rowCount: 3 });

            mockChunkDocument.mockReturnValue([
                { index: 0, content: '새 청크', startOffset: 0, endOffset: 5, metadata: { totalChunks: 1 } },
            ]);
            mockEmbedBatch.mockResolvedValue([[0.5]]);
            mockPoolQuery.mockResolvedValueOnce({ rowCount: 1 });

            const result = await service.embedDocument({
                docId: 'doc-003',
                text: '재처리 문서',
                filename: 're.pdf',
            });

            expect(result.embeddedChunks).toBe(1);
            // hasEmbeddings + deleteBySource + INSERT = 최소 3회 호출
            // Note: withRetry wraps each query, but doesn't add extra calls on success
            expect(mockPoolQuery.mock.calls.length).toBeGreaterThanOrEqual(3);
        });

        test('임베딩이 null인 청크는 저장에서 제외', async () => {
            mockPoolQuery.mockResolvedValueOnce({ rows: [{ exists: false }] });
            mockChunkDocument.mockReturnValue([
                { index: 0, content: 'ok', startOffset: 0, endOffset: 2, metadata: { totalChunks: 2 } },
                { index: 1, content: 'fail', startOffset: 2, endOffset: 6, metadata: { totalChunks: 2 } },
            ]);
            mockEmbedBatch.mockResolvedValue([[0.1], null]);
            mockPoolQuery.mockResolvedValueOnce({ rowCount: 1 });

            const result = await service.embedDocument({
                docId: 'doc-004',
                text: 'partial',
                filename: 'p.txt',
            });

            expect(result.totalChunks).toBe(2);
            expect(result.embeddedChunks).toBe(1);
        });
    });

    describe('search', () => {
        test('쿼리 임베딩 실패 시 빈 배열 반환', async () => {
            mockEmbedText.mockResolvedValue(null);

            const results = await service.search({ query: '검색어' });

            expect(results).toEqual([]);
        });

        test('정상 쿼리 시 VectorRepository.searchSimilar 호출', async () => {
            mockEmbedText.mockResolvedValue([0.1, 0.2]);

            // pgvector 확인 → true
            mockPoolQuery.mockResolvedValueOnce({ rows: [{ exists: true }] });
            // 검색 결과
            mockPoolQuery.mockResolvedValueOnce({
                rows: [{
                    id: 1,
                    source_type: 'document',
                    source_id: 'doc-001',
                    chunk_index: 0,
                    content: '검색된 콘텐츠',
                    metadata: { filename: 'test.pdf' },
                    created_at: '2026-01-01T00:00:00.000Z',
                    similarity: 0.9,
                }],
            });

            const results = await service.search({ query: '검색어', userId: 'user-001' });

            expect(results).toHaveLength(1);
            expect(results[0].content).toBe('검색된 콘텐츠');
            expect(results[0].similarity).toBe(0.9);
        });
    });

    describe('buildRAGContext', () => {
        test('VectorSearchResult를 RAGContext로 변환해야 함', () => {
            const results = [
                makeSearchResult({ content: '문서1', similarity: 0.9 }),
                makeSearchResult({ content: '문서2', similarity: 0.7 }),
            ];

            const context = service.buildRAGContext('검색어', results);

            expect(context.searchQuery).toBe('검색어');
            expect(context.documents).toHaveLength(2);
            expect(context.documents[0].content).toBe('문서1');
            expect(context.documents[0].relevanceScore).toBe(0.9);
            expect(context.documents[1].content).toBe('문서2');
            expect(context.relevanceThreshold).toBe(0.3);
        });

        test('빈 결과 시 빈 documents 배열', () => {
            const context = service.buildRAGContext('쿼리', []);

            expect(context.documents).toHaveLength(0);
            expect(context.searchQuery).toBe('쿼리');
        });

        test('metadata에서 filename을 source로 사용', () => {
            const results = [
                makeSearchResult({ metadata: { filename: 'report.pdf' } }),
            ];

            const context = service.buildRAGContext('q', results);

            expect(context.documents[0].source).toBe('report.pdf');
        });
    });

    describe('getRAGContextForChat', () => {
        test('검색 결과가 없으면 null 반환', async () => {
            mockEmbedText.mockResolvedValue([0.1]);
            // pgvector → true, 결과 없음
            mockPoolQuery.mockResolvedValueOnce({ rows: [{ exists: true }] });
            mockPoolQuery.mockResolvedValueOnce({ rows: [] });

            const result = await service.getRAGContextForChat('질문');

            expect(result).toBeNull();
        });

        test('검색 결과가 있으면 RAGContext 반환', async () => {
            mockEmbedText.mockResolvedValue([0.1]);
            mockPoolQuery.mockResolvedValueOnce({ rows: [{ exists: true }] });
            mockPoolQuery.mockResolvedValueOnce({
                rows: [{
                    id: 1,
                    source_type: 'document',
                    source_id: 'doc-001',
                    chunk_index: 0,
                    content: '관련 콘텐츠',
                    metadata: { filename: 'doc.pdf' },
                    created_at: '2026-01-01',
                    similarity: 0.8,
                }],
            });

            const result = await service.getRAGContextForChat('질문', 'user-1');

            expect(result).not.toBeNull();
            expect(result?.documents).toHaveLength(1);
            expect(result?.documents[0].content).toBe('관련 콘텐츠');
        });
    });

    describe('deleteDocumentEmbeddings', () => {
        test('VectorRepository.deleteBySource에 위임해야 함', async () => {
            mockPoolQuery.mockResolvedValue({ rowCount: 5 });

            const count = await service.deleteDocumentEmbeddings('doc-001');

            expect(count).toBe(5);
        });
    });

    describe('hasDocumentEmbeddings', () => {
        test('임베딩 존재 시 true 반환', async () => {
            mockPoolQuery.mockResolvedValue({ rows: [{ exists: true }] });

            const result = await service.hasDocumentEmbeddings('doc-001');

            expect(result).toBe(true);
        });

        test('임베딩 미존재 시 false 반환', async () => {
            mockPoolQuery.mockResolvedValue({ rows: [{ exists: false }] });

            const result = await service.hasDocumentEmbeddings('doc-002');

            expect(result).toBe(false);
        });
    });

    describe('getStats', () => {
        test('DB 통계와 모델 가용성을 반환해야 함', async () => {
            // totalEmbeddings
            mockPoolQuery.mockResolvedValueOnce({ rows: [{ count: '42' }] });
            // uniqueSources
            mockPoolQuery.mockResolvedValueOnce({ rows: [{ count: '3' }] });
            // sourceTypes
            mockPoolQuery.mockResolvedValueOnce({
                rows: [{ source_type: 'document', count: '42' }],
            });
            mockIsAvailable.mockResolvedValue(true);

            const stats = await service.getStats();

            expect(stats.totalEmbeddings).toBe(42);
            expect(stats.uniqueSources).toBe(3);
            expect(stats.sourceTypes).toEqual({ document: 42 });
            expect(stats.embeddingModelAvailable).toBe(true);
        });
    });
});
