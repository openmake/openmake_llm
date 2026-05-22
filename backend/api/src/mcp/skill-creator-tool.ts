/**
 * ============================================================
 * MCP Tool: create_skill - LLM 자동 스킬 생성 (Phase 1)
 * ============================================================
 *
 * 채팅 중 LLM 이 호출 가능한 도구. 자연어 purpose 를 받아 SkillCreatorService
 * 를 통해 매니페스트를 생성하고 status='draft' 로 저장합니다.
 *
 * UserContext 의 userId/role 로 소유권을 결정. dedupe, draft 상한 같은
 * 안전장치는 SkillCreatorService 내부에서 처리.
 *
 * @module mcp/skill-creator-tool
 */
import type { MCPToolDefinition, MCPToolResult } from './types';
import type { UserContext } from './user-sandbox';
import { createLogger } from '../utils/logger';

const logger = createLogger('CreateSkillTool');

interface CreateSkillArgs extends Record<string, unknown> {
    purpose: string;
    target?: 'user' | 'system';
    category?: string;
    examples?: string[];
    hints?: string;
}

export const createSkillTool: MCPToolDefinition<CreateSkillArgs> = {
    tool: {
        name: 'create_skill',
        description: '자연어 purpose 를 받아 SKILL 매니페스트를 LLM 으로 생성하고 draft 상태로 저장합니다. 사용자가 명시적으로 "스킬을 만들어줘", "이런 스킬이 있으면 좋겠다" 같은 요청을 했을 때만 호출하세요.',
        inputSchema: {
            type: 'object',
            properties: {
                purpose: {
                    type: 'string',
                    description: '만들고자 하는 스킬의 목적/역할 (5-500자). 예: "한국 의료법 자문 스킬"',
                },
                target: {
                    type: 'string',
                    enum: ['user', 'system'],
                    description: '"user" = 본인 전용, "system" = 전역 공개 (admin 만 가능, 비-admin 은 user 로 강제). 기본 user',
                },
                category: {
                    type: 'string',
                    description: '카테고리 ID (예: legal, healthcare, coding, business). 생략 시 LLM 이 결정',
                },
                examples: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '스킬이 처리해야 할 예시 질문/작업 (최대 5개, 각 500자)',
                },
                hints: {
                    type: 'string',
                    description: '추가 지침/제약 (선택, 1000자)',
                },
            },
            required: ['purpose'],
        },
    },
    handler: async (args, context?: UserContext): Promise<MCPToolResult> => {
        if (!context?.userId) {
            return {
                content: [{ type: 'text', text: '인증 컨텍스트가 없어 스킬을 생성할 수 없습니다.' }],
                isError: true,
            };
        }
        const userId = String(context.userId);
        const isAdmin = context.role === 'admin';

        try {
            const { SkillCreatorService } = await import('../agents/skill-creator');
            const { LLMClient } = await import('../llm/client');
            const { getUnifiedDatabase } = await import('../data/models/unified-database');

            const service = new SkillCreatorService({
                pool: getUnifiedDatabase().getPool(),
                llmClientFactory: (model: string) => new LLMClient(model ? { model } : {}),
            });

            const result = await service.create({
                userId,
                isAdmin,
                purpose: args.purpose,
                target: args.target,
                category: args.category,
                examples: args.examples,
                hints: args.hints,
            });

            // Frontend (chat.js) 가 인라인 카드로 렌더링할 수 있도록 resource content 동봉.
            // URI prefix `openmake://skill-draft/` 가 frontend 의 감지 패턴.
            const previewCard = {
                kind: 'skill-draft' as const,
                skillId: result.skillId,
                name: result.name,
                description: result.description,
                category: result.category,
                target: result.target,
                contentPreview: result.contentPreview,
                triggers: result.triggers,
                createdAt: result.manifestMeta.createdAt,
                modelUsed: result.modelUsed,
                tokensUsed: result.tokensUsed,
                deduped: result.deduped,
            };
            const assistantText = result.deduped
                ? `24시간 내 동일 요청이라 기존 draft "${result.name}" 를 재사용했습니다. 아래 카드에서 검토·승인하세요.`
                : `"${result.name}" draft 를 생성했습니다 (status=draft). 아래 카드에서 검토·승인하세요.`;
            const warningSuffix = result.warnings.includes('ADMIN_REQUIRED')
                ? '\n\n⚠ 관리자 권한이 없어 target=user 로 변경되었습니다.'
                : '';

            // LLM 이 다음 turn 의 context 로 받는 텍스트 (간결한 fallback)
            const llmText = `Created skill draft ${result.skillId} (name="${result.name}", category=${result.category}, status=draft).`;

            logger.info(`MCP create_skill: ${result.skillId} (user=${userId}, deduped=${result.deduped})`);
            return {
                content: [
                    { type: 'text', text: llmText },
                    {
                        type: 'resource',
                        resource: {
                            uri: `openmake://skill-draft/${result.skillId}`,
                            mimeType: 'application/json',
                            text: JSON.stringify({ previewCard, assistantText: assistantText + warningSuffix }),
                        },
                    },
                ],
            };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`MCP create_skill 실패: ${msg}`);
            return {
                content: [{ type: 'text', text: `스킬 생성 실패: ${msg}` }],
                isError: true,
            };
        }
    },
};
