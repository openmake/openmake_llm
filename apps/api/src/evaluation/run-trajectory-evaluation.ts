/**
 * 에이전트 작업 궤적 과정 검사 CLI.
 *
 *   npm run eval:trajectory -- --spec <명세.json> --steps <스텝.json>
 *
 * 스텝 파일은 agent_task_steps 행의 JSON 배열이다(step_number·step_type·tool_name·tool_args).
 * LLM·DB 를 쓰지 않는다 — 한 작업의 스텝 기록을 명세와 대조해 차원별 결과를 찍고, 실패가 있으면 종료 코드 1.
 *
 * @module evaluation/run-trajectory-evaluation
 */
import * as fs from 'fs';
import { evaluateTrajectory, parseTrajectorySpec, stepsToTrajectory, type TrajectoryStepRow } from './trajectory-evaluator';

function argValue(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
    const specPath = argValue('--spec');
    const stepsPath = argValue('--steps');
    if (!specPath || !stepsPath) {
        console.error('사용법: npm run eval:trajectory -- --spec <명세.json> --steps <스텝.json>');
        process.exit(2);
    }
    const spec = parseTrajectorySpec(JSON.parse(fs.readFileSync(specPath, 'utf8')));
    const steps = JSON.parse(fs.readFileSync(stepsPath, 'utf8')) as TrajectoryStepRow[];
    const calls = stepsToTrajectory(steps);
    const result = evaluateTrajectory(spec, calls);

    const mark = { pass: '✓', fail: '✗', skipped: '-' } as const;
    console.log(`\n궤적 과정 검사 — ${result.specId}: 도구 호출 ${calls.length}건, 검사 ${result.checks.length}건`);
    for (const c of result.checks) console.log(`  ${mark[c.status]} [${c.dimension}] ${c.id}: ${c.detail}`);
    console.log(`결과: ${result.passed ? '통과' : `실패 (${result.rootFailures.join(', ')})`}`);
    if (!result.passed) process.exit(1);
}

main();
