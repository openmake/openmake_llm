/**
 * Agent Task 완료 관문 — 모든 완료 출구가 지나는 단일 판정 지점 (091).
 *
 * 종전엔 completed 로 나가는 출구가 둘이었고 판정 강도가 서로 달랐다:
 *   ① 도구 없는 최종 답변 — 마커 → judge(아티팩트 0 한정) → verify
 *   ② terminate 도구      — **판정 없음**, 아티팩트만 영속하고 즉시 completed
 * 2026-08-09 후향 실측(completed 155건)에서 ②가 22건(14.2%)이고 전부 아티팩트 0,
 * 평균 결과 길이 139자였다. 빈 terminate 로 산출물 없이 completed 되는 것이 라이브에서
 * 재현되기도 했다(2026-08-06). 두 출구를 이 모듈로 모아 같은 관문을 지나게 한다.
 *
 * 판정 순서는 **결정적 검사 → LLM 판정** 이다. 코드가 깨졌으면 목표 달성 여부를 물을 것
 * 없이 자가수정 루프로 돌려보내는 편이 싸고 정확하다(실행 grounding > self-critique).
 *   1. `[GOAL_INCOMPLETE]` 마커(모델 자기신고) → failed(goal_incomplete)
 *   2. deliverable verify(코드 산출물 문법/컴파일) → 실패 시 자가수정 유도로 반환
 *   3. goal judge(LLM 1회) → 미달성 확정 시 failed(goal_incomplete), 판정 실패는 fail-open
 *   4. 아티팩트·코드 diff 영속 → completed
 *
 * judge **적용** 조건(아티팩트 0)은 종전 그대로다. 다만 아티팩트가 있는 완료도 2026-08-27 부터
 * 셰도우로 판정만 돌려 기록한다(`judge_shadow` 스텝) — 확대 여부를 가를 오판율을 재려면
 * 표본이 필요하고, 적용 조건으로는 completed 의 18% 만 판정을 거치기 때문이다. 적용 확대는
 * 그 표본으로 오판율을 재측정한 뒤 결정한다.
 *
 * @module services/agent-task/finalize
 */
import type { getUnifiedDatabase } from '../../data/models/unified-database';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { extractAndStripArtifacts } from '../../llm/artifact-parser';
import { applyReportRender } from '../chat-service/report-block';
import { AGENT_TASK_INCOMPLETE_MARKER, getAgentTaskVerifyFailedNudge } from '../../prompts/agent-task-prompt';
import { judgeGoal, buildJudgeExecutionContext, buildJudgeArtifactSummary } from './goal-judge';
import { verifyCodeArtifacts } from './deliverable-verify';
import { persistArtifactSteps, persistJudgeStep } from './task-steps';
import { maybePersistCodeDiff } from './code-diff';
import { judgeClientFor } from './role-client';
import { createLogger } from '../../utils/logger';
import type { TaskRuntime } from '../task-sandbox/runtime';
import type { TaskSandboxConfig } from '../../config/task-sandbox';

const logger = createLogger('AgentTaskService');

type UnifiedDb = ReturnType<typeof getUnifiedDatabase>;
type AgentTaskUpdatePayload = Parameters<UnifiedDb['updateAgentTask']>[1];

/** 완료 관문을 지난 출구 구분 — 091 관측 컬럼 `agent_tasks.completion_path`. */
export type CompletionPath = 'final_answer' | 'terminate';
/** goal judge 결과 — 091 관측 컬럼 `agent_tasks.judge_verdict`. */
export type JudgeVerdict = 'achieved' | 'not_achieved' | 'unknown' | 'skipped';

