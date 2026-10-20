/**
 * Agent Task 목표 달성 judge — AgentTaskService 에서 분리 (파일 크기 가드).
 * @module services/agent-task/goal-judge
 */
import type { LLMClient } from '../../llm';
import { getAgentTaskGoalJudgeMessages, getUserRejectionsJudgeNote, getWorkspaceJudgeNote } from '../../prompts/agent-task-prompt';
import { AGENT_TASK_LIMITS, JUDGE_EVIDENCE_EXCLUDED_TOOLS } from '../../config/runtime-limits';
import { createLogger } from '../../utils/logger';
import { CONTEXT_HANDOFF, TOOL_DIGEST } from '../../config/agent-task-context';
import { handoffToolCallLines } from './context-handoff';
import { findToolCallArgs } from './tool-digest';
import type { ChatMessage } from '../../llm/types';

const logger = createLogger('AgentTaskService');

/**
 * judge 에 실을 최근 도구 결과 증거 렌더 — 대화에서 tool 메시지 최근 N개를 한 줄씩 요약한다.
 * 완수한 작업의 짧은 완료 보고를 judge 가 근거 부족으로 미달성 판정하던 false negative
 * (실측 2회) 완화: 도구 결과 자체가 "실제로 수행했다"는 증거다.
 */
export function buildJudgeToolEvidence(
    conversation: ReadonlyArray<{ role: string; content?: string | null; tool_name?: string; tool_call_id?: string; tool_calls?: ChatMessage['tool_calls'] }>,
): string {
    const items = conversation
        .flatMap((m, index) => {
            if (m.role === 'user' && typeof m.content === 'string') {
                return handoffToolCallLines(m.content).map((line) => `- ${line.slice(0, AGENT_TASK_LIMITS.GOAL_JUDGE_EVIDENCE_ITEM_CHARS)}`);
            }
            if (m.role !== 'tool' || typeof m.content !== 'string' || !m.content.trim()) return [];
            // terminate·plan 결과가 실제 파일 목록·검증 로그를 증거 창에서 밀어내지 않게 한다.
            if (JUDGE_EVIDENCE_EXCLUDED_TOOLS.has(m.tool_name ?? '') || m.content.startsWith('__TASK_TERMINATE__')) return [];
            const args = TOOL_DIGEST.FILE_TOOLS.includes(m.tool_name ?? '') ? findToolCallArgs(conversation, index) : undefined;
            const operation = args ? `${String(args.command ?? args.op ?? '')} ${String(args.path ?? '')}`.trim() : '';
            const subject = operation ? ` [${operation}]` : '';
            const oneLine = `${subject}: ${m.content.replace(/\s+/g, ' ').trim()}`
                .slice(0, AGENT_TASK_LIMITS.GOAL_JUDGE_EVIDENCE_ITEM_CHARS);
            return [`- ${m.tool_name || '(도구)'}${oneLine}`];
        })
        .slice(-AGENT_TASK_LIMITS.GOAL_JUDGE_EVIDENCE_MAX_ITEMS);
    return items.join('\n');
}

/** 실제 파일 목록. 일부만 실린 목록은 빠진 파일이 없다는 증거로 쓰지 않는다. */
export function withWorkspaceJudgeNote(context: string, files: readonly string[]): string {
    const shown = files.slice(0, CONTEXT_HANDOFF.MAX_FILES);
    const listing = shown.map((file) => JSON.stringify(file)).join('\n');
    const clipped = listing.slice(0, CONTEXT_HANDOFF.SUMMARY_MAX_CHARS);
    const truncated = shown.length < files.length || clipped.length < listing.length;
    return `${context}\n\n${getWorkspaceJudgeNote(clipped, files.length, truncated)}`;
}

