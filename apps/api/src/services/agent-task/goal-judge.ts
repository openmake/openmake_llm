/**
 * Agent Task 목표 달성 judge — AgentTaskService 에서 분리 (파일 크기 가드).
 * @module services/agent-task/goal-judge
 */
import type { LLMClient } from '../../llm';
import { getAgentTaskGoalJudgeMessages } from '../../prompts/agent-task-prompt';
import { AGENT_TASK_LIMITS, JUDGE_EVIDENCE_EXCLUDED_TOOLS } from '../../config/runtime-limits';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskService');

/**
 * judge 에 실을 최근 도구 결과 증거 렌더 — 대화에서 tool 메시지 최근 N개를 한 줄씩 요약한다.
 * 완수한 작업의 짧은 완료 보고를 judge 가 근거 부족으로 미달성 판정하던 false negative
 * (실측 2회) 완화: 도구 결과 자체가 "실제로 수행했다"는 증거다.
 */
export function buildJudgeToolEvidence(
    conversation: ReadonlyArray<{ role: string; content?: string | null; tool_name?: string }>,
): string {
    const items = conversation
        .filter((m) => m.role === 'tool' && typeof m.content === 'string' && m.content.trim().length > 0)
        // terminate 결과는 곧 ANSWER 이고 plan_* 결과는 계획 스냅샷과 중복이다 — 마지막 N개 창에서
        // 이 둘이 자리를 차지하면 실제 수행 증거(파일 목록·렌더 검증 로그)가 밀려난다(2026-08-19 81b954b7,
        // 2026-08-25 4185ca15 오판의 직접 원인). 증거 창은 실행 도구 결과만으로 채운다.
        .filter((m) => !JUDGE_EVIDENCE_EXCLUDED_TOOLS.has(m.tool_name ?? '') && !(m.content as string).startsWith('__TASK_TERMINATE__'))
        .slice(-AGENT_TASK_LIMITS.GOAL_JUDGE_EVIDENCE_MAX_ITEMS)
        .map((m) => {
            const oneLine = (m.content as string).replace(/\s+/g, ' ').trim()
                .slice(0, AGENT_TASK_LIMITS.GOAL_JUDGE_EVIDENCE_ITEM_CHARS);
            return `- ${m.tool_name || '(도구)'}: ${oneLine}`;
        });
    return items.join('\n');
}

/** 5-3(b): judge 에 제공할 실행 컨텍스트(수행 흔적) 렌더 — 사용 도구·턴수·계획 상태·도구 결과. */
export function buildJudgeExecutionContext(
    usedTools: ReadonlySet<string>,
    turnCount: number,
    planSteps: ReadonlyArray<{ status: string }>,
    toolEvidence?: string,
): string {
    const completed = planSteps.filter((s) => s.status === 'completed').length;
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
        ...(toolEvidence ? [`최근 도구 실행 결과:\n${toolEvidence}`] : []),
    ].join('\n');
}

/**
 * 목표 달성 judge — 판정 전용 LLM 1회 호출. true=달성, false=미달성,
 * null=판정 불가(호출 실패/파싱 실패) → 호출자가 fail-open(완료 유지) 처리.
 */
/** judge 판정 + 사유. `achieved: null` 은 판정 불가(fail-open). `raw` 는 파싱 실패 규명용 응답 앞부분 */
export interface JudgeOutcome { achieved: boolean | null; reason: string; raw: string }

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
): Promise<JudgeOutcome> {
    try {
        const { system, user } = getAgentTaskGoalJudgeMessages(
            goal,
            answer.slice(0, AGENT_TASK_LIMITS.GOAL_JUDGE_MAX_ANSWER_CHARS),
            executionContext,
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
