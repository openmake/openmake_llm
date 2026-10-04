/**
 * 프롬프트 규칙 제거(ablation) 실험 CLI — real 전용.
 *
 *   npm run eval:ablation                         # golden-agent-tasks.json 의 모든 과제 × 모든 조건 × 1회
 *   npm run eval:ablation -- --repeats 3 --limit 2
 *   npm run eval:ablation -- --variants baseline --only fix-python-bug,edit-notes   # 지목한 과제만(묶음의 순서대로)
 *   npm run eval:agent-tasks                      # 기준 조건만 1회 + 관문(야간 회귀 감시): --variants baseline --gate
 *   npm run eval:agent-tasks:browser              # 브라우저 과제만(browserCases): --variants baseline --browser only
 *
 * --browser 를 주면 브라우저 과제(browserCases)를 묶음 뒤에 더해 돌리고, `--browser only` 면 브라우저 과제만 돌린다.
 * 브라우저 과제는 외부 사이트에 달려 있어 기본 실행(야간 회귀 감시)에는 넣지 않는다. 완료는 작업 상태에 더해
 * 최종 답변에 정답 문자열이 들어 있는지(agent-task-dataset.judgeExpectedAnswer)로 채점한다.
 *
 * 과제마다 조건(variant)별로 에이전트 작업을 실제로 실행한다: 샌드박스에서 실제 모델이 도구를 쓴다.
 * 조건은 시스템 프롬프트에서 지정한 규칙을 뺀 것이다(prompt-ablation.ablatePrompt) — 운영 코드는 바꾸지 않고
 * 이 프로세스 안에서만 프롬프트 함수를 바꿔 끼운다. 결과는 작업 상태·토큰·턴과 궤적 과정 검사(trajectory-evaluator)다.
 *
 * 전제: .env 의 DB·모델 접속 정보, 샌드박스(TASK_SANDBOX_ENABLED=true 와 docker). 승인은 이 실행에 한해 끈다
 * (과제는 네트워크 없는 샌드박스 안에서만 끝난다). 실행 사용자는 OMK_EVAL_ABLATION_USER_ID(기본 관리자 시드 계정).
 * 기본은 관문이 아니다 — 측정값을 logs/ 에 남기고 표로 찍는다. 반복 수가 적으면 차이를 결론으로 읽지 말 것.
 * --gate 를 주면 첫 조건의 완료율·과정 통과율이 임계(OMK_EVAL_AGENT_TASK_COMPLETED_THRESHOLD 기본 0.8,
 * OMK_EVAL_AGENT_TASK_PROCESS_THRESHOLD 기본 0.9) 미만일 때 종료 코드 1.
 *
 * @module evaluation/run-prompt-ablation
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

import { ablatePrompt, summarizeAblation, gateAgentTaskSuite, selectCases, type AblationRun } from './prompt-ablation';
import { judgeExpectedAnswer } from './agent-task-dataset';
import { evaluateTrajectory, parseTrajectorySpec, stepsToTrajectory, type TrajectorySpec, type TrajectoryStepRow } from './trajectory-evaluator';

interface AblationCase {
    id: string; goal: string; maxTurns: number; spec: TrajectorySpec;
    files?: Array<{ name: string; type?: string; content: string }>;
    /** 브라우저 과제만 — 최종 답변에 모두 들어 있어야 하는 정답 문자열. */
    expectedAnswer?: { includes: string[] };
}

interface AblationDataset {
    version: string;
    variants: Array<{ id: string; dropRules: string[] }>;
    cases: AblationCase[];
    browserCases?: AblationCase[];
}

const LOGS_DIR = path.join(__dirname, '../../logs');
const DEFAULT_USER_ID = 'admin-default-001';
const COMPLETED_THRESHOLD_DEFAULT = 0.8;
const PROCESS_THRESHOLD_DEFAULT = 0.9;

