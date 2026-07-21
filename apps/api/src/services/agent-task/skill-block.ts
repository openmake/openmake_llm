/**
 * Agent Task 스킬 프롬프트 블록 — AgentTaskService 에서 분리 (파일 크기 가드).
 * @module services/agent-task/skill-block
 */
import { getSkillManager } from '../../agents/skill-manager';
import { getAgentTaskSystemPrompt } from '../../prompts/agent-task-prompt';
import { buildLearningBlock } from './task-learning';
import { buildProceduralSkillBlock } from './procedural-skill';
import { buildUserMemoryBlock } from '../chat-service/user-context-blocks';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskService');

/**
 * Agent Task 는 페르소나/산업 agent 를 우회하므로 고유 agentId 가 없다.
 * 스킬 스코프 조회 시 어떤 실제 agent_id(산업 agent id · uuid · __global__ · user:*)
 * 와도 겹치지 않는 sentinel 을 넘겨, __global__ + user:{userId} 스킬만 매칭시킨다.
 */
export const AGENT_TASK_SKILL_AGENT_ID = '__agent_task__';

/**
 * 활성 스킬(global + user)의 prompt_md 지식 블록을 만든다.
 * execute 의 status 머신(try)이 켜지기 전에 호출되므로 절대 throw 하지 않는다 —
 * 실패/부재 시 '' 를 반환해 task row 가 stuck 되지 않게 한다.
 */
export async function buildSkillPromptBlock(userId: string): Promise<string> {
    try {
        const block = await getSkillManager().buildManifestPrompt(AGENT_TASK_SKILL_AGENT_ID, userId);
        return block ?? '';
    } catch (e) {
        logger.debug('[AgentTask] 스킬 프롬프트 주입 실패 — 무시', e);
        return '';
    }
}

/**
 * 신규 task 의 system 메시지 콘텐츠 조립 — 기본 프롬프트 + 3-tier 메모리:
 * semantic(user_memories, #3) · procedural(스킬 지식·재사용 절차 #1) · episodic(크로스-task 학습).
 * 각 블록은 실패 시 '' 라 조립을 막지 않는다. (resume 은 old system 유지)
 */
export async function buildAgentTaskSystemContent(userId: string, goal: string, taskId: string): Promise<string> {
    const memory = userId && userId !== 'guest' ? await buildUserMemoryBlock(userId) : '';
    return getAgentTaskSystemPrompt()
        + memory
        + (await buildSkillPromptBlock(userId))
        + (await buildLearningBlock(userId, goal, taskId))
        + (await buildProceduralSkillBlock(userId, goal));
}
