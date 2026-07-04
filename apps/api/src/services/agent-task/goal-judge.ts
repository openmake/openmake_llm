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
 * 목표 달성 judge — 판정 전용 LLM 1회 호출. true=달성, false=미달성,
 * null=판정 불가(호출 실패/파싱 실패) → 호출자가 fail-open(완료 유지) 처리.
 */
export async function judgeGoalAchieved(
    client: LLMClient,
    goal: string,
    answer: string,
    signal: AbortSignal,
): Promise<boolean | null> {
    try {
        const { system, user } = getAgentTaskGoalJudgeMessages(
            goal,
            answer.slice(0, AGENT_TASK_LIMITS.GOAL_JUDGE_MAX_ANSWER_CHARS),
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
