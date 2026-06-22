/**
 * ============================================================
 * MCP Tool: load_skill — 스킬 자동 호출 (LLM self-select)
 * ============================================================
 *
 * 채팅 중 모델이 호출하는 도구. 시스템이 이 도구의 description 에 active 스킬
 * 카탈로그("## Skill Library")를 주입하면(ChatService.getAllowedTools), 모델이
 * 질문과 관련된 스킬 이름을 골라 호출한다. 핸들러는 이름 → 전체 content 를
 * 조회해 반환하고, 다음 턴에서 모델이 그 지침으로 답한다(progressive disclosure).
 *
 * 안전 원칙:
 * - 카탈로그 주입/노출은 SKILL_AUTO_SELECT_ENABLED 플래그로 게이팅(getAllowedTools).
 * - 미매칭/오류는 throw 하지 않고 안내 텍스트 반환(채팅 흐름 무중단).
 *
 * @module mcp/load-skill-tool
 */
import type { MCPToolDefinition, MCPToolResult } from './types';
import type { UserContext } from './user-sandbox';
import { createLogger } from '../utils/logger';

const logger = createLogger('LoadSkillTool');

export const LOAD_SKILL_TOOL_NAME = 'load_skill';

interface LoadSkillArgs extends Record<string, unknown> {
    skill_names: string[];
}

export const loadSkillTool: MCPToolDefinition<LoadSkillArgs> = {
    tool: {
        name: LOAD_SKILL_TOOL_NAME,
        description:
            '스킬 라이브러리에서 현재 질문에 직접 관련된 전문 스킬을 불러온다. ' +
            '사용 가능한 스킬은 이 설명 하단의 "## Skill Library" 카탈로그에 있다. ' +
            '질문과 직접 관련된 스킬이 있을 때만 그 정확한 이름을 skill_names 에 넣어 호출하라. ' +
            '가장 관련된 1~3개만 고르고, 관련 스킬이 없으면 이 도구를 호출하지 마라.',
        inputSchema: {
            type: 'object',
            properties: {
                skill_names: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '불러올 스킬 이름들 — Skill Library 카탈로그의 정확한 이름. 가장 관련된 1~3개만.',
                },
            },
            required: ['skill_names'],
        },
    },
    handler: async (args, context?: UserContext): Promise<MCPToolResult> => {
        const names = Array.isArray(args.skill_names)
            ? args.skill_names.filter((n): n is string => typeof n === 'string')
            : [];
        if (names.length === 0) {
            return { content: [{ type: 'text', text: '불러올 스킬 이름이 없습니다.' }] };
        }
        const userId = context?.userId !== undefined ? String(context.userId) : undefined;
        try {
            const { getSkillManager } = await import('../agents/skill-manager');
            const { prompt, matched } = await getSkillManager().buildSkillPromptForNames(names, userId);
            if (!prompt || matched.length === 0) {
                return { content: [{ type: 'text', text: `요청한 스킬을 찾지 못했습니다: ${names.join(', ')}` }] };
            }
            logger.info(`load_skill: ${matched.join(', ')} (user=${userId ?? 'guest'})`);
            return { content: [{ type: 'text', text: prompt }] };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`load_skill 실패: ${msg}`);
            return { content: [{ type: 'text', text: `스킬 로드 실패: ${msg}` }], isError: true };
        }
    },
};
