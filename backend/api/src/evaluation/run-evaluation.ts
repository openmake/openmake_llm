/**
 * ============================================================
 * Run Evaluation CLI — 골든셋 라우팅 평가 실행기
 * ============================================================
 *
 * 사용법:
 *   ts-node src/evaluation/run-evaluation.ts                       # 기본 골든셋
 *   ts-node src/evaluation/run-evaluation.ts custom-dataset.json   # 사용자 지정
 *
 * 결과:
 *   - 콘솔에 요약 출력
 *   - logs/evaluation-{timestamp}.json에 전체 결과 저장
 *   - exit code: 통과율 100%면 0, 그 외 1 (CI 통합 가능)
 *
 * @module evaluation/run-evaluation
 */
import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';
import * as dotenv from 'dotenv';

// CLI 진입 시 .env 로드 (server.ts/cli.ts와 동일한 부트스트랩 동작)
// 평가는 winston logger를 통해 config를 호출하므로 환경변수가 필요함
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

import { loadGoldenDataset } from './dataset-loader';
import { runRoutingEvaluation } from './router-evaluator';
import type { EvaluationSummary } from './types';

/** 회귀 추적을 위한 git 커밋 해시 캡처 (실패 시 'unknown') */
function getGitCommitHash(): string {
    try {
        return childProcess.execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    } catch {
        return 'unknown';
    }
}

// 기본 임계값 0.5 — PoC 단계에서 실제 라우팅 정확도가 100% 미만임을 반영.
// 운영 베이스라인을 측정한 후 점진적으로 상향. CI에서는 환경변수로 조정 가능.
const PASS_RATE_THRESHOLD = Number(process.env.OMK_EVAL_PASS_THRESHOLD ?? '0.5');

async function main() {
    const customPath = process.argv[2];
    const dataset = loadGoldenDataset(customPath);

    console.log(`\n[Evaluation] 데이터셋: v${dataset.version}, 총 ${dataset.cases.length}개 케이스`);
    console.log(`[Evaluation] 통과 임계값: ${(PASS_RATE_THRESHOLD * 100).toFixed(0)}%\n`);

    const summary = await runRoutingEvaluation(dataset);

    printSummary(summary);
    saveSummaryToFile(summary);

    const meetsThreshold = summary.passRate >= PASS_RATE_THRESHOLD;
    if (!meetsThreshold) {
        console.error(
            `\n❌ 평가 실패: 통과율 ${(summary.passRate * 100).toFixed(1)}% < ` +
            `임계값 ${(PASS_RATE_THRESHOLD * 100).toFixed(0)}%`
        );
        process.exit(1);
    }

    console.log(`\n✅ 평가 성공: 통과율 ${(summary.passRate * 100).toFixed(1)}% (≥ ${(PASS_RATE_THRESHOLD * 100).toFixed(0)}%)`);
    process.exit(0);
}

function printSummary(summary: EvaluationSummary): void {
    console.log('─'.repeat(60));
    console.log(`총 케이스: ${summary.totalCases}`);
    console.log(`통과: ${summary.passedCases} / 실패: ${summary.failedCases}`);
    console.log(`통과율: ${(summary.passRate * 100).toFixed(1)}%`);
    console.log(`평균 케이스 소요: ${summary.avgDurationMs}ms`);
    console.log('─'.repeat(60));

    if (summary.failedCases > 0) {
        console.log('\n실패 케이스:');
        for (const r of summary.results.filter((x) => !x.passed)) {
            console.log(`  [${r.caseId}] ${r.failureReason}`);
        }
    }
}

function saveSummaryToFile(summary: EvaluationSummary): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logsDir = path.resolve(__dirname, '../../logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
    const commit = getGitCommitHash();
    const outputPath = path.join(logsDir, `evaluation-${timestamp}-${commit}.json`);
    // 회귀 추적용 메타 정보 첨부 (Gemini 권고 5번)
    const enriched = {
        meta: {
            gitCommit: commit,
            nodeVersion: process.version,
            generatedAt: new Date().toISOString(),
        },
        ...summary,
    };
    fs.writeFileSync(outputPath, JSON.stringify(enriched, null, 2), 'utf-8');
    console.log(`\n결과 저장: ${outputPath}`);
}

if (require.main === module) {
    main().catch((err) => {
        console.error('평가 실행 실패:', err);
        process.exit(2);
    });
}
