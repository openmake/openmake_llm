/**
 * MemoryRepository 단위 테스트
 *
 * 테스트 범위:
 * - cleanupExpiredMemories: 만료 레코드 삭제, 삭제 행 수 반환
 * - decayImportance: 30일 미접근 메모리 importance 감쇠, 최솟값 0.1 보장
 * - getSemanticMemoryIds: 임베딩 벡터 유사도 기반 ID 조회
 * - cosineSimilarity: getSemanticMemoryIds를 통한 간접 테스트
 */

// ─────────────────────────────────────────────
// Mock 설정
// ─────────────────────────────────────────────

const mockQuery = jest.fn();
const mockWithRetry = jest.fn();

jest.mock('../data/retry-wrapper', () => ({
    withRetry: (fn: () => unknown) => mockWithRetry(fn),
    withTransaction: jest.fn(),
}));

// ─────────────────────────────────────────────
// Import after mocks
// ─────────────────────────────────────────────

import { Pool } from 'pg';
import { MemoryRepository } from '../data/repositories/memory-repository';

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────

function makePool(): jest.Mocked<Pool> {
    return { query: mockQuery } as unknown as jest.Mocked<Pool>;
}

// ─────────────────────────────────────────────
// beforeEach
// ─────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
    // withRetry는 fn()을 즉시 실행하여 결과를 그대로 반환하도록 설정
    mockWithRetry.mockImplementation((fn: () => unknown) => fn());
});

// ─────────────────────────────────────────────
// 테스트
// ─────────────────────────────────────────────