export interface FinalizeInput {
    taskId: string;
    goal: string;
    userId: string;
    /** 어느 출구로 도달했는지 — 판정 로직은 동일하고 관측에만 쓰인다. */
    path: CompletionPath;
    /** 모델 최종 응답 원문(아티팩트 추출 전). */
    rawContent: string;
    /** terminate 도구의 summary 인자 — 있으면 결과 본문으로 우선한다. */
    terminateSummary?: string;
    taskRuntime: TaskRuntime | null;
    sandboxCfg: TaskSandboxConfig;
    /** 실행 중 사용한 도구 — judge 실행 컨텍스트. */
    usedTools: ReadonlySet<string>;
    /** 최근 도구 실행 결과 요약(buildJudgeToolEvidence) — judge false negative 완화용 수행 증거. */
    toolEvidence?: string;
    /** 0-base 턴 인덱스. */
    turn: number;
    stepNumber: number;
    /** 지금까지의 verify 자가수정 횟수 — 상한 초과 시 검증을 건너뛴다(무한루프 방지). */
    verifyRetries: number;
    signal: AbortSignal;
    update: (u: AgentTaskUpdatePayload) => Promise<void>;
    emitStep: (stepType: string, toolName?: string, content?: string | null) => void;
}

export type FinalizeOutcome =
    /** 완료 처리까지 끝냈다 — 호출부는 즉시 종료한다. */
    | { kind: 'completed'; stepNumber: number }
    /** 목표 미달성으로 failed 기록까지 끝냈다 — 호출부는 즉시 종료한다. */
    | { kind: 'goal_incomplete'; stepNumber: number }
    /** 산출물 검증 실패 — 호출부가 nudge 를 conversation 에 넣고 루프를 계속한다. */
    | { kind: 'verify_retry'; stepNumber: number; nudge: string };

/**
 * 완료 판정 관문. 상태 갱신(completed/failed)까지 이 함수가 수행하고, 호출부는 반환 kind 로
 * 종료/계속만 결정한다. judge·verify 는 모두 fail-open 이라 판정 인프라 장애가 완료를 막지 않는다.
 */
