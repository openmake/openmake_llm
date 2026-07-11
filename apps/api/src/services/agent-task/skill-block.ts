/**
 * Agent Task 스킬 프롬프트 블록 — AgentTaskService 에서 분리 (파일 크기 가드).
 * @module services/agent-task/skill-block
 */
import { getSkillManager } from '../../agents/skill-manager';
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
