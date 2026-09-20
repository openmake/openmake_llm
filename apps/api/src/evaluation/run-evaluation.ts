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
import { buildEvalRunRecord, currentGitHash, recordEvalRuns } from './eval-run-recorder';
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

// 기본 임계값 0.9 — 라우터 백로그 해소(2026-09-02: 키워드 70개 보강 + 짜줘 패턴 협소화)로
// v0.8.2 실측 baseline 100%(120/120) − 여유폭(향후 키워드/에이전트 변경 드리프트 허용).
// 라우터는 결정적이라 통과율은 키워드/에이전트 변경 시에만 움직인다 — 0.9 미만 = 실제 회귀.
// (이력: 0.5 = PoC 30케이스 / 0.7 = v0.8.0 baseline 77.5% 시절.)
const PASS_RATE_THRESHOLD = Number(process.env.OMK_EVAL_PASS_THRESHOLD ?? '0.9');

async function main() {
    const customPath = process.argv[2];
    const dataset = loadGoldenDataset(customPath);

    console.log(`\n[Evaluation] 데이터셋: v${dataset.version}, 총 ${dataset.cases.length}개 케이스`);
    console.log(`[Evaluation] 통과 임계값: ${(PASS_RATE_THRESHOLD * 100).toFixed(0)}%\n`);

    // 라우팅 케이스는 에이전트를 가진 팩이 소유한다(addon-host/pack-evals). 0건을 두 경우로 가른다 —
    // eval 을 선언한 팩이 없으면 라우팅할 에이전트도 없으니 건너뛰고, 선언했는데 0건이면 읽기 실패라 실패로 끝낸다.
    if (!customPath && !dataset.cases.some((c) => c.category === 'routing-accuracy')) {
        const { addonsDeclaringEvals } = await import('../addon-host/pack-evals');
        const declaring = addonsDeclaringEvals();
        if (declaring.length === 0) {
            console.log('[Evaluation] 라우팅 케이스를 가진 add-on 이 켜져 있지 않습니다 — 건너뜀');
            process.exit(0);
        }
        console.error(`\n❌ 평가 실패: ${declaring.join(', ')} 이(가) eval 세트를 선언했는데 라우팅 케이스가 0건입니다 — 팩 evals.json 읽기 실패를 확인하세요`);
        process.exit(1);
    }

    const summary = await runRoutingEvaluation(dataset);

    printSummary(summary);
    saveSummaryToFile(summary);
    // eval_runs 이력(146) — OMK_EVAL_RECORD_DB=true(nightly) 일 때만
    await recordEvalRuns([buildEvalRunRecord(summary, { runner: 'routing', mode: 'mock', gitHash: currentGitHash() })]);

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