describe('MemoryRepository', () => {
    let repo: MemoryRepository;
    let pool: jest.Mocked<Pool>;

    beforeEach(() => {
        pool = makePool();
        repo = new MemoryRepository(pool);
    });

    // ─────────────────────────────────────────
    // cleanupExpiredMemories
    // ─────────────────────────────────────────
    describe('cleanupExpiredMemories', () => {
        test('expires_at이 과거인 레코드를 삭제하는 SQL을 실행한다', async () => {
            mockQuery.mockResolvedValue({ rowCount: 3, rows: [] });

            await repo.cleanupExpiredMemories();

            expect(mockQuery).toHaveBeenCalledTimes(1);
            const [sql] = mockQuery.mock.calls[0];
            expect(sql).toContain('DELETE FROM user_memories');
            expect(sql).toContain('expires_at IS NOT NULL');
            expect(sql).toContain('expires_at < NOW()');
        });

        test('삭제된 행 수를 반환한다', async () => {
            mockQuery.mockResolvedValue({ rowCount: 5, rows: [] });

            const count = await repo.cleanupExpiredMemories();

            expect(count).toBe(5);
        });

        test('삭제된 행이 없으면 0을 반환한다', async () => {
            mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });

            const count = await repo.cleanupExpiredMemories();

            expect(count).toBe(0);
        });

        test('rowCount가 null이면 0을 반환한다', async () => {
            mockQuery.mockResolvedValue({ rowCount: null, rows: [] });

            const count = await repo.cleanupExpiredMemories();

            expect(count).toBe(0);
        });
    });

    // ─────────────────────────────────────────
    // decayImportance
    // ─────────────────────────────────────────
    describe('decayImportance', () => {
        test('30일 미접근 메모리의 importance를 0.95배로 감쇠하는 SQL을 실행한다', async () => {
            mockQuery.mockResolvedValue({ rowCount: 7, rows: [] });

            await repo.decayImportance();

            expect(mockQuery).toHaveBeenCalledTimes(1);
            const [sql] = mockQuery.mock.calls[0];
            expect(sql).toContain('UPDATE user_memories');
            expect(sql).toContain('importance * 0.95');
            expect(sql).toContain("INTERVAL '30 days'");
        });

        test('importance가 0.1 이하로 내려가지 않도록 GREATEST(0.1, ...) 적용 확인', async () => {
            mockQuery.mockResolvedValue({ rowCount: 2, rows: [] });

            await repo.decayImportance();

            const [sql] = mockQuery.mock.calls[0];
            expect(sql).toContain('GREATEST(0.1,');
        });

        test('importance > 0.1 조건이 WHERE 절에 포함된다', async () => {
            mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });

            await repo.decayImportance();

            const [sql] = mockQuery.mock.calls[0];
            expect(sql).toContain('importance > 0.1');
        });

        test('갱신된 행 수를 반환한다', async () => {
            mockQuery.mockResolvedValue({ rowCount: 4, rows: [] });

            const count = await repo.decayImportance();

            expect(count).toBe(4);
        });

        test('갱신된 행이 없으면 0을 반환한다', async () => {
            mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });

            const count = await repo.decayImportance();

            expect(count).toBe(0);
        });

        test('rowCount가 null이면 0을 반환한다', async () => {
            mockQuery.mockResolvedValue({ rowCount: null, rows: [] });

            const count = await repo.decayImportance();

            expect(count).toBe(0);
        });
    });

    // ─────────────────────────────────────────
    // getSemanticMemoryIds
    // ─────────────────────────────────────────
    describe('getSemanticMemoryIds', () => {
        const userId = 'user-001';

        test('vector_embeddings와 user_memories JOIN 쿼리를 실행한다', async () => {
            mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

            await repo.getSemanticMemoryIds([1, 0, 0], userId);

            const [sql, params] = mockQuery.mock.calls[0];
            expect(sql).toContain('vector_embeddings');
            expect(sql).toContain('user_memories');
            expect(sql).toContain("source_type = 'memory'");
            expect(params).toContain(userId);
        });

        test('결과가 없으면 빈 배열을 반환한다', async () => {
            mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

            const ids = await repo.getSemanticMemoryIds([1, 0, 0], userId);

            expect(ids).toEqual([]);
        });

        test('코사인 유사도 0.3 이하인 항목은 필터링된다', async () => {
            // [1,0,0]과 [0,1,0]의 코사인 유사도 = 0 (0.3 이하 → 제외)
            mockQuery.mockResolvedValue({
                rows: [
                    { source_id: 'mem-low', embedding: JSON.stringify([0, 1, 0]) },
                ],
                rowCount: 1,
            });

            const ids = await repo.getSemanticMemoryIds([1, 0, 0], userId);

            expect(ids).toEqual([]);
        });

        test('코사인 유사도 0.3 초과인 항목은 포함된다', async () => {
            // [1,0,0]과 [1,0,0]의 코사인 유사도 = 1 (0.3 초과 → 포함)
            mockQuery.mockResolvedValue({
                rows: [
                    { source_id: 'mem-high', embedding: JSON.stringify([1, 0, 0]) },
                ],
                rowCount: 1,
            });

            const ids = await repo.getSemanticMemoryIds([1, 0, 0], userId);

            expect(ids).toContain('mem-high');
        });

        test('유사도 내림차순으로 정렬된다', async () => {
            // query: [1, 0, 0]
            // mem-a: [0.9, 0.1, 0] → 유사도 높음
            // mem-b: [0.6, 0.4, 0] → 유사도 중간
            // mem-c: [0.5, 0.5, 0] → 유사도 낮음
            mockQuery.mockResolvedValue({
                rows: [
                    { source_id: 'mem-b', embedding: JSON.stringify([0.6, 0.4, 0]) },
                    { source_id: 'mem-c', embedding: JSON.stringify([0.5, 0.5, 0]) },
                    { source_id: 'mem-a', embedding: JSON.stringify([0.9, 0.1, 0]) },
                ],
                rowCount: 3,
            });

            const ids = await repo.getSemanticMemoryIds([1, 0, 0], userId, 3);

            // 유사도 높은 순 (mem-a가 첫 번째)
            expect(ids[0]).toBe('mem-a');
        });

        test('limit 개수 이상의 결과는 잘라낸다', async () => {
            const rows = Array.from({ length: 10 }, (_, i) => ({
                source_id: `mem-${i}`,
                embedding: JSON.stringify([1, 0, 0]), // 유사도 1.0
            }));
            mockQuery.mockResolvedValue({ rows, rowCount: 10 });

            const ids = await repo.getSemanticMemoryIds([1, 0, 0], userId, 3);

            expect(ids).toHaveLength(3);
        });

        test('기본 limit은 5이다', async () => {
            const rows = Array.from({ length: 10 }, (_, i) => ({
                source_id: `mem-${i}`,
                embedding: JSON.stringify([1, 0, 0]),
            }));
            mockQuery.mockResolvedValue({ rows, rowCount: 10 });

            const ids = await repo.getSemanticMemoryIds([1, 0, 0], userId);

            expect(ids).toHaveLength(5);
        });

        test('잘못된 embedding JSON은 에러 없이 skip된다', async () => {
            mockQuery.mockResolvedValue({
                rows: [
                    { source_id: 'mem-bad', embedding: 'not-valid-json' },
                    { source_id: 'mem-good', embedding: JSON.stringify([1, 0, 0]) },
                ],
                rowCount: 2,
            });

            const ids = await repo.getSemanticMemoryIds([1, 0, 0], userId);

            expect(ids).not.toContain('mem-bad');
            expect(ids).toContain('mem-good');
        });

        test('embedding 길이가 다른 경우 유사도 0으로 처리된다 (0.3 이하로 필터링)', async () => {
            mockQuery.mockResolvedValue({
                rows: [
                    { source_id: 'mem-mismatch', embedding: JSON.stringify([1, 0]) }, // 길이 2 vs 3
                ],
                rowCount: 1,
            });

            const ids = await repo.getSemanticMemoryIds([1, 0, 0], userId);

            expect(ids).toEqual([]);
        });
    });

    // ─────────────────────────────────────────
    // cosineSimilarity (간접 테스트)
    // ─────────────────────────────────────────
    describe('cosineSimilarity (getSemanticMemoryIds를 통한 간접 테스트)', () => {
        test('동일한 벡터의 코사인 유사도는 1이다 (포함됨)', async () => {
            mockQuery.mockResolvedValue({
                rows: [{ source_id: 'mem-same', embedding: JSON.stringify([3, 4]) }],
                rowCount: 1,
            });

            const ids = await repo.getSemanticMemoryIds([3, 4], 'user-x');

            expect(ids).toContain('mem-same');
        });

        test('직교 벡터의 코사인 유사도는 0이다 (필터링됨)', async () => {
            mockQuery.mockResolvedValue({
                rows: [{ source_id: 'mem-ortho', embedding: JSON.stringify([0, 1]) }],
                rowCount: 1,
            });

            const ids = await repo.getSemanticMemoryIds([1, 0], 'user-x');

            expect(ids).toEqual([]);
        });

        test('영 벡터(norm=0)는 유사도 0으로 처리된다 (필터링됨)', async () => {
            mockQuery.mockResolvedValue({
                rows: [{ source_id: 'mem-zero', embedding: JSON.stringify([0, 0, 0]) }],
                rowCount: 1,
            });

            const ids = await repo.getSemanticMemoryIds([0, 0, 0], 'user-x');

            expect(ids).toEqual([]);
        });

        test('높은 유사도 순으로 상위 limit개만 반환한다', async () => {
            // query [1, 0]에 대해:
            // mem-a: [1, 0] → cos=1.0
            // mem-b: [0.8, 0.6] → cos ≈ 0.8
            // mem-c: [0.6, 0.8] → cos ≈ 0.6
            mockQuery.mockResolvedValue({
                rows: [
                    { source_id: 'mem-c', embedding: JSON.stringify([0.6, 0.8]) },
                    { source_id: 'mem-a', embedding: JSON.stringify([1, 0]) },
                    { source_id: 'mem-b', embedding: JSON.stringify([0.8, 0.6]) },
                ],
                rowCount: 3,
            });

            const ids = await repo.getSemanticMemoryIds([1, 0], 'user-x', 2);

            expect(ids).toHaveLength(2);
            expect(ids[0]).toBe('mem-a');
            expect(ids[1]).toBe('mem-b');
        });
    });
});
