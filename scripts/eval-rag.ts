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
 * @module scripts/eval-rag
 */

import {
    BASELINE_QUERIES,
    evaluateQuery,
    generateReport,
    type SearchResult,
    type EvalReport,
} from '../backend/api/src/services/rag-metrics';

// ────────────────────────────────────────
// 보고서 출력
// ────────────────────────────────────────

function printReport(report: EvalReport): void {
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

async function main(): Promise<void> {
    console.log('🔍 RAGAs 평가 스크립트 시작...\n');
    console.log(`📋 기준 질의셋: ${BASELINE_QUERIES.length}개`);

    // 동적 import (DB 의존성)
    let RAGService: typeof import('../backend/api/src/services/RAGService');
    try {
        RAGService = await import('../backend/api/src/services/RAGService');
    } catch (err) {
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
            const results = await ragService.search({ query: eq.query, topK: 10 });
            const latency = performance.now() - start;
            const mapped: SearchResult[] = results.map(r => ({
                content: r.content,
                similarity: r.similarity,
                sourceId: r.sourceId,
                chunkIndex: r.chunkIndex,
            }));
            vectorResults.push(evaluateQuery(eq, mapped, latency));
        } catch {
            vectorResults.push(evaluateQuery(eq, [], performance.now() - start));
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
            const results = await ragService.searchHybrid({ query: eq.query, topK: 10 });
            const latency = performance.now() - start;
            const mapped: SearchResult[] = results.map(r => ({
                content: r.content,
                similarity: r.similarity,
                sourceId: r.sourceId,
                chunkIndex: r.chunkIndex,
            }));
            hybridResults.push(evaluateQuery(eq, mapped, latency));
        } catch {
            hybridResults.push(evaluateQuery(eq, [], performance.now() - start));
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
    const fmt = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(4);
    console.log(`  nDCG@10:           ${fmt(delta.ndcg)}`);
    console.log(`  MRR@5:             ${fmt(delta.mrr)}`);
    console.log(`  Context Precision: ${fmt(delta.precision)}`);
    console.log(`  Context Recall:    ${fmt(delta.recall)}`);

    const p95ok = hybridReport.metrics.p95LatencyMs < 500;
    console.log(`\n  ⏱  p95 Latency SLA (<500ms): ${p95ok ? '✅ PASS' : '❌ FAIL'} (${hybridReport.metrics.p95LatencyMs.toFixed(1)}ms)`);

    const hasImprovement = delta.ndcg > 0 || delta.mrr > 0 || delta.precision > 0;
    console.log(`  📊 Hybrid > Vector: ${hasImprovement ? '✅ 확인됨' : '⚠️ 개선 미확인'}`);
    console.log('='.repeat(60) + '\n');

    if (process.argv.includes('--json')) {
        console.log(JSON.stringify({
            vectorOnly: vectorReport,
            hybrid: hybridReport,
            comparison: delta,
            sla: { p95ok, p95LatencyMs: hybridReport.metrics.p95LatencyMs },
        }, null, 2));
    }
}

main().catch((err) => {
    console.error('평가 실패:', err);
    process.exit(1);
});
