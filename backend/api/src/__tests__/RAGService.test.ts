/**
 * RAGService 단위 테스트
 *
 * 테스트 범위:
 * - embedDocument: 정상 청킹/저장, 빈 텍스트 0 청크, 기존 청크 삭제 후 재처리
 * - search: FTS 렉시컬 검색 결과 반환
 * - buildRAGContext: VectorSearchResult → RAGContext 변환
 * - getRAGContextForChat: 결과 있으면 RAGContext, 없으면 null
 * - deleteDocumentEmbeddings: deleteBySource 위임
 * - hasDocumentChunks: hasChunks 위임
 * - getStats: DB 통계 반환
 */

// ─────────────────────────────────────────────
// Mock 설정
// ─────────────────────────────────────────────

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
    ...jest.requireActual('../config/runtime-limits'),
    RAG_CONFIG: {
        CHUNK_SIZE: 1000,
        CHUNK_OVERLAP: 200,
        TOP_K: 5,
        RELEVANCE_THRESHOLD: 0.45,
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
        mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    });

    describe('embedDocument', () => {
        test('정상적으로 문서를 청킹/저장해야 함', async () => {
            // 기존 청크 없음
            mockPoolQuery.mockResolvedValueOnce({ rows: [{ exists: false }] });

            // 청킹 결과
            mockChunkDocument.mockReturnValue([
                { index: 0, content: '청크 1', startOffset: 0, endOffset: 10, metadata: { totalChunks: 2 } },
                { index: 1, content: '청크 2', startOffset: 10, endOffset: 20, metadata: { totalChunks: 2 } },
            ]);

            // 저장 (배치 INSERT)
            mockPoolQuery.mockResolvedValueOnce({ rowCount: 2 });

            const result = await service.embedDocument({
                docId: 'doc-001',
                text: '테스트 문서 텍스트',
                filename: 'test.pdf',
                userId: 'user-001',
            });

            expect(result.docId).toBe('doc-001');
            expect(result.totalChunks).toBe(2);
            expect(result.storedChunks).toBe(2);
            expect(result.durationMs).toBeGreaterThanOrEqual(0);
            expect(mockChunkDocument).toHaveBeenCalledWith('테스트 문서 텍스트', 'test.pdf', undefined);
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
            expect(result.storedChunks).toBe(0);
        });

        test('기존 청크가 있으면 삭제 후 재처리', async () => {
            // hasChunks → true
            mockPoolQuery.mockResolvedValueOnce({ rows: [{ exists: true }] });
            // deleteBySource
            mockPoolQuery.mockResolvedValueOnce({ rowCount: 3 });

            mockChunkDocument.mockReturnValue([
                { index: 0, content: '새 청크', startOffset: 0, endOffset: 5, metadata: { totalChunks: 1 } },
            ]);
            mockPoolQuery.mockResolvedValueOnce({ rowCount: 1 });

            const result = await service.embedDocument({
                docId: 'doc-003',
                text: '재처리 문서',
                filename: 're.pdf',
            });

            expect(result.storedChunks).toBe(1);
            expect(mockPoolQuery.mock.calls.length).toBeGreaterThanOrEqual(3);
        });
    });

    describe('search', () => {
        test('FTS 검색 결과를 반환해야 함', async () => {
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

        test('결과가 없으면 빈 배열 반환', async () => {
            mockPoolQuery.mockResolvedValueOnce({ rows: [] });
            const results = await service.search({ query: '검색어' });
            expect(results).toEqual([]);
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
            expect(context.relevanceThreshold).toBe(0.45);
        });

        test('빈 결과 시 빈 documents 배열', () => {
            const context = service.buildRAGContext('쿼리', []);
            expect(context.documents).toHaveLength(0);
            expect(context.searchQuery).toBe('쿼리');
        });

        test('metadata에서 filename을 source로 사용', () => {
            const results = [makeSearchResult({ metadata: { filename: 'report.pdf' } })];
            const context = service.buildRAGContext('q', results);
            expect(context.documents[0].source).toBe('report.pdf');
        });
    });

    describe('getRAGContextForChat', () => {
        test('검색 결과가 없으면 null 반환', async () => {
            mockPoolQuery.mockResolvedValueOnce({ rows: [] });
            const result = await service.getRAGContextForChat('질문');
            expect(result).toBeNull();
        });

        test('검색 결과가 있으면 RAGContext 반환', async () => {
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

    describe('hasDocumentChunks', () => {
        test('청크 존재 시 true 반환', async () => {
            mockPoolQuery.mockResolvedValue({ rows: [{ exists: true }] });
            const result = await service.hasDocumentChunks('doc-001');
            expect(result).toBe(true);
        });

        test('청크 미존재 시 false 반환', async () => {
            mockPoolQuery.mockResolvedValue({ rows: [{ exists: false }] });
            const result = await service.hasDocumentChunks('doc-002');
            expect(result).toBe(false);
        });
    });

    describe('getStats', () => {
        test('DB 통계를 반환해야 함', async () => {
            mockPoolQuery.mockResolvedValueOnce({ rows: [{ count: '42' }] });
            mockPoolQuery.mockResolvedValueOnce({ rows: [{ count: '3' }] });
            mockPoolQuery.mockResolvedValueOnce({
                rows: [{ source_type: 'document', count: '42' }],
            });

            const stats = await service.getStats();

            expect(stats.totalChunks).toBe(42);
            expect(stats.uniqueSources).toBe(3);
            expect(stats.sourceTypes).toEqual({ document: 42 });
        });
    });
});