/**
 * judge 에 실을 **제출 산출물** 렌더 — 종류·제목·본문 앞부분.
 *
 * `finalize` 가 judge 에 넘기는 ANSWER 는 `extractAndStripArtifacts` 를 거친 본문이라
 * 아티팩트가 **떨어져 나가 있다**. 발동 조건이 아티팩트 0 이던 동안엔 실을 것이 없어 문제가
 * 드러나지 않았지만, 셰도우 확대(2026-08-27) 첫 표본이 바로 이 갭에 걸렸다 — 코드 아티팩트를
 * 정상 제출한 작업에 judge 가 "실제 코드가 제출되지 않고 아티팩트 참조만 있습니다"로
 * 미달성 판정했다(본문은 artifact 스텝에 멀쩡히 있었다). 산출물을 못 보고 내리는 판정은
 * 표본으로 쓸 수 없으므로 여기서 함께 싣는다.
 */
export function buildJudgeArtifactSummary(
    artifacts: ReadonlyArray<{ kind: string; title: string; lang: string | null; content: string }>,
): string {
    return artifacts
        .slice(0, AGENT_TASK_LIMITS.GOAL_JUDGE_ARTIFACT_MAX_ITEMS)
        .map((a, i) => {
            const head = a.content.trim().slice(0, AGENT_TASK_LIMITS.GOAL_JUDGE_ARTIFACT_ITEM_CHARS);
            const type = a.lang ? `${a.kind}/${a.lang}` : a.kind;
            return `${i + 1}. [${type}] ${a.title || '(제목 없음)'}\n${head}`;
        })
        .join('\n\n');
}

/** 5-3(b): judge 에 제공할 실행 컨텍스트(수행 흔적) 렌더 — 사용 도구·턴수·계획 상태·도구 결과. */
export function buildJudgeExecutionContext(
    usedTools: ReadonlySet<string>,
    turnCount: number,
    planSteps: ReadonlyArray<{ status: string; text?: string; doneWhen?: string }>,
    toolEvidence?: string,
): string {
    const completed = planSteps.filter((s) => s.status === 'completed').length;
    // 노드별 완료 기준(Execution Graph 증분 4) — 기준이 있는 노드만 싣는다. 상태 마킹은 누락이 잦아(60%)
    // 근거로 쓰지 않지만, 기준 자체는 모델이 스스로 적은 검증 조건이라 EXECUTION 과 대조할 가치가 있다.
    const criteria = planSteps
        .map((s, i) => (s.doneWhen ? `${i + 1}. ${s.text ?? ''} — 완료 기준: ${s.doneWhen}` : null))
        .filter((l): l is string => l !== null);
    return [
        `사용 도구: ${usedTools.size > 0 ? [...usedTools].join(', ') : '(없음 — 도구 미사용)'}`,
        `턴 수: ${turnCount}`,
        // 계획 완료 수는 완료>0 일 때만 싣는다(긍정 증거 전용). 모델이 완료 마킹을 자주
        // 생략(실측 ~60%)해 "0/N 완료"가 미달성의 거짓 근거로 작동했다(2026-08-15 실측).
        // 전부 완료일 때만 싣는다(긍정 증거 전용). "0/N" 은 물론 "1/7" 도 마킹 누락 탓에
        // 미달성의 거짓 근거로 작동했다(2026-08-15, 2026-08-19/25 실측).
        ...(planSteps.length > 0 && completed === planSteps.length
            ? [`계획: ${completed}/${planSteps.length} 단계 완료`]
            : []),
        ...(criteria.length > 0 ? [`계획 노드 완료 기준(DONE_WHEN):\n${criteria.join('\n')}`] : []),
        ...(toolEvidence ? [`최근 도구 실행 결과:\n${toolEvidence}`] : []),
    ].join('\n');
}

/** 작업에서 사용자가 거절한 승인 한 건 — agent_task_approvals(status='rejected') 행. */
export interface JudgeUserRejection {
    tool_name: string;
    args: Record<string, unknown> | null;
    answer_text: string | null;
}

/**
 * 완료 판정의 수행 맥락(EXECUTION)에 사용자가 거절한 동작 절을 붙인다 — 거절이 있을 때만(withSandboxUnavailableJudgeNote 와 같은 방식).
 * 거절 0건이면 execCtx 를 그대로 돌려준다.
 */
