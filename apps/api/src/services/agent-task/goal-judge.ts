/**
 * Agent Task 목표 달성 judge — AgentTaskService 에서 분리 (파일 크기 가드).
 * @module services/agent-task/goal-judge
 */
import type { LLMClient } from '../../llm';
import { getAgentTaskGoalJudgeMessages } from '../../prompts/agent-task-prompt';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
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
        ...(planSteps.length > 0 && completed > 0
            ? [`계획: ${completed}/${planSteps.length} 단계 완료`]
            : []),
        ...(toolEvidence ? [`최근 도구 실행 결과:\n${toolEvidence}`] : []),
    ].join('\n');
}

/**
 * 목표 달성 judge — 판정 전용 LLM 1회 호출. true=달성, false=미달성,
 * null=판정 불가(호출 실패/파싱 실패) → 호출자가 fail-open(완료 유지) 처리.
 */
export async function judgeGoalAchieved(
    client: LLMClient,
    goal: string,
    answer: string,
    signal: AbortSignal,
    /** 5-3(b): 실행 컨텍스트(계획 상태·사용 도구·턴수) — 판정 정확도 보강. */
    executionContext?: string,
): Promise<boolean | null> {
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
        const m = (r.content ?? '').match(/"achieved"\s*:\s*(true|false)/);
        if (!m) {
            logger.debug(`[AgentTask] judge 응답 파싱 불가 — fail-open: ${(r.content ?? '').slice(0, 200)}`);
            return null;
        }
        return m[1] === 'true';
    } catch (e) {
        logger.warn(`[AgentTask] judge 호출 실패 — fail-open: ${e instanceof Error ? e.message : e}`);
        return null;
    }
}
