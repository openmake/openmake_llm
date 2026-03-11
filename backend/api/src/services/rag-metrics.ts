/**
 * ============================================================
 * RAG Metrics - RAGAs 평가 메트릭 계산 함수
 * ============================================================
 *
 * nDCG, MRR, Context Precision/Recall 등 RAGAs 프레임워크
 * 기반 검색 품질 메트릭을 계산합니다.
 *
 * @module services/rag-metrics
 */

/** 평가용 질의 데이터 */
export interface EvalQuery {
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
export interface SearchResult {
    content: string;
    similarity: number;
    sourceId: string;
    chunkIndex: number;
}

/** 단일 질의 평가 결과 */
export interface QueryEvalResult {
    queryId: string;
    query: string;
    category: string;
    retrievedCount: number;
    relevantCount: number;
    contextPrecision: number;
    contextRecall: number;
    ndcg10: number;
    reciprocalRank: number;
    latencyMs: number;
}

/** 전체 평가 보고서 */
export interface EvalReport {
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

// ────────────────────────────────────────
// 메트릭 계산 함수
// ────────────────────────────────────────

/**
 * nDCG@K (Normalized Discounted Cumulative Gain)
 *
 * @param relevanceScores - 각 위치의 관련성 점수 (1: 관련, 0: 비관련)
 * @param k - 평가할 상위 K개
 */
export function calculateNDCG(relevanceScores: number[], k: number): number {
    const topK = relevanceScores.slice(0, k);
    const dcg = topK.reduce((sum, rel, i) => sum + rel / Math.log2(i + 2), 0);
    const ideal = [...topK].sort((a, b) => b - a);
    const idcg = ideal.reduce((sum, rel, i) => sum + rel / Math.log2(i + 2), 0);
    if (idcg === 0) return 0;
    return dcg / idcg;
}

/**
 * MRR (Mean Reciprocal Rank)
 *
 * @param relevanceScores - 각 위치의 관련성 점수
 * @param k - 상위 K개까지만 검사
 */
export function calculateMRR(relevanceScores: number[], k: number): number {
    const topK = relevanceScores.slice(0, k);
    for (let i = 0; i < topK.length; i++) {
        if (topK[i] > 0) {
            return 1 / (i + 1);
        }
    }
    return 0;
}

/**
 * Context Precision
 */
export function calculateContextPrecision(relevantCount: number, totalRetrieved: number): number {
    if (totalRetrieved === 0) return 0;
    return relevantCount / totalRetrieved;
}

/**
 * Context Recall
 */
export function calculateContextRecall(matchedKeywords: number, totalExpected: number): number {
    if (totalExpected === 0) return 0;
    return matchedKeywords / totalExpected;
}

/**
 * 검색 결과에서 키워드 매칭 기반 관련성을 평가합니다.
 */
export function evaluateRelevance(
    results: SearchResult[],
    expectedKeywords: string[],
): { relevanceScores: number[]; matchedKeywordCount: number } {
    const allContent = results.map(r => r.content.toLowerCase()).join(' ');
    let matchedKeywordCount = 0;

    for (const kw of expectedKeywords) {
        if (allContent.includes(kw.toLowerCase())) {
            matchedKeywordCount++;
        }
    }

    const relevanceScores = results.map(r => {
        const content = r.content.toLowerCase();
        const hasMatch = expectedKeywords.some(kw => content.includes(kw.toLowerCase()));
        return hasMatch ? 1 : 0;
    });

    return { relevanceScores, matchedKeywordCount };
}

/**
 * 단일 질의에 대한 평가를 실행합니다.
 */
export function evaluateQuery(
    evalQuery: EvalQuery,
    results: SearchResult[],
    latencyMs: number,
): QueryEvalResult {
    const { relevanceScores, matchedKeywordCount } = evaluateRelevance(results, evalQuery.expectedKeywords);
    const relevantCount = relevanceScores.filter(s => s > 0).length;

    return {
        queryId: evalQuery.id,
        query: evalQuery.query,
        category: evalQuery.category ?? 'unknown',
        retrievedCount: results.length,
        relevantCount,
        contextPrecision: calculateContextPrecision(relevantCount, results.length),
        contextRecall: calculateContextRecall(matchedKeywordCount, evalQuery.expectedKeywords.length),
        ndcg10: calculateNDCG(relevanceScores, 10),
        reciprocalRank: calculateMRR(relevanceScores, 5),
        latencyMs,
    };
}

/**
 * 전체 평가 보고서를 생성합니다.
 */
export function generateReport(
    results: QueryEvalResult[],
    pipelineMode: string,
): EvalReport {
    const totalQueries = results.length;
    const meanNDCG10 = results.reduce((s, r) => s + r.ndcg10, 0) / totalQueries;
    const meanMRR5 = results.reduce((s, r) => s + r.reciprocalRank, 0) / totalQueries;
    const meanContextPrecision = results.reduce((s, r) => s + r.contextPrecision, 0) / totalQueries;
    const meanContextRecall = results.reduce((s, r) => s + r.contextRecall, 0) / totalQueries;
    const meanLatencyMs = results.reduce((s, r) => s + r.latencyMs, 0) / totalQueries;

    const sortedLatencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
    const p95Index = Math.ceil(totalQueries * 0.95) - 1;
    const p95LatencyMs = sortedLatencies[Math.max(0, p95Index)];

    const categoryBreakdown: Record<string, { count: number; meanNDCG10: number; meanContextPrecision: number }> = {};
    for (const r of results) {
        if (!categoryBreakdown[r.category]) {
            categoryBreakdown[r.category] = { count: 0, meanNDCG10: 0, meanContextPrecision: 0 };
        }
        categoryBreakdown[r.category].count++;
        categoryBreakdown[r.category].meanNDCG10 += r.ndcg10;
        categoryBreakdown[r.category].meanContextPrecision += r.contextPrecision;
    }
    for (const cat of Object.keys(categoryBreakdown)) {
        const c = categoryBreakdown[cat];
        c.meanNDCG10 /= c.count;
        c.meanContextPrecision /= c.count;
    }

    return {
        timestamp: new Date().toISOString(),
        pipelineMode,
        totalQueries,
        metrics: { meanNDCG10, meanMRR5, meanContextPrecision, meanContextRecall, meanLatencyMs, p95LatencyMs },
        categoryBreakdown,
        queryResults: results,
    };
}

// ────────────────────────────────────────
// 기준 질의셋 (30+ 쿼리)
// ────────────────────────────────────────

export const BASELINE_QUERIES: EvalQuery[] = [
    // 기술 문서
    { id: 'tech-01', query: 'PostgreSQL 인덱스 최적화 방법', expectedKeywords: ['인덱스', 'index', 'btree', 'explain', 'analyze'], category: 'technical' },
    { id: 'tech-02', query: 'Express 미들웨어 실행 순서', expectedKeywords: ['미들웨어', 'middleware', 'next', 'express', 'app.use'], category: 'technical' },
    { id: 'tech-03', query: 'JWT 토큰 갱신 전략', expectedKeywords: ['jwt', 'refresh', 'token', '갱신', 'access'], category: 'technical' },
    { id: 'tech-04', query: 'WebSocket 연결 관리 패턴', expectedKeywords: ['websocket', 'ws', '연결', 'connection', 'heartbeat'], category: 'technical' },
    { id: 'tech-05', query: 'TypeScript 제네릭 활용법', expectedKeywords: ['제네릭', 'generic', '<T>', 'extends', 'type'], category: 'technical' },
    { id: 'tech-06', query: 'pgvector 코사인 유사도 검색', expectedKeywords: ['vector', 'cosine', '유사도', 'embedding', 'similarity'], category: 'technical' },
    { id: 'tech-07', query: 'Node.js 클러스터링 로드밸런싱', expectedKeywords: ['cluster', 'worker', 'process', '로드밸런싱', 'fork'], category: 'technical' },
    { id: 'tech-08', query: 'REST API 버전 관리 전략', expectedKeywords: ['api', 'version', 'v1', 'v2', 'deprecation'], category: 'technical' },
    // 보안
    { id: 'sec-01', query: 'SSRF 공격 방어 기법', expectedKeywords: ['ssrf', '방어', 'url', 'validate', 'block'], category: 'security' },
    { id: 'sec-02', query: 'XSS 방지 입력 검증', expectedKeywords: ['xss', 'sanitize', 'escape', 'input', '검증'], category: 'security' },
    { id: 'sec-03', query: 'SQL 인젝션 파라미터화 쿼리', expectedKeywords: ['sql', 'injection', 'parameter', '$1', 'prepared'], category: 'security' },
    { id: 'sec-04', query: 'CORS 정책 설정 방법', expectedKeywords: ['cors', 'origin', 'header', 'access-control', '정책'], category: 'security' },
    { id: 'sec-05', query: 'OAuth 2.0 인증 플로우', expectedKeywords: ['oauth', 'authorization', 'code', 'token', 'redirect'], category: 'security' },
    { id: 'sec-06', query: 'API 키 해시 저장 방법', expectedKeywords: ['api', 'key', 'hash', 'hmac', 'sha256'], category: 'security' },
    // AI/LLM
    { id: 'ai-01', query: 'RAG 파이프라인 아키텍처', expectedKeywords: ['rag', 'retrieval', 'augmented', 'generation', '파이프라인'], category: 'ai' },
    { id: 'ai-02', query: 'LLM 프롬프트 엔지니어링 기법', expectedKeywords: ['prompt', '프롬프트', 'few-shot', 'chain-of-thought', 'system'], category: 'ai' },
    { id: 'ai-03', query: '문서 청킹 전략 비교', expectedKeywords: ['chunk', '청크', 'overlap', 'split', 'size'], category: 'ai' },
    { id: 'ai-04', query: '임베딩 모델 선택 가이드', expectedKeywords: ['embedding', '임베딩', 'nomic', 'dimension', '768'], category: 'ai' },
    { id: 'ai-05', query: 'BM25와 벡터 검색 하이브리드', expectedKeywords: ['bm25', 'hybrid', 'vector', 'tsvector', 'rrf'], category: 'ai' },
    { id: 'ai-06', query: 'Cross-encoder 재순위화 기법', expectedKeywords: ['rerank', 'cross-encoder', 'score', '재순위', '후보'], category: 'ai' },
    { id: 'ai-07', query: 'RRF 점수 계산 공식', expectedKeywords: ['rrf', 'reciprocal', 'rank', 'fusion', '1/(k+rank)'], category: 'ai' },
    { id: 'ai-08', query: 'HNSW 인덱스 파라미터 튜닝', expectedKeywords: ['hnsw', 'ef_construction', 'm=16', 'index', '근사'], category: 'ai' },
    // 프론트엔드
    { id: 'fe-01', query: 'Vanilla JS SPA 라우팅 구현', expectedKeywords: ['spa', 'router', 'pushstate', 'popstate', 'vanilla'], category: 'frontend' },
    { id: 'fe-02', query: 'CSS Design Token 체계', expectedKeywords: ['design', 'token', 'css', 'variable', '--'], category: 'frontend' },
    { id: 'fe-03', query: 'WebSocket 실시간 채팅 UI', expectedKeywords: ['websocket', 'chat', 'message', 'ui', '실시간'], category: 'frontend' },
    { id: 'fe-04', query: '다크 모드 테마 전환', expectedKeywords: ['dark', 'theme', 'prefers-color-scheme', '다크', 'mode'], category: 'frontend' },
    // 인프라
    { id: 'infra-01', query: 'PostgreSQL 마이그레이션 전략', expectedKeywords: ['migration', 'schema', 'alter', 'table', 'sql'], category: 'infrastructure' },
    { id: 'infra-02', query: '환경변수 관리 패턴', expectedKeywords: ['env', 'config', 'environment', 'dotenv', '환경변수'], category: 'infrastructure' },
    { id: 'infra-03', query: '로깅 시스템 구성', expectedKeywords: ['log', 'winston', 'logger', 'level', 'format'], category: 'infrastructure' },
    { id: 'infra-04', query: 'Rate limiting 구현 방법', expectedKeywords: ['rate', 'limit', 'throttle', '429', 'cooldown'], category: 'infrastructure' },
    { id: 'infra-05', query: '헬스체크 엔드포인트 설계', expectedKeywords: ['health', 'status', 'endpoint', 'uptime', '/api/health'], category: 'infrastructure' },
    { id: 'infra-06', query: '배치 처리 최적화', expectedKeywords: ['batch', '배치', 'bulk', 'insert', 'performance'], category: 'infrastructure' },
];
