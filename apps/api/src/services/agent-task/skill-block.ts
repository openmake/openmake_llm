/**
 * Agent Task 스킬 프롬프트 블록 — AgentTaskService 에서 분리 (파일 크기 가드).
 * @module services/agent-task/skill-block
 */
import { getSkillManager, type ActiveSkillBinding } from '../../agents/skill-manager';
import type { ToolDefinition } from '../../llm/types';
import { mergeToolsWithSkills } from '../chat-service/tool-merger';
import { getAgentTaskSystemPrompt } from '../../prompts/agent-task-prompt';
import { getReportGuideForTask } from '../../prompts/report-guide';
import { REPORT_PIPELINE, REPORT_INTENT_PATTERNS } from '../../config/runtime-limits';
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
    // 보고서 파이프라인 (P1 Phase 2): goal 이 보고서 의도면 reportdata 계약 가이드를 주입한다.
    // 최종 답변의 reportdata 블록은 AgentTaskService 가 applyReportRender 로 렌더해 아티팩트화.
    const reportGuide = REPORT_PIPELINE.ENABLED && REPORT_INTENT_PATTERNS.some((re) => re.test(goal))
        ? getReportGuideForTask(/[가-힣]/.test(goal) ? 'ko' : 'en')
        : '';
    if (reportGuide) logger.info(`[AgentTask] 보고서 의도 goal — reportdata 계약 가이드 주입: ${taskId}`);
    return getAgentTaskSystemPrompt()
        + reportGuide
        + memory
        + (await buildSkillPromptBlock(userId))
        + (await buildLearningBlock(userId, goal, taskId))
        + (await buildProceduralSkillBlock(userId, goal));
}

/**
 * 활성 스킬 바인딩 해석 + 도구 머지 — AgentTaskService 에서 이동 (파일 크기 가드).
 *
 * base 가 전체 도구라 바인딩의 실효는 사실상 denied(특정 도구 차단)뿐이다.
 * 조회 실패는 작업을 실패시키지 않고 빈 바인딩으로 흡수한다.
 *
 * @param allowedSkills 범위 지정 시 해당 skill_id 집합으로 제한 (미지정/빈 배열이면 전체)
 * @returns 머지된 도구 목록과 적용된 바인딩(카탈로그 dedup 용 skill_id 확보)
 */
export async function resolveSkillToolBindings(params: {
    userId: string;
    allTools: ToolDefinition[];
    allowedSkills?: string[];
}): Promise<{ mcpTools: ToolDefinition[]; skillBindings: ActiveSkillBinding[] }> {
    const { userId, allTools, allowedSkills } = params;
    let skillBindings: ActiveSkillBinding[] = [];
    try {
        skillBindings = await getSkillManager().getActiveSkillBindings(AGENT_TASK_SKILL_AGENT_ID, userId);
    } catch (e) {
        logger.debug('[AgentTask] 스킬 도구 바인딩 조회 실패 — 빈 배열', e);
    }
    if (allowedSkills && allowedSkills.length > 0) {
        const allow = new Set(allowedSkills);
        const before = skillBindings.length;
        skillBindings = skillBindings.filter((b) => allow.has(b.skill_id));
        logger.debug(`[AgentTask] 스킬 범위 제한: ${before} → ${skillBindings.length} (allowedSkills=${allowedSkills.length})`);
    }
    const mcpTools = skillBindings.length > 0
        ? mergeToolsWithSkills({ allTools, userToggled: allTools, profileRequired: [], skillBindings })
        : allTools;
    return { mcpTools, skillBindings };
}
