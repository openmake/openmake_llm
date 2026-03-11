#!/usr/bin/env bun
/**
 * ============================================================
 * RAGAs 평가 스크립트 - RAG 파이프라인 자동 벤치마크
 * ============================================================
 *
 * 3단계 RAG 파이프라인(BM25+Vector → RRF → Reranker)의 품질을
 * RAGAs 프레임워크 기반 메트릭으로 측정합니다.
 *
 * 실행: bun run scripts/eval-rag.ts
 *
 * 메트릭:
 * - nDCG@10: Normalized Discounted Cumulative Gain (순위 품질)
 * - MRR@5: Mean Reciprocal Rank (첫 정답 순위)
 * - Faithfulness: 응답이 컨텍스트에 근거하는 비율
 * - Context Precision: 검색된 컨텍스트 중 관련 컨텍스트 비율
 * - Context Recall: 필요한 컨텍스트 중 검색된 비율
 * - Answer Relevance: 응답의 질문 관련성
 *
 * @module scripts/eval-rag
 */
/** 평가용 질의 데이터 */
interface EvalQuery {
    /** 고유 ID */
    id: string;
    /** 사용자 질의 */
    query: string;
    /** 기대 정답 컨텍스트 키워드 (부분 매칭) */
    expectedKeywords: string[];
    /** 카테고리 (선택) */
    category?: string;
}
/** 검색 결과 */
interface SearchResult {
    content: string;
    similarity: number;
    sourceId: string;
    chunkIndex: number;
}
/** 단일 질의 평가 결과 */
interface QueryEvalResult {
    queryId: string;
    query: string;
    category: string;
    /** 검색된 결과 수 */
    retrievedCount: number;
    /** 관련 결과 수 (키워드 매칭) */
    relevantCount: number;
    /** Context Precision: 관련 결과 / 전체 결과 */
    contextPrecision: number;
    /** Context Recall: 매칭된 키워드 / 전체 기대 키워드 */
    contextRecall: number;
    /** nDCG@10: 순위 품질 */
    ndcg10: number;
    /** Reciprocal Rank: 첫 관련 결과의 역순위 */
    reciprocalRank: number;
    /** 검색 소요 시간 (ms) */
    latencyMs: number;
}
/** 전체 평가 보고서 */
interface EvalReport {
    timestamp: string;
    pipelineMode: string;
    totalQueries: number;
    metrics: {
        meanNDCG10: number;
        meanMRR5: number;
        meanContextPrecision: number;
        meanContextRecall: number;
        meanLatencyMs: number;
        p95LatencyMs: number;
    };
    categoryBreakdown: Record<string, {
        count: number;
        meanNDCG10: number;
        meanContextPrecision: number;
    }>;
    queryResults: QueryEvalResult[];
}
declare const BASELINE_QUERIES: EvalQuery[];
/**
 * nDCG@K (Normalized Discounted Cumulative Gain)
 *
 * 순위에 따른 관련성 점수를 로그 할인하여 합산합니다.
 * 이상적인 순위(IDCG) 대비 실제 순위(DCG)의 비율.
 *
 * @param relevanceScores - 각 위치의 관련성 점수 (1: 관련, 0: 비관련)
 * @param k - 평가할 상위 K개
 */
export declare function calculateNDCG(relevanceScores: number[], k: number): number;
/**
 * MRR (Mean Reciprocal Rank)
 *
 * 첫 번째 관련 결과의 역순위를 반환합니다.
 *
 * @param relevanceScores - 각 위치의 관련성 점수
 * @param k - 상위 K개까지만 검사
 */
export declare function calculateMRR(relevanceScores: number[], k: number): number;
/**
 * Context Precision
 *
 * 검색된 결과 중 관련 결과의 비율입니다.
 *
 * @param relevantCount - 관련 결과 수
 * @param totalRetrieved - 전체 검색된 결과 수
 */
export declare function calculateContextPrecision(relevantCount: number, totalRetrieved: number): number;
/**
 * Context Recall
 *
 * 기대 키워드 중 실제 검색된 결과에 포함된 비율입니다.
 *
 * @param matchedKeywords - 매칭된 키워드 수
 * @param totalExpected - 전체 기대 키워드 수
 */
export declare function calculateContextRecall(matchedKeywords: number, totalExpected: number): number;
/**
 * 검색 결과에서 키워드 매칭 기반 관련성을 평가합니다.
 *
 * @param results - 검색 결과
 * @param expectedKeywords - 기대 키워드 목록
 * @returns 각 결과의 관련성 점수 (0 또는 1)
 */
export declare function evaluateRelevance(results: SearchResult[], expectedKeywords: string[]): {
    relevanceScores: number[];
    matchedKeywordCount: number;
};
/**
 * 단일 질의에 대한 평가를 실행합니다.
 */
declare function evaluateQuery(evalQuery: EvalQuery, results: SearchResult[], latencyMs: number): QueryEvalResult;
/**
 * 전체 평가 보고서를 생성합니다.
 */
declare function generateReport(results: QueryEvalResult[], pipelineMode: string): EvalReport;
export { BASELINE_QUERIES, evaluateQuery, generateReport, type EvalQuery, type SearchResult, type QueryEvalResult, type EvalReport, };
//# sourceMappingURL=eval-rag.d.ts.map