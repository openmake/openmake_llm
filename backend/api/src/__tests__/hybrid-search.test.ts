/**
 * Hybrid Search + RRF 융합 테스트
 *
 * 테스트 범위:
 * - reciprocalRankFusion: 순위 기반 융합, 중복 ID 합산, topK 절단, 단일 리스트
 * - RAGService.searchHybrid: vector+lexical 병렬 실행, fallback 동작
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

jest.mock('../documents/chunker', () => ({
    chunkDocument: jest.fn(),
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
        RELEVANCE_THRESHOLD: 0.45,
        EMBEDDING_DIMENSIONS: 768,
        MAX_CONTEXT_CHARS: 4000,
    },
}));

// ─────────────────────────────────────────────
// Import after mocks
// ─────────────────────────────────────────────

import { reciprocalRankFusion } from '../services/RAGService';
import type { VectorSearchResult } from '../data/repositories/vector-repository';

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────

function makeResult(id: number, similarity: number = 0.8): VectorSearchResult {
    return {
        id,
        sourceType: 'document',
        sourceId: `doc-${id}`,
        chunkIndex: 0,
        content: `청크 내용 ${id}`,
        metadata: { filename: `file-${id}.pdf` },
        similarity,
        createdAt: '2026-01-01T00:00:00.000Z',
    };
}

// ─────────────────────────────────────────────
// reciprocalRankFusion 테스트
// ─────────────────────────────────────────────

describe('reciprocalRankFusion', () => {
    test('문서가 양쪽 모두 등장하면 점수가 합산됨', () => {
        const vector = [makeResult(1), makeResult(2), makeResult(3)];
        const lexical = [makeResult(2), makeResult(4), makeResult(1)];

        const fused = reciprocalRankFusion(vector, lexical, 10);

        // ID=1: vector rank 0 + lexical rank 2
        // ID=2: vector rank 1 + lexical rank 0
        // Both appear in both lists, so they should be top-ranked
        const ids = fused.map(r => r.id);
        expect(ids).toContain(1);
        expect(ids).toContain(2);
        expect(ids).toContain(3);
        expect(ids).toContain(4);

        // 양쪽 모두 등장한 ID=1, ID=2가 상위
        const topTwo = fused.slice(0, 2).map(r => r.id);
        expect(topTwo).toContain(1);
        expect(topTwo).toContain(2);
    });

    test('topK로 결과 수 제한됨', () => {
        const vector = [makeResult(1), makeResult(2), makeResult(3), makeResult(4), makeResult(5)];
        const lexical = [makeResult(6), makeResult(7), makeResult(8)];

        const fused = reciprocalRankFusion(vector, lexical, 3);
        expect(fused).toHaveLength(3);
    });

    test('빈 vector 리스트에서 lexical만 반환', () => {
        const lexical = [makeResult(1), makeResult(2)];
        const fused = reciprocalRankFusion([], lexical, 10);

        expect(fused).toHaveLength(2);
        expect(fused[0].id).toBe(1); // rank 0 = highest score
    });

    test('빈 lexical 리스트에서 vector만 반환', () => {
        const vector = [makeResult(1), makeResult(2)];
        const fused = reciprocalRankFusion(vector, [], 10);

        expect(fused).toHaveLength(2);
        expect(fused[0].id).toBe(1);
    });

    test('양쪽 모두 빈 리스트면 빈 결과', () => {
        const fused = reciprocalRankFusion([], [], 10);
        expect(fused).toHaveLength(0);
    });

    test('RRF 점수가 similarity 필드에 설정됨', () => {
        const vector = [makeResult(1, 0.9)];
        const lexical = [makeResult(1, 0.5)];

        const fused = reciprocalRankFusion(vector, lexical, 10);
        // RRF 점수 = 1/(60+0+1) + 1/(60+0+1) = 2/61
        expect(fused[0].similarity).toBeCloseTo(2 / 61, 5);
    });

    test('k 파라미터를 변경할 수 있음', () => {
        const vector = [makeResult(1)];
        const lexical = [makeResult(1)];

        const fused10 = reciprocalRankFusion(vector, lexical, 10, 10);
        // k=10: score = 2 * 1/(10+0+1) = 2/11
        expect(fused10[0].similarity).toBeCloseTo(2 / 11, 5);
    });

    test('결과가 RRF 점수 내림차순으로 정렬됨', () => {
        // ID=1: only in vector (rank 0)  → 1/61
        // ID=2: both (vector rank 1, lexical rank 0) → 1/62 + 1/61
        // ID=3: only in lexical (rank 1) → 1/62
        const vector = [makeResult(1), makeResult(2)];
        const lexical = [makeResult(2), makeResult(3)];

        const fused = reciprocalRankFusion(vector, lexical, 10);

        // ID=2 should be highest (appears in both)
        expect(fused[0].id).toBe(2);
        // ID=1 and ID=3 both have single-list scores
        // ID=1: 1/61 ≈ 0.01639
        // ID=3: 1/62 ≈ 0.01613
        // ID=1 slightly higher
        expect(fused[1].id).toBe(1);
        expect(fused[2].id).toBe(3);
    });

    test('메타데이터가 원본에서 보존됨', () => {
        const vector = [makeResult(42)];
        vector[0].metadata = { filename: 'special.pdf', userId: 'u1' };
        vector[0].content = '특별한 콘텐츠';

        const fused = reciprocalRankFusion(vector, [], 10);
        expect(fused[0].content).toBe('특별한 콘텐츠');
        expect(fused[0].metadata).toEqual({ filename: 'special.pdf', userId: 'u1' });
        expect(fused[0].id).toBe(42);
    });
});
