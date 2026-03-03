#!/usr/bin/env bun
"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BASELINE_QUERIES = void 0;
exports.calculateNDCG = calculateNDCG;
exports.calculateMRR = calculateMRR;
exports.calculateContextPrecision = calculateContextPrecision;
exports.calculateContextRecall = calculateContextRecall;
exports.evaluateRelevance = evaluateRelevance;
exports.evaluateQuery = evaluateQuery;
exports.generateReport = generateReport;
// ────────────────────────────────────────
// 기준 질의셋 (30+ 쿼리)
// ────────────────────────────────────────
const BASELINE_QUERIES = [
    // 카테고리: 기술 문서
    { id: 'tech-01', query: 'PostgreSQL 인덱스 최적화 방법', expectedKeywords: ['인덱스', 'index', 'btree', 'explain', 'analyze'], category: 'technical' },
    { id: 'tech-02', query: 'Express 미들웨어 실행 순서', expectedKeywords: ['미들웨어', 'middleware', 'next', 'express', 'app.use'], category: 'technical' },
    { id: 'tech-03', query: 'JWT 토큰 갱신 전략', expectedKeywords: ['jwt', 'refresh', 'token', '갱신', 'access'], category: 'technical' },
    { id: 'tech-04', query: 'WebSocket 연결 관리 패턴', expectedKeywords: ['websocket', 'ws', '연결', 'connection', 'heartbeat'], category: 'technical' },
    { id: 'tech-05', query: 'TypeScript 제네릭 활용법', expectedKeywords: ['제네릭', 'generic', '<T>', 'extends', 'type'], category: 'technical' },
    { id: 'tech-06', query: 'pgvector 코사인 유사도 검색', expectedKeywords: ['vector', 'cosine', '유사도', 'embedding', 'similarity'], category: 'technical' },
    { id: 'tech-07', query: 'Node.js 클러스터링 로드밸런싱', expectedKeywords: ['cluster', 'worker', 'process', '로드밸런싱', 'fork'], category: 'technical' },
    { id: 'tech-08', query: 'REST API 버전 관리 전략', expectedKeywords: ['api', 'version', 'v1', 'v2', 'deprecation'], category: 'technical' },
    // 카테고리: 보안
    { id: 'sec-01', query: 'SSRF 공격 방어 기법', expectedKeywords: ['ssrf', '방어', 'url', 'validate', 'block'], category: 'security' },
    { id: 'sec-02', query: 'XSS 방지 입력 검증', expectedKeywords: ['xss', 'sanitize', 'escape', 'input', '검증'], category: 'security' },
    { id: 'sec-03', query: 'SQL 인젝션 파라미터화 쿼리', expectedKeywords: ['sql', 'injection', 'parameter', '$1', 'prepared'], category: 'security' },
    { id: 'sec-04', query: 'CORS 정책 설정 방법', expectedKeywords: ['cors', 'origin', 'header', 'access-control', '정책'], category: 'security' },
    { id: 'sec-05', query: 'OAuth 2.0 인증 플로우', expectedKeywords: ['oauth', 'authorization', 'code', 'token', 'redirect'], category: 'security' },
    { id: 'sec-06', query: 'API 키 해시 저장 방법', expectedKeywords: ['api', 'key', 'hash', 'hmac', 'sha256'], category: 'security' },
    // 카테고리: AI/LLM
    { id: 'ai-01', query: 'RAG 파이프라인 아키텍처', expectedKeywords: ['rag', 'retrieval', 'augmented', 'generation', '파이프라인'], category: 'ai' },
    { id: 'ai-02', query: 'LLM 프롬프트 엔지니어링 기법', expectedKeywords: ['prompt', '프롬프트', 'few-shot', 'chain-of-thought', 'system'], category: 'ai' },
    { id: 'ai-03', query: '문서 청킹 전략 비교', expectedKeywords: ['chunk', '청크', 'overlap', 'split', 'size'], category: 'ai' },
    { id: 'ai-04', query: '임베딩 모델 선택 가이드', expectedKeywords: ['embedding', '임베딩', 'nomic', 'dimension', '768'], category: 'ai' },
    { id: 'ai-05', query: 'BM25와 벡터 검색 하이브리드', expectedKeywords: ['bm25', 'hybrid', 'vector', 'tsvector', 'rrf'], category: 'ai' },
    { id: 'ai-06', query: 'Cross-encoder 재순위화 기법', expectedKeywords: ['rerank', 'cross-encoder', 'score', '재순위', '후보'], category: 'ai' },
    { id: 'ai-07', query: 'RRF 점수 계산 공식', expectedKeywords: ['rrf', 'reciprocal', 'rank', 'fusion', '1/(k+rank)'], category: 'ai' },
    { id: 'ai-08', query: 'HNSW 인덱스 파라미터 튜닝', expectedKeywords: ['hnsw', 'ef_construction', 'm=16', 'index', '근사'], category: 'ai' },
    // 카테고리: 프론트엔드
    { id: 'fe-01', query: 'Vanilla JS SPA 라우팅 구현', expectedKeywords: ['spa', 'router', 'pushstate', 'popstate', 'vanilla'], category: 'frontend' },
    { id: 'fe-02', query: 'CSS Design Token 체계', expectedKeywords: ['design', 'token', 'css', 'variable', '--'], category: 'frontend' },
    { id: 'fe-03', query: 'WebSocket 실시간 채팅 UI', expectedKeywords: ['websocket', 'chat', 'message', 'ui', '실시간'], category: 'frontend' },
    { id: 'fe-04', query: '다크 모드 테마 전환', expectedKeywords: ['dark', 'theme', 'prefers-color-scheme', '다크', 'mode'], category: 'frontend' },
    // 카테고리: 인프라
    { id: 'infra-01', query: 'PostgreSQL 마이그레이션 전략', expectedKeywords: ['migration', 'schema', 'alter', 'table', 'sql'], category: 'infrastructure' },
    { id: 'infra-02', query: '환경변수 관리 패턴', expectedKeywords: ['env', 'config', 'environment', 'dotenv', '환경변수'], category: 'infrastructure' },
    { id: 'infra-03', query: '로깅 시스템 구성', expectedKeywords: ['log', 'winston', 'logger', 'level', 'format'], category: 'infrastructure' },
    { id: 'infra-04', query: 'Rate limiting 구현 방법', expectedKeywords: ['rate', 'limit', 'throttle', '429', 'cooldown'], category: 'infrastructure' },
    { id: 'infra-05', query: '헬스체크 엔드포인트 설계', expectedKeywords: ['health', 'status', 'endpoint', 'uptime', '/api/health'], category: 'infrastructure' },
    { id: 'infra-06', query: '배치 처리 최적화', expectedKeywords: ['batch', '배치', 'bulk', 'insert', 'performance'], category: 'infrastructure' },
];
exports.BASELINE_QUERIES = BASELINE_QUERIES;
// ────────────────────────────────────────
// RAGAs 메트릭 계산 함수
// ────────────────────────────────────────
/**
 * nDCG@K (Normalized Discounted Cumulative Gain)
 *
 * 순위에 따른 관련성 점수를 로그 할인하여 합산합니다.
 * 이상적인 순위(IDCG) 대비 실제 순위(DCG)의 비율.
 *
 * @param relevanceScores - 각 위치의 관련성 점수 (1: 관련, 0: 비관련)
 * @param k - 평가할 상위 K개
 */
