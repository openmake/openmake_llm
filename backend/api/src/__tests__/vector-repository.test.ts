/**
 * VectorRepository 단위 테스트
 *
 * 테스트 범위:
 * - storeEmbeddings: 단일/다중 저장, 빈 배열, 개별 실패
 * - searchSimilar: pgvector 미설치 빈 결과, 정상 결과, 필터 옵션
 * - deleteBySource: 정상 삭제, 실패 시 0
 * - hasEmbeddings: true/false 케이스
 * - countBySource: 카운트 반환
 * - getStats: 통계 객체
 */

// ─────────────────────────────────────────────
// Mock 설정
// ─────────────────────────────────────────────

const mockQuery = jest.fn();

jest.mock('../utils/logger', () => ({
    createLogger: jest.fn().mockReturnValue({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    }),
}));

// ─────────────────────────────────────────────
// Import after mocks
// ─────────────────────────────────────────────

import { VectorRepository } from '../data/repositories/vector-repository';
import type { VectorEmbeddingInput } from '../data/repositories/vector-repository';
import type { Pool } from 'pg';

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────

function makeInput(overrides: Partial<VectorEmbeddingInput> = {}): VectorEmbeddingInput {
    return {
        sourceType: 'document',
        sourceId: 'doc-001',
        chunkIndex: 0,
        content: '테스트 청크 내용',
        embedding: [0.1, 0.2, 0.3],
        metadata: { filename: 'test.pdf' },
        ...overrides,
    };
}

function createRepo(): VectorRepository {
    const fakePool = { query: mockQuery } as unknown as Pool;
    return new VectorRepository(fakePool);
}

// ─────────────────────────────────────────────
// 테스트
// ─────────────────────────────────────────────