function argValue(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
    // 실행 소유권 이름을 서버와 다르게 잡는다 — 같은 호스트의 서버·다른 평가 실행이 부팅 정리로 서로의 실행 중 작업을 failed 로 바꾸지 않게(config/lease-owner).
    process.env.OMK_LEASE_INSTANCE ??= `eval-${process.pid}`;
    const dataset = JSON.parse(fs.readFileSync(argValue('--dataset') ?? path.resolve(__dirname, 'golden-agent-tasks.json'), 'utf8')) as AblationDataset;
    const repeats = Number(argValue('--repeats') ?? '1');
    const limit = argValue('--limit');
    const browser = process.argv.includes('--browser');
    if (browser && !dataset.browserCases?.length) throw new Error('--browser: 과제 묶음에 browserCases 가 없습니다');
    const pool = !browser ? dataset.cases : argValue('--browser') === 'only' ? dataset.browserCases ?? [] : [...dataset.cases, ...(dataset.browserCases ?? [])];
    const cases = selectCases(pool, { only: argValue('--only')?.split(',').map((x) => x.trim()).filter(Boolean), ...(limit !== undefined ? { limit: Number(limit) } : {}) });
    for (const c of cases) parseTrajectorySpec(c.spec);
    const only = argValue('--variants')?.split(',');
    if (only) dataset.variants = dataset.variants.filter((v) => only.includes(v.id));
    if (dataset.variants.length === 0) throw new Error(`--variants 에 맞는 조건이 없습니다: ${only?.join(',')}`);
    const userId = process.env.OMK_EVAL_ABLATION_USER_ID ?? DEFAULT_USER_ID;

    // 프롬프트 모듈의 함수를 이 프로세스 안에서만 바꿔 끼운다(운영 코드 불변). 조건마다 dropRules 를 갈아 끼운다.
    const promptModule = require('../prompts/agent-task-prompt') as { getAgentTaskSystemPrompt: () => string };
    const original = promptModule.getAgentTaskSystemPrompt;
    let dropRules: string[] = [];
    promptModule.getAgentTaskSystemPrompt = () => ablatePrompt(original(), dropRules);
    for (const v of dataset.variants) ablatePrompt(original(), v.dropRules); // 패턴 오타는 실행 전에 걸러낸다

    const { getUnifiedDatabase } = await import('../data/models/unified-database');
    const { AgentTaskService } = await import('../services/AgentTaskService');
    const db = getUnifiedDatabase();
    // 스키마 초기화의 좀비 정리(running → failed 'server restarted')가 끝난 뒤에 첫 과제를 시작한다 —
    // 기다리지 않으면 방금 running 이 된 첫 과제가 정리 대상이 되어 완료 기록이 거부된다.
    await db.ensureReady();
    const runs: AblationRun[] = [];

    for (let rep = 0; rep < repeats; rep++) {
        for (const c of cases) {
            for (const v of dataset.variants) {
                dropRules = v.dropRules;
                const taskId = randomUUID();
                const started = Date.now();
                await db.createAgentTask({ id: taskId, userId, goal: c.goal, maxTurns: c.maxTurns });
                try {
                    await new AgentTaskService().execute({ taskId, goal: c.goal, userId, userRole: 'admin', maxTurns: c.maxTurns, approvalPolicy: 'none', ...(c.files ? { files: c.files } : {}) });
                } catch (e) {
                    console.error(`  ! ${c.id}/${v.id} 실행 오류: ${e instanceof Error ? e.message : e}`);
                }
                const task = await db.getAgentTask(taskId);
                const calls = stepsToTrajectory((await db.getAgentTaskSteps(taskId)) as unknown as TrajectoryStepRow[]);
                const check = evaluateTrajectory(c.spec, calls);
                const run: AblationRun = {
                    variant: v.id, caseId: c.id, taskId, status: String(task?.status ?? 'unknown'),
                    processPassed: check.passed, rootFailures: check.rootFailures,
                    turns: Number(task?.current_turn ?? 0), totalTokens: Number(task?.total_tokens ?? 0),
                    toolCalls: calls.length, durationMs: Date.now() - started,
                    ...(c.expectedAnswer ? {
                        answerPassed: judgeExpectedAnswer(c.expectedAnswer, typeof task?.result === 'string' ? task.result : null),
                        browserCalls: calls.filter((x) => x.name === 'browser').length,
                    } : {}),
                };
                runs.push(run);
                console.log(`  ${c.id} / ${v.id}: ${run.status}, 과정 ${run.processPassed ? '통과' : `실패(${run.rootFailures.join(', ')})`}, `
                    + `${run.turns}턴, ${run.totalTokens}토큰, 도구 ${run.toolCalls}회, ${(run.durationMs / 1000).toFixed(0)}초`
                    + (run.answerPassed === undefined ? '' : `, 정답 ${run.answerPassed ? '일치' : '불일치'}, 브라우저 ${run.browserCalls}회`));
            }
        }
    }

    const summary = summarizeAblation(runs);
    console.log(`\n프롬프트 규칙 제거 실험 — v${dataset.version}, 과제 ${cases.length}개 × 조건 ${dataset.variants.length}개 × ${repeats}회`);
    for (const s of summary) {
        console.log(`  ${s.variant}: 완료 ${(s.completedRate * 100).toFixed(0)}% · 과정 통과 ${(s.processPassRate * 100).toFixed(0)}% · `
            + `평균 ${Math.round(s.meanTokens)}토큰 · ${s.meanTurns.toFixed(1)}턴 · 도구 ${s.meanToolCalls.toFixed(1)}회 (n=${s.runs})`);
    }
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    const out = path.join(LOGS_DIR, `prompt-ablation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(out, JSON.stringify({ datasetVersion: dataset.version, repeats, model: process.env.LLM_DEFAULT_MODEL ?? null, summary, runs }, null, 2));
    console.log(`→ ${path.relative(process.cwd(), out)}`);
    if (process.argv.includes('--gate')) {
        const gate = gateAgentTaskSuite(summary, {
            completed: Number(process.env.OMK_EVAL_AGENT_TASK_COMPLETED_THRESHOLD ?? COMPLETED_THRESHOLD_DEFAULT),
            process: Number(process.env.OMK_EVAL_AGENT_TASK_PROCESS_THRESHOLD ?? PROCESS_THRESHOLD_DEFAULT),
        });
        for (const r of runs.filter((x) => x.status !== 'completed' || !x.processPassed || x.answerPassed === false)) {
            console.log(`  ✗ ${r.caseId}: ${r.status}${r.processPassed ? '' : `, 과정 실패(${r.rootFailures.join(', ')})`}${r.answerPassed === false ? ', 정답 불일치' : ''} — 작업 ${r.taskId}`);
        }
        console.log(`결과: ${gate.ok ? '통과' : `실패 (${gate.failures.join('; ')})`}`);
        if (!gate.ok) process.exit(1);
    }
}

main().then(() => process.exit(0)).catch((e) => {
    console.error('[prompt-ablation] 실패:', e);
    process.exit(1);
});