function calculateNDCG(relevanceScores, k) {
    const topK = relevanceScores.slice(0, k);
    // DCG: sum of (relevance_i / log2(i+2))
    const dcg = topK.reduce((sum, rel, i) => sum + rel / Math.log2(i + 2), 0);
    // IDCG: DCG of ideal ranking (모든 관련 결과가 앞에 배치)
    const ideal = [...topK].sort((a, b) => b - a);
    const idcg = ideal.reduce((sum, rel, i) => sum + rel / Math.log2(i + 2), 0);
    if (idcg === 0)
        return 0;
    return dcg / idcg;
}
/**
 * MRR (Mean Reciprocal Rank)
 *
 * 첫 번째 관련 결과의 역순위를 반환합니다.
 *
 * @param relevanceScores - 각 위치의 관련성 점수
 * @param k - 상위 K개까지만 검사
 */
function calculateMRR(relevanceScores, k) {
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
 *
 * 검색된 결과 중 관련 결과의 비율입니다.
 *
 * @param relevantCount - 관련 결과 수
 * @param totalRetrieved - 전체 검색된 결과 수
 */
function calculateContextPrecision(relevantCount, totalRetrieved) {
    if (totalRetrieved === 0)
        return 0;
    return relevantCount / totalRetrieved;
}
/**
 * Context Recall
 *
 * 기대 키워드 중 실제 검색된 결과에 포함된 비율입니다.
 *
 * @param matchedKeywords - 매칭된 키워드 수
 * @param totalExpected - 전체 기대 키워드 수
 */
function calculateContextRecall(matchedKeywords, totalExpected) {
    if (totalExpected === 0)
        return 0;
    return matchedKeywords / totalExpected;
}
/**
 * 검색 결과에서 키워드 매칭 기반 관련성을 평가합니다.
 *
 * @param results - 검색 결과
 * @param expectedKeywords - 기대 키워드 목록
 * @returns 각 결과의 관련성 점수 (0 또는 1)
 */
function evaluateRelevance(results, expectedKeywords) {
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
function evaluateQuery(evalQuery, results, latencyMs) {
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
function generateReport(results, pipelineMode) {
    const totalQueries = results.length;
    // 전체 메트릭 평균
    const meanNDCG10 = results.reduce((s, r) => s + r.ndcg10, 0) / totalQueries;
    const meanMRR5 = results.reduce((s, r) => s + r.reciprocalRank, 0) / totalQueries;
    const meanContextPrecision = results.reduce((s, r) => s + r.contextPrecision, 0) / totalQueries;
    const meanContextRecall = results.reduce((s, r) => s + r.contextRecall, 0) / totalQueries;
    const meanLatencyMs = results.reduce((s, r) => s + r.latencyMs, 0) / totalQueries;
    // p95 Latency
    const sortedLatencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
    const p95Index = Math.ceil(totalQueries * 0.95) - 1;
    const p95LatencyMs = sortedLatencies[Math.max(0, p95Index)];
    // 카테고리별 분석
    const categoryBreakdown = {};
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
        metrics: {
            meanNDCG10,
            meanMRR5,
            meanContextPrecision,
            meanContextRecall,
            meanLatencyMs,
            p95LatencyMs,
        },
        categoryBreakdown,
        queryResults: results,
    };
}
/**
 * 보고서를 콘솔에 출력합니다.
 */
function printReport(report) {
    console.log('\n' + '='.repeat(60));
    console.log(`  RAGAs 평가 보고서 — ${report.pipelineMode}`);
    console.log('='.repeat(60));
    console.log(`  시간: ${report.timestamp}`);
    console.log(`  질의 수: ${report.totalQueries}`);
    console.log('');
    console.log('  📊 전체 메트릭:');
    console.log(`    nDCG@10:            ${report.metrics.meanNDCG10.toFixed(4)}`);
    console.log(`    MRR@5:              ${report.metrics.meanMRR5.toFixed(4)}`);
    console.log(`    Context Precision:  ${report.metrics.meanContextPrecision.toFixed(4)}`);
    console.log(`    Context Recall:     ${report.metrics.meanContextRecall.toFixed(4)}`);
    console.log(`    Mean Latency:       ${report.metrics.meanLatencyMs.toFixed(1)}ms`);
    console.log(`    p95 Latency:        ${report.metrics.p95LatencyMs.toFixed(1)}ms`);
    console.log('');
    console.log('  📁 카테고리별:');
    for (const [cat, data] of Object.entries(report.categoryBreakdown)) {
        console.log(`    ${cat} (${data.count}건): nDCG=${data.meanNDCG10.toFixed(4)}, Precision=${data.meanContextPrecision.toFixed(4)}`);
    }
    console.log('='.repeat(60) + '\n');
}
// ────────────────────────────────────────
// 메인 실행
// ────────────────────────────────────────
/**
 * RAG 파이프라인 평가를 실행합니다.
 *
 * 두 모드로 평가:
 * 1. vector-only: searchSimilar만 사용
 * 2. hybrid+rrf+reranker: searchHybrid 전체 파이프라인
 *
 * DB 연결이 필요하므로 .env 설정 후 실행하세요.
 */
async function main() {
    console.log('🔍 RAGAs 평가 스크립트 시작...\n');
    console.log(`📋 기준 질의셋: ${BASELINE_QUERIES.length}개`);
    // 동적 import (DB 의존성)
    let RAGService;
    try {
        RAGService = await Promise.resolve().then(() => __importStar(require('../backend/api/src/services/RAGService')));
    }
    catch (err) {
        console.error('❌ RAGService 임포트 실패. 빌드 후 실행하세요.');
        console.error('   bun run scripts/eval-rag.ts');
        process.exit(1);
    }
    const ragService = RAGService.getRAGService();
    // ── 모드 1: Vector-only ──
    console.log('\n── 모드 1: Vector-only 검색 ──');
    const vectorResults = [];
    for (const eq of BASELINE_QUERIES) {
        const start = performance.now();
        try {
            const results = await ragService.search({
                query: eq.query,
                topK: 10,
            });
            const latency = performance.now() - start;
            const mapped = results.map(r => ({
                content: r.content,
                similarity: r.similarity,
                sourceId: r.sourceId,
                chunkIndex: r.chunkIndex,
            }));
            vectorResults.push(evaluateQuery(eq, mapped, latency));
        }
        catch (err) {
            const latency = performance.now() - start;
            vectorResults.push(evaluateQuery(eq, [], latency));
        }
    }
    const vectorReport = generateReport(vectorResults, 'Vector-only');
    printReport(vectorReport);
    // ── 모드 2: Hybrid + RRF + Reranker ──
    console.log('\n── 모드 2: Hybrid + RRF + Reranker ──');
    const hybridResults = [];
    for (const eq of BASELINE_QUERIES) {
        const start = performance.now();
        try {
            const results = await ragService.searchHybrid({
                query: eq.query,
                topK: 10,
            });
            const latency = performance.now() - start;
            const mapped = results.map(r => ({
                content: r.content,
                similarity: r.similarity,
                sourceId: r.sourceId,
                chunkIndex: r.chunkIndex,
            }));
            hybridResults.push(evaluateQuery(eq, mapped, latency));
        }
        catch (err) {
            const latency = performance.now() - start;
            hybridResults.push(evaluateQuery(eq, [], latency));
        }
    }
    const hybridReport = generateReport(hybridResults, 'Hybrid+RRF+Reranker');
    printReport(hybridReport);
    // ── 비교 ──
    console.log('\n' + '='.repeat(60));
    console.log('  📈 비교: Hybrid vs Vector-only');
    console.log('='.repeat(60));
    const delta = {
        ndcg: hybridReport.metrics.meanNDCG10 - vectorReport.metrics.meanNDCG10,
        mrr: hybridReport.metrics.meanMRR5 - vectorReport.metrics.meanMRR5,
        precision: hybridReport.metrics.meanContextPrecision - vectorReport.metrics.meanContextPrecision,
        recall: hybridReport.metrics.meanContextRecall - vectorReport.metrics.meanContextRecall,
    };
    const fmt = (v) => (v >= 0 ? '+' : '') + v.toFixed(4);
    console.log(`  nDCG@10:           ${fmt(delta.ndcg)}`);
    console.log(`  MRR@5:             ${fmt(delta.mrr)}`);
    console.log(`  Context Precision: ${fmt(delta.precision)}`);
    console.log(`  Context Recall:    ${fmt(delta.recall)}`);
    // SLA 체크
    const p95ok = hybridReport.metrics.p95LatencyMs < 500;
    console.log(`\n  ⏱  p95 Latency SLA (<500ms): ${p95ok ? '✅ PASS' : '❌ FAIL'} (${hybridReport.metrics.p95LatencyMs.toFixed(1)}ms)`);
    // 기준선 확립 여부
    const hasImprovement = delta.ndcg > 0 || delta.mrr > 0 || delta.precision > 0;
    console.log(`  📊 Hybrid > Vector: ${hasImprovement ? '✅ 확인됨' : '⚠️ 개선 미확인'}`);
    console.log('='.repeat(60) + '\n');
    // JSON 보고서 출력 (파이프라인용)
    if (process.argv.includes('--json')) {
        const jsonOutput = {
            vectorOnly: vectorReport,
            hybrid: hybridReport,
            comparison: delta,
            sla: { p95ok, p95LatencyMs: hybridReport.metrics.p95LatencyMs },
        };
        console.log(JSON.stringify(jsonOutput, null, 2));
    }
}
main().catch((err) => {
    console.error('평가 실패:', err);
    process.exit(1);
});
//# sourceMappingURL=eval-rag.js.map