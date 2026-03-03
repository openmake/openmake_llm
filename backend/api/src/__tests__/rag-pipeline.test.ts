/**
 * ============================================================
 * RAG Pipeline 통합 테스트 — RAGAs 메트릭 + 파이프라인 검증
 * ============================================================
 *
 * 3단계 RAG 파이프라인(BM25+Vector → RRF → Reranker)의 메트릭 계산과
 * 파이프라인 로직을 단위 테스트합니다.
 *
 * DB 의존성 없이 모킹으로 실행됩니다.
 */

import { describe, it, expect } from 'bun:test';

// ────────────────────────────────────────
// eval-rag.ts 메트릭 함수 import
// ────────────────────────────────────────

import {
    calculateNDCG,
    calculateMRR,
    calculateContextPrecision,
    calculateContextRecall,
    evaluateRelevance,
    BASELINE_QUERIES,
} from '../services/rag-metrics';

// ────────────────────────────────────────
// RRF 함수 import
// ────────────────────────────────────────

import { reciprocalRankFusion } from '../services/RAGService';
import type { VectorSearchResult } from '../data/repositories/vector-repository';

// ────────────────────────────────────────
// 테스트 헬퍼
// ────────────────────────────────────────

function makeResult(id: number, content: string, similarity: number): VectorSearchResult {
    return {
        id,
        sourceType: 'document',
        sourceId: `doc-${id}`,
        chunkIndex: 0,
        content,
        metadata: {},
        similarity,
        createdAt: '2026-01-01',
    };
}

// ────────────────────────────────────────
// nDCG@K 테스트
// ────────────────────────────────────────

describe('nDCG@K', () => {
    it('완벽한 순위는 1.0을 반환한다', () => {
        const relevance = [1, 1, 1, 0, 0];
        expect(calculateNDCG(relevance, 5)).toBeCloseTo(1.0, 4);
    });

    it('모든 결과가 비관련이면 0을 반환한다', () => {
        const relevance = [0, 0, 0, 0, 0];
        expect(calculateNDCG(relevance, 5)).toBe(0);
    });

    it('관련 결과가 뒤에 있으면 1.0보다 작다', () => {
        const relevance = [0, 0, 1, 1, 1];
        const ndcg = calculateNDCG(relevance, 5);
        expect(ndcg).toBeGreaterThan(0);
        expect(ndcg).toBeLessThan(1.0);
    });

    it('K보다 짧은 배열도 처리한다', () => {
        const relevance = [1, 0];
        const ndcg = calculateNDCG(relevance, 10);
        expect(ndcg).toBeCloseTo(1.0, 4);
    });

    it('빈 배열은 0을 반환한다', () => {
        expect(calculateNDCG([], 10)).toBe(0);
    });

    it('단일 관련 결과 1위 → nDCG=1.0', () => {
        expect(calculateNDCG([1], 1)).toBeCloseTo(1.0, 4);
    });

    it('역순 배치 시 nDCG < 완벽 배치', () => {
        const perfect = calculateNDCG([1, 1, 0, 0], 4);
        const reversed = calculateNDCG([0, 0, 1, 1], 4);
        expect(perfect).toBeGreaterThan(reversed);
    });
});

// ────────────────────────────────────────
// MRR@K 테스트
// ────────────────────────────────────────

describe('MRR@K', () => {
    it('1위에 관련 결과 → MRR = 1.0', () => {
        expect(calculateMRR([1, 0, 0], 5)).toBe(1.0);
    });

    it('2위에 관련 결과 → MRR = 0.5', () => {
        expect(calculateMRR([0, 1, 0], 5)).toBe(0.5);
    });

    it('3위에 관련 결과 → MRR ≈ 0.333', () => {
        expect(calculateMRR([0, 0, 1], 5)).toBeCloseTo(1 / 3, 4);
    });

    it('관련 결과 없음 → MRR = 0', () => {
        expect(calculateMRR([0, 0, 0], 5)).toBe(0);
    });

    it('K 범위 밖의 관련 결과는 무시된다', () => {
        expect(calculateMRR([0, 0, 0, 0, 0, 1], 5)).toBe(0);
    });

    it('빈 배열 → MRR = 0', () => {
        expect(calculateMRR([], 5)).toBe(0);
    });
});