export async function finalizeTask(input: FinalizeInput): Promise<FinalizeOutcome> {
    const {
        taskId, goal, userId, path, rawContent, terminateSummary,
        taskRuntime, sandboxCfg, usedTools, toolEvidence, turn, signal, update, emitStep,
    } = input;
    let stepNumber = input.stepNumber;

    const extracted = extractAndStripArtifacts(applyReportRender(rawContent ?? ''));
    const artifacts = extracted.artifacts;
    // terminate 는 summary 를 결과 본문으로 우선(도구 인자가 곧 모델의 완료 선언).
    const body = path === 'terminate'
        ? (terminateSummary || extracted.cleanedContent || '작업을 완료했습니다.')
        : extracted.cleanedContent;

    // 1. 목표 미달성 자기신고 — 마커를 뗀 사유를 결과로 남기고 failed 로 종료.
    if (body && body.includes(AGENT_TASK_INCOMPLETE_MARKER)) {
        await update({
            status: 'failed',
            error: 'goal_incomplete',
            result: body.replace(AGENT_TASK_INCOMPLETE_MARKER, '').trim(),
            checkpoint: null,
            completionPath: path,
            judgeVerdict: 'skipped',
        });
        logger.info(`[AgentTask] 목표 미달성 종료: ${taskId} (turn ${turn + 1}, ${path})`);
        return { kind: 'goal_incomplete', stepNumber };
    }

    // 2. 산출물 실행 검증(결정적) — 코드 deliverable 이 컴파일되지 않으면 판정 전에 자가수정.
    if (taskRuntime
        && AGENT_TASK_LIMITS.VERIFY_DELIVERABLE_ENABLED
        && input.verifyRetries < AGENT_TASK_LIMITS.VERIFY_DELIVERABLE_MAX_RETRIES
        && artifacts.length > 0) {
        const verify = await verifyCodeArtifacts(taskRuntime, artifacts, signal);
        if (!verify.ok) {
            logger.info(`[AgentTask] 산출물 검증 실패 → 자가수정 유도: ${taskId} (재시도 ${input.verifyRetries + 1})`);
            return { kind: 'verify_retry', stepNumber, nudge: getAgentTaskVerifyFailedNudge(verify.report) };
        }
    }

    // 3. goal judge — 판정을 **적용**하는 대상은 종전 그대로 아티팩트 없는 완료뿐이다.
    //    아티팩트가 있는 완료도 셰도우로 판정만 돌려 기록한다(완료 흐름 불변, fail-open):
    //    발동 조건 확대의 게이트가 judge 오판율인데, 현행 조건으로는 completed 의 18% 만
    //    판정을 거쳐 잴 표본이 쌓이지 않는다(2026-08-27 실측 30일: 120건 중 achieved 22 ·
    //    skipped 43 · 미판정 55, 그중 34건이 아티팩트 보유로 우회).
    let verdict: JudgeVerdict = 'skipped';
    const judgeApplies = artifacts.length === 0;
    if (AGENT_TASK_LIMITS.GOAL_JUDGE_ENABLED
        && (judgeApplies || AGENT_TASK_LIMITS.GOAL_JUDGE_SHADOW_ENABLED)) {
        const execCtx = buildJudgeExecutionContext(usedTools, turn + 1, taskRuntime?.getPlanSnapshot() ?? [], toolEvidence);
        // 셰도우 경로에선 ANSWER 에서 떨어져 나간 산출물을 함께 싣는다(적용 경로는 아티팩트 0 이라 빈 값).
        const outcome = await judgeGoal(
            await judgeClientFor(userId), goal, body ?? '', signal, execCtx,
            artifacts.length > 0 ? buildJudgeArtifactSummary(artifacts) : undefined);
        const achieved = outcome.achieved;
        const judged: JudgeVerdict = achieved === null ? 'unknown' : achieved ? 'achieved' : 'not_achieved';
        // 판정·사유·입력 요약을 스텝으로 남긴다 — 오판 사후 규명용(관측 전용, fail-open).
        stepNumber = await persistJudgeStep(
            taskId, stepNumber, judged, outcome.reason, outcome.raw, execCtx, { shadow: !judgeApplies });
        emitStep(judgeApplies ? 'judge' : 'judge_shadow', undefined,
            `${judgeApplies ? '' : '[셰도우] '}판정: ${judged}${outcome.reason ? ` — ${outcome.reason}` : ''}`);
        // 셰도우는 여기까지. `judge_verdict` 컬럼은 'skipped' 로 둔다 — 적용된 판정만 담는
        // 컬럼이라, 셰도우 값을 넣으면 not_achieved 인데 completed 인 행이 생겨 기존 집계가
        // 깨진다(셰도우 표본은 step_type='judge_shadow' 로 읽는다).
        if (judgeApplies) {
            verdict = judged;
            if (achieved === false) {
                await update({
                    status: 'failed',
                    error: 'goal_incomplete',
                    result: body,
                    checkpoint: null,
                    completionPath: path,
                    judgeVerdict: verdict,
                });
                logger.info(`[AgentTask] judge 목표 미달성 종료: ${taskId} (turn ${turn + 1}, ${path})`);
                return { kind: 'goal_incomplete', stepNumber };
            }
        }
    }

    // 4. 산출물 영속 후 완료.
    stepNumber = await persistArtifactSteps(taskId, artifacts, stepNumber);
    stepNumber = await maybePersistCodeDiff(taskRuntime, sandboxCfg, taskId, stepNumber, emitStep);
    await update({
        status: 'completed',
        progress: 100,
        result: body,
        // 이전 시도의 실패 사유를 지운다 — resume/재실행으로 완료된 작업에 'aborted'·'goal_incomplete'
        // 가 남아 목록·CLI 가 성공을 실패처럼 보여줬다(2026-08-26 resume E2E 에서 실측).
        error: null,
        checkpoint: null, // 완료 작업은 재개 대상 아님 — checkpoint 잔존 시 resume 허용·저장 팽창
        completionPath: path,
        judgeVerdict: verdict,
    });
    logger.info(`[AgentTask] 완료: ${taskId} (${turn + 1} 턴, ${path}, judge=${verdict}, 아티팩트 ${artifacts.length}개)`);
    return { kind: 'completed', stepNumber };
}