describe('VectorRepository', () => {
    let repo: VectorRepository;

    beforeEach(() => {
        jest.clearAllMocks();
        repo = createRepo();
    });

    describe('storeEmbeddings', () => {
        test('빈 배열 입력 시 0 반환', async () => {
            const count = await repo.storeEmbeddings([]);

            expect(count).toBe(0);
            expect(mockQuery).not.toHaveBeenCalled();
        });

        test('단일 임베딩 저장 성공', async () => {
            // pgvector 확인
            mockQuery.mockResolvedValueOnce({ rows: [{ exists: true }] });
            // INSERT
            mockQuery.mockResolvedValueOnce({ rowCount: 1 });

            const count = await repo.storeEmbeddings([makeInput()]);

            expect(count).toBe(1);
        });

        test('다중 임베딩 저장 성공', async () => {
            // pgvector 확인
            mockQuery.mockResolvedValueOnce({ rows: [{ exists: true }] });
            // INSERT × 3
            mockQuery
                .mockResolvedValueOnce({ rowCount: 1 })
                .mockResolvedValueOnce({ rowCount: 1 })
                .mockResolvedValueOnce({ rowCount: 1 });

            const inputs = [
                makeInput({ chunkIndex: 0 }),
                makeInput({ chunkIndex: 1 }),
                makeInput({ chunkIndex: 2 }),
            ];

            const count = await repo.storeEmbeddings(inputs);

            expect(count).toBe(3);
        });

        test('개별 INSERT 실패 시 나머지 성공', async () => {
            // pgvector 확인
            mockQuery.mockResolvedValueOnce({ rows: [{ exists: true }] });
            // INSERT: 성공, 실패, 성공
            mockQuery
                .mockResolvedValueOnce({ rowCount: 1 })
                .mockRejectedValueOnce(new Error('INSERT 실패'))
                .mockResolvedValueOnce({ rowCount: 1 });

            const inputs = [
                makeInput({ chunkIndex: 0 }),
                makeInput({ chunkIndex: 1 }),
                makeInput({ chunkIndex: 2 }),
            ];

            const count = await repo.storeEmbeddings(inputs);

            expect(count).toBe(2);
        });

        test('pgvector 미설치 시 TEXT 형식으로 저장', async () => {
            // pgvector 미설치
            mockQuery.mockResolvedValueOnce({ rows: [{ exists: false }] });
            // INSERT (JSON 형식)
            mockQuery.mockResolvedValueOnce({ rowCount: 1 });

            const count = await repo.storeEmbeddings([makeInput()]);

            expect(count).toBe(1);
            // INSERT 호출에서 embedding이 JSON 문자열인지 확인
            const insertCall = mockQuery.mock.calls[1];
            const embeddingParam = insertCall[1][4];
            expect(embeddingParam).toBe(JSON.stringify([0.1, 0.2, 0.3]));
        });
    });

    describe('searchSimilar', () => {
        test('pgvector 미설치 시 빈 배열 반환', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [{ exists: false }] });

            const results = await repo.searchSimilar([0.1, 0.2]);

            expect(results).toEqual([]);
        });

        test('정상 검색 결과를 올바른 형태로 매핑', async () => {
            // pgvector 사용 가능
            mockQuery.mockResolvedValueOnce({ rows: [{ exists: true }] });
            // 검색 결과
            mockQuery.mockResolvedValueOnce({
                rows: [{
                    id: 1,
                    source_type: 'document',
                    source_id: 'doc-001',
                    chunk_index: 0,
                    content: '검색 결과 콘텐츠',
                    metadata: { filename: 'test.pdf' },
                    created_at: '2026-01-01T00:00:00Z',
                    similarity: 0.85,
                }],
            });

            const results = await repo.searchSimilar([0.1, 0.2]);

            expect(results).toHaveLength(1);
            expect(results[0]).toEqual({
                id: 1,
                sourceType: 'document',
                sourceId: 'doc-001',
                chunkIndex: 0,
                content: '검색 결과 콘텐츠',
                metadata: { filename: 'test.pdf' },
                createdAt: '2026-01-01T00:00:00Z',
                similarity: 0.85,
            });
        });

        test('검색 실패 시 빈 배열 반환', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [{ exists: true }] });
            mockQuery.mockRejectedValueOnce(new Error('SQL 오류'));

            const results = await repo.searchSimilar([0.1]);

            expect(results).toEqual([]);
        });

        test('옵션으로 sourceType, userId 필터 적용', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [{ exists: true }] });
            mockQuery.mockResolvedValueOnce({ rows: [] });

            await repo.searchSimilar([0.1], {
                sourceType: 'document',
                userId: 'user-001',
                topK: 3,
                threshold: 0.5,
            });

            const searchCall = mockQuery.mock.calls[1];
            const sql = searchCall[0] as string;
            expect(sql).toContain('source_type');
            expect(sql).toContain("metadata->>'userId'");
        });
    });

    describe('deleteBySource', () => {
        test('정상 삭제 시 삭제 수 반환', async () => {
            mockQuery.mockResolvedValue({ rowCount: 5 });

            const count = await repo.deleteBySource('document', 'doc-001');

            expect(count).toBe(5);
        });

        test('삭제 실패 시 0 반환', async () => {
            mockQuery.mockRejectedValue(new Error('DELETE 실패'));

            const count = await repo.deleteBySource('document', 'doc-001');

            expect(count).toBe(0);
        });
    });

    describe('hasEmbeddings', () => {
        test('임베딩 존재 시 true', async () => {
            mockQuery.mockResolvedValue({ rows: [{ exists: true }] });

            const result = await repo.hasEmbeddings('document', 'doc-001');

            expect(result).toBe(true);
        });

        test('임베딩 미존재 시 false', async () => {
            mockQuery.mockResolvedValue({ rows: [{ exists: false }] });

            const result = await repo.hasEmbeddings('document', 'doc-002');

            expect(result).toBe(false);
        });

        test('조회 실패 시 false', async () => {
            mockQuery.mockRejectedValue(new Error('SELECT 실패'));

            const result = await repo.hasEmbeddings('document', 'doc-003');

            expect(result).toBe(false);
        });
    });

    describe('countBySource', () => {
        test('정상 카운트 반환', async () => {
            mockQuery.mockResolvedValue({ rows: [{ count: '10' }] });

            const count = await repo.countBySource('document', 'doc-001');

            expect(count).toBe(10);
        });

        test('실패 시 0 반환', async () => {
            mockQuery.mockRejectedValue(new Error('COUNT 실패'));

            const count = await repo.countBySource('document', 'doc-001');

            expect(count).toBe(0);
        });
    });

    describe('getStats', () => {
        test('전체 통계를 올바르게 반환', async () => {
            // totalEmbeddings
            mockQuery.mockResolvedValueOnce({ rows: [{ count: '100' }] });
            // uniqueSources
            mockQuery.mockResolvedValueOnce({ rows: [{ count: '5' }] });
            // sourceTypes
            mockQuery.mockResolvedValueOnce({
                rows: [
                    { source_type: 'document', count: '80' },
                    { source_type: 'conversation', count: '20' },
                ],
            });

            const stats = await repo.getStats();

            expect(stats.totalEmbeddings).toBe(100);
            expect(stats.uniqueSources).toBe(5);
            expect(stats.sourceTypes).toEqual({
                document: 80,
                conversation: 20,
            });
        });

        test('통계 조회 실패 시 기본값 반환', async () => {
            mockQuery.mockRejectedValue(new Error('통계 실패'));

            const stats = await repo.getStats();

            expect(stats.totalEmbeddings).toBe(0);
            expect(stats.uniqueSources).toBe(0);
            expect(stats.sourceTypes).toEqual({});
        });
    });
});