// ────────────────────────────────────────
// Context Precision / Recall 테스트
// ────────────────────────────────────────

describe('Context Precision', () => {
    it('모두 관련 → 1.0', () => {
        expect(calculateContextPrecision(5, 5)).toBe(1.0);
    });

    it('절반 관련 → 0.5', () => {
        expect(calculateContextPrecision(3, 6)).toBe(0.5);
    });

    it('결과 없음 → 0', () => {
        expect(calculateContextPrecision(0, 0)).toBe(0);
    });
});

describe('Context Recall', () => {
    it('모든 키워드 매칭 → 1.0', () => {
        expect(calculateContextRecall(5, 5)).toBe(1.0);
    });

    it('일부 키워드 매칭', () => {
        expect(calculateContextRecall(2, 4)).toBe(0.5);
    });

    it('키워드 없음 → 0', () => {
        expect(calculateContextRecall(0, 0)).toBe(0);
    });
});

// ────────────────────────────────────────
// evaluateRelevance 테스트
// ────────────────────────────────────────

describe('evaluateRelevance', () => {
    it('키워드가 포함된 결과는 관련으로 판정', () => {
        const results = [
            { content: 'PostgreSQL index optimization', similarity: 0.9, sourceId: 'doc-1', chunkIndex: 0 },
            { content: 'Node.js performance tuning', similarity: 0.8, sourceId: 'doc-2', chunkIndex: 0 },
        ];
        const keywords = ['index', 'optimization'];
        const { relevanceScores, matchedKeywordCount } = evaluateRelevance(results, keywords);

        expect(relevanceScores[0]).toBe(1); // index, optimization 포함
        expect(relevanceScores[1]).toBe(0); // 키워드 없음
        expect(matchedKeywordCount).toBe(2); // index + optimization
    });

    it('대소문자 무관 매칭', () => {
        const results = [
            { content: 'JWT Token Refresh Strategy', similarity: 0.9, sourceId: 'doc-1', chunkIndex: 0 },
        ];
        const keywords = ['jwt', 'REFRESH'];
        const { matchedKeywordCount } = evaluateRelevance(results, keywords);
        expect(matchedKeywordCount).toBe(2);
    });

    it('빈 결과 → 모든 관련성 0', () => {
        const { relevanceScores, matchedKeywordCount } = evaluateRelevance([], ['keyword']);
        expect(relevanceScores).toEqual([]);
        expect(matchedKeywordCount).toBe(0);
    });
});

// ────────────────────────────────────────
// Baseline Queries 검증
// ────────────────────────────────────────

describe('Baseline Queries', () => {
    it('30개 이상의 기준 질의가 있다', () => {
        expect(BASELINE_QUERIES.length).toBeGreaterThanOrEqual(30);
    });

    it('모든 질의에 필수 필드가 있다', () => {
        for (const q of BASELINE_QUERIES) {
            expect(q.id).toBeTruthy();
            expect(q.query).toBeTruthy();
            expect(q.expectedKeywords.length).toBeGreaterThan(0);
        }
    });

    it('고유한 질의 ID를 사용한다', () => {
        const ids = BASELINE_QUERIES.map(q => q.id);
        const unique = new Set(ids);
        expect(unique.size).toBe(ids.length);
    });

    it('5개 이상의 카테고리가 있다', () => {
        const categories = new Set(BASELINE_QUERIES.map(q => q.category).filter(Boolean));
        expect(categories.size).toBeGreaterThanOrEqual(5);
    });
});

// ────────────────────────────────────────
// RRF (Reciprocal Rank Fusion) 통합 테스트
// ────────────────────────────────────────

