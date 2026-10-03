/**
 * 에이전트 작업 궤적 과정 검사 CLI.
 *
 *   npm run eval:trajectory                                        # mock(CI Gate 10) — 골든 묶음으로 검사기 자체를 검증
 *   npm run eval:trajectory -- --spec <명세.json> --steps <스텝.json>  # 파일로 내보낸 스텝 기록 한 건을 검사
 *   npm run eval:trajectory -- --spec <명세.json> --task <작업 id>     # DB 의 실제 작업 기록 한 건을 검사(.env 필요)
 *
 * LLM 을 쓰지 않는다. 골든 모드는 DB·.env 도 쓰지 않는다. 실패가 있으면 종료 코드 1.
 *
 * @module evaluation/run-trajectory-evaluation
 */
import * as fs from 'fs';
import * as path from 'path';
import {
    evaluateTrajectory, parseTrajectorySpec, stepsToTrajectory,
    loadTrajectoryGolden, runTrajectoryGolden, type TrajectoryStepRow,
} from './trajectory-evaluator';

function argValue(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

async function loadSteps(): Promise<TrajectoryStepRow[]> {
    const stepsPath = argValue('--steps');
    if (stepsPath) return JSON.parse(fs.readFileSync(stepsPath, 'utf8')) as TrajectoryStepRow[];
    // 실제 작업 기록 — DB 접속 정보는 .env 에서 읽는다.
    require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
    const { getUnifiedDatabase } = await import('../data/models/unified-database');
    const steps = await getUnifiedDatabase().getAgentTaskSteps(argValue('--task') as string);
    return steps as unknown as TrajectoryStepRow[];
}

function runGolden(): boolean {
    const summary = runTrajectoryGolden(loadTrajectoryGolden());
    console.log(`\n궤적 과정 검사 (mock, 검사기 자체 검증) — v${summary.version}: ${summary.passed}/${summary.total}`);
    for (const f of summary.failures) console.log(`  ✗ ${f.id}: ${f.reason}`);
    return summary.failures.length === 0;
}

async function runOne(specPath: string): Promise<boolean> {
    const spec = parseTrajectorySpec(JSON.parse(fs.readFileSync(specPath, 'utf8')));
    const calls = stepsToTrajectory(await loadSteps());
    const result = evaluateTrajectory(spec, calls);
    const mark = { pass: '✓', fail: '✗', skipped: '-' } as const;
    console.log(`\n궤적 과정 검사 — ${result.specId}: 도구 호출 ${calls.length}건, 검사 ${result.checks.length}건`);
    for (const c of result.checks) console.log(`  ${mark[c.status]} [${c.dimension}] ${c.id}: ${c.detail}`);
    if (!result.passed) console.log(`실패한 검사: ${result.rootFailures.join(', ')}`);
    return result.passed;
}

async function main(): Promise<boolean> {
    const specPath = argValue('--spec');
    if (!specPath) return runGolden();
    if (!argValue('--steps') && !argValue('--task')) {
        console.error('사용법: npm run eval:trajectory -- --spec <명세.json> (--steps <스텝.json> | --task <작업 id>)');
        process.exit(2);
    }
    return runOne(specPath);
}

main().then((ok) => {
    console.log(`결과: ${ok ? '통과' : '실패'}`);
    process.exit(ok ? 0 : 1);
}).catch((e) => {
    console.error('[trajectory-evaluation] 실패:', e);
    process.exit(1);
});