export function withUserRejectionsJudgeNote(execCtx: string, rejections: ReadonlyArray<JudgeUserRejection>): string {
    if (rejections.length === 0) return execCtx;
    const items = rejections.slice(0, AGENT_TASK_LIMITS.GOAL_JUDGE_REJECTION_MAX_ITEMS).map((r) => ({
        toolName: r.tool_name,
        args: JSON.stringify(r.args ?? {}).replace(/\s+/g, ' ').slice(0, AGENT_TASK_LIMITS.GOAL_JUDGE_REJECTION_ARGS_CHARS),
        reason: (r.answer_text ?? '').replace(/\s+/g, ' ').trim().slice(0, AGENT_TASK_LIMITS.GOAL_JUDGE_REJECTION_REASON_CHARS),
    }));
    return `${execCtx}\n${getUserRejectionsJudgeNote(items)}`;
}

/**
 * 목표 달성 judge — 판정 전용 LLM 1회 호출. true=달성, false=미달성,
 * null=판정 불가(호출 실패/파싱 실패) → 호출자가 fail-open(완료 유지) 처리.
 */
/** judge 판정 + 사유. `achieved: null` 은 판정 불가(fail-open). `raw` 는 파싱 실패 규명용 응답 앞부분 */
interface JudgeOutcome { achieved: boolean | null; reason: string; raw: string }

/**
 * judge 호출 — 판정과 **사유를 함께** 돌려준다.
 * 종전엔 `"achieved"` 만 정규식으로 뽑고 사유를 버려, 오판이 나도 사후 규명이 불가능했다
 * (judge_verdict 컬럼엔 라벨만 남음). 호출부는 사유를 스텝으로 영속한다.
 */
export async function judgeGoal(
    client: LLMClient,
    goal: string,
    answer: string,
    signal: AbortSignal,
    executionContext?: string,
    /** 제출 산출물 렌더(buildJudgeArtifactSummary) — ANSWER 에서 떨어져 나간 아티팩트를 되돌려준다. */
    artifactSummary?: string,
): Promise<JudgeOutcome> {
    try {
        const { system, user } = getAgentTaskGoalJudgeMessages(
            goal,
            answer.slice(0, AGENT_TASK_LIMITS.GOAL_JUDGE_MAX_ANSWER_CHARS),
            executionContext,
            artifactSummary,
        );
        const r = await client.chat(
            [{ role: 'system', content: system }, { role: 'user', content: user }],
            undefined, undefined, { think: false, signal },
        );
        const content = r.content ?? '';
        const raw = content.slice(0, AGENT_TASK_LIMITS.GOAL_JUDGE_RAW_KEEP_CHARS);
        const m = content.match(/"achieved"\s*:\s*(true|false)/);
        const reasonMatch = content.match(/"reason"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        const reason = reasonMatch ? reasonMatch[1].replace(/\\"/g, '"').slice(0, AGENT_TASK_LIMITS.GOAL_JUDGE_REASON_MAX_CHARS) : '';
        if (!m) {
            logger.debug(`[AgentTask] judge 응답 파싱 불가 — fail-open: ${raw.slice(0, 200)}`);
            return { achieved: null, reason, raw };
        }
        return { achieved: m[1] === 'true', reason, raw };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`[AgentTask] judge 호출 실패 — fail-open: ${msg}`);
        return { achieved: null, reason: '', raw: `error: ${msg.slice(0, 200)}` };
    }
}

/** 호환 래퍼 — 판정 결과만. 신규 호출부는 judgeGoal 을 쓴다. */
export async function judgeGoalAchieved(
    client: LLMClient,
    goal: string,
    answer: string,
    signal: AbortSignal,
    executionContext?: string,
): Promise<boolean | null> {
    return (await judgeGoal(client, goal, answer, signal, executionContext)).achieved;
}