describe('RRF Pipeline Integration', () => {
    it('벡터+렉시컬 결과를 융합하여 점수 순 정렬한다', () => {
        const vectorResults = [
            makeResult(1, 'Document about PostgreSQL index', 0.95),
            makeResult(2, 'Document about Express middleware', 0.85),
            makeResult(3, 'Document about JWT authentication', 0.75),
        ];
        const lexicalResults = [
            makeResult(3, 'Document about JWT authentication', 0.8),
            makeResult(1, 'Document about PostgreSQL index', 0.7),
            makeResult(4, 'Document about WebSocket', 0.6),
        ];

        const fused = reciprocalRankFusion(vectorResults, lexicalResults, 5);

        // ID 1과 3은 양쪽 모두 등장 → 높은 RRF 점수
        expect(fused.length).toBeLessThanOrEqual(5);
        expect(fused.length).toBeGreaterThan(0);

        // 점수 순 정렬 검증
        for (let i = 1; i < fused.length; i++) {
            expect(fused[i - 1].similarity).toBeGreaterThanOrEqual(fused[i].similarity);
        }
    });

    it('양쪽 모두 등장하는 문서가 높은 점수를 받는다', () => {
        const vectorResults = [
            makeResult(10, 'Shared document', 0.9),
            makeResult(20, 'Vector only', 0.8),
        ];
        const lexicalResults = [
            makeResult(10, 'Shared document', 0.85),
            makeResult(30, 'Lexical only', 0.7),
        ];

        const fused = reciprocalRankFusion(vectorResults, lexicalResults, 3);

        // ID 10 (양쪽 등장)이 최상위
        expect(fused[0].id).toBe(10);
    });

    it('한쪽이 빈 배열이면 다른 쪽만 반환한다', () => {
        const vectorResults = [
            makeResult(1, 'Only vector', 0.9),
        ];
        const fused = reciprocalRankFusion(vectorResults, [], 5);
        expect(fused.length).toBe(1);
        expect(fused[0].id).toBe(1);
    });

    it('topK 제한을 준수한다', () => {
        const vectorResults = Array.from({ length: 10 }, (_, i) =>
            makeResult(i + 1, `Vector doc ${i}`, 0.9 - i * 0.05)
        );
        const lexicalResults = Array.from({ length: 10 }, (_, i) =>
            makeResult(i + 11, `Lexical doc ${i}`, 0.8 - i * 0.05)
        );

        const fused = reciprocalRankFusion(vectorResults, lexicalResults, 3);
        expect(fused.length).toBe(3);
    });

    it('RRF 점수는 양수이다', () => {
        const vectorResults = [makeResult(1, 'Doc', 0.5)];
        const lexicalResults = [makeResult(2, 'Doc2', 0.5)];

        const fused = reciprocalRankFusion(vectorResults, lexicalResults, 5);
        for (const r of fused) {
            expect(r.similarity).toBeGreaterThan(0);
        }
    });
});

// ────────────────────────────────────────
// 파이프라인 비교 시뮬레이션
// ────────────────────────────────────────

describe('Pipeline Comparison (simulated)', () => {
    it('Hybrid+RRF가 vector-only보다 recall을 개선한다 (시뮬레이션)', () => {
        // Vector-only: 키워드 매칭 안되는 시맨틱 결과
        const vectorOnly = [
            { content: 'semantic similar content about databases', similarity: 0.9, sourceId: 'v1', chunkIndex: 0 },
            { content: 'another semantic match', similarity: 0.8, sourceId: 'v2', chunkIndex: 0 },
        ];

        // Hybrid: 시맨틱 + 키워드 매칭 결과 포함
        const hybrid = [
            { content: 'PostgreSQL index optimization with btree', similarity: 0.85, sourceId: 'h1', chunkIndex: 0 },
            { content: 'semantic similar content about databases', similarity: 0.8, sourceId: 'h2', chunkIndex: 0 },
        ];

        const keywords = ['index', 'btree', 'postgresql'];

        const vectorEval = evaluateRelevance(vectorOnly, keywords);
        const hybridEval = evaluateRelevance(hybrid, keywords);

        // Hybrid가 더 많은 키워드 매칭
        expect(hybridEval.matchedKeywordCount).toBeGreaterThan(vectorEval.matchedKeywordCount);
    });

    it('nDCG@10 메트릭이 0~1 범위 내이다', () => {
        for (let i = 0; i < 100; i++) {
            const scores = Array.from({ length: 10 }, () => Math.random() > 0.5 ? 1 : 0);
            const ndcg = calculateNDCG(scores, 10);
            expect(ndcg).toBeGreaterThanOrEqual(0);
            expect(ndcg).toBeLessThanOrEqual(1.0 + 1e-10);
        }
    });
});
