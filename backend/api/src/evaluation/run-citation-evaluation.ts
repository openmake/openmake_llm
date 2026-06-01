/**
 * ============================================================
 * Run Citation Evaluation CLI — Deep Research 인용 커버리지 평가 (A3)
 * ============================================================
 *
 * 사용법:
 *   ts-node src/evaluation/run-citation-evaluation.ts                      # 기본 fixture 코퍼스
 *   ts-node src/evaluation/run-citation-evaluation.ts custom.json          # 사용자 지정 코퍼스
 *
 * 결과:
 *   - 콘솔에 회귀 + 집계(mean coverage / invalid-rate / skip) 출력
 *   - exit code: fixture 기대값 회귀가 있으면 1, 없으면 0 (CI 통합)
 *
 * 인용 측정 함수(verifyCitations)는 런타임 report-generator와 공유되므로,
 * 이 평가가 통과하면 런타임 측정의 정확성도 보장된다.
 *
 * @module evaluation/run-citation-evaluation
 */
import * as fs from 'fs';
import * as path from 'path';
import { runCitationEvaluation, type CitationFixtureDataset } from './citation-evaluator';

function loadDataset(customPath?: string): CitationFixtureDataset {
    const filePath = customPath
        ? path.resolve(process.cwd(), customPath)
        : path.resolve(__dirname, 'fixtures/citation-reports.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as CitationFixtureDataset;
}

function main(): void {
    const dataset = loadDataset(process.argv[2]);
    console.log(`\n[Citation Eval] 코퍼스 v${dataset.version}, ${dataset.cases.length}개 케이스\n`);

    const summary = runCitationEvaluation(dataset);

    for (const r of summary.results) {
        const cov = r.skipped ? 'SKIP' : (r.coverage !== null ? `${(r.coverage * 100).toFixed(1)}%` : 'N/A');
        const mark = r.passed ? '✅' : '❌';
        console.log(`  ${mark} ${r.caseId.padEnd(28)} coverage=${cov.padStart(6)} invalid=${r.invalidCount}`
            + (r.passed ? '' : `  ← ${r.failureReason}`));
    }

    console.log('\n── 집계 ──');
    console.log(`  측정 케이스 평균 커버리지: ${summary.meanCoverage !== null ? (summary.meanCoverage * 100).toFixed(1) + '%' : 'N/A'}`);
    console.log(`  invalid 인용 보유 비율   : ${summary.invalidRate !== null ? (summary.invalidRate * 100).toFixed(1) + '%' : 'N/A'}`);
    console.log(`  스킵(fallback/빈) 케이스 : ${summary.skippedCount}`);
    console.log(`  회귀 실패                : ${summary.regressionFailures}/${summary.totalCases}`);

    if (summary.regressionFailures > 0) {
        console.error(`\n❌ 인용 평가 회귀 ${summary.regressionFailures}건 — fixture 기대값 불일치`);
        process.exit(1);
    }
    console.log('\n✅ 인용 평가 통과 (회귀 없음)\n');
}

main();
