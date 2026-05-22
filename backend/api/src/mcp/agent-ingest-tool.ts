/**
 * ============================================================
 * MCP Tool: import_agent_from_git - Git URL → Agent draft (Phase 3.5)
 * ============================================================
 *
 * 채팅 중 LLM 이 호출 가능한 도구. GitHub URL 을 받아 AgentIngestService
 * 통해 AGENT.md 매니페스트를 가져와 status='draft' 로 저장합니다.
 *
 * Phase 2.5 의 `import_skill_from_git` (git-ingest-tool.ts) 패턴 100% 차용 —
 * text 응답 (LLM next-turn) + resource content (frontend inline card) 듀얼 반환.
 *
 * @module mcp/agent-ingest-tool
 */
import type { MCPToolDefinition, MCPToolResult } from './types';
import type { UserContext } from './user-sandbox';
import { createLogger } from '../utils/logger';

const logger = createLogger('AgentIngestTool');

interface ImportAgentFromGitArgs extends Record<string, unknown> {
    gitUrl: string;
    gitRef?: string;
    gitPath?: string;
    accessToken?: string;
    category?: string;
}

export const importAgentFromGitTool: MCPToolDefinition<ImportAgentFromGitArgs> = {
    tool: {
        name: 'import_agent_from_git',
        description: 'GitHub URL 에서 AGENT.md 매니페스트를 가져와 custom agent draft 로 저장합니다. 사용자가 명시적으로 "이 git url 의 agent 가져와줘", "이 저장소를 agent 로 import 해줘" 같은 요청을 했을 때만 호출하세요. AGENT.md 의 skill_bindings 에 git-url: prefix 가 있으면 chained skill ingest 도 자동 수행. tree 에 AGENT.md 가 여러 개면 후보 목록만 반환 (재호출에서 gitPath 명시 필요).',
        inputSchema: {
            type: 'object',
            properties: {
                gitUrl: {
                    type: 'string',
                    description: 'GitHub 저장소 URL. 형식: "https://github.com/owner/repo" 또는 단축 "owner/repo".',
                },
                gitRef: {
                    type: 'string',
                    description: '브랜치/태그/SHA (선택). 기본 HEAD.',
                },
                gitPath: {
                    type: 'string',
                    description: '명시적 단일 파일 경로 (선택). 미지정 시 자동 스캔 (root AGENT.md → *.agent.md → agents/*.md). multi-candidate 응답을 받았다면 이 인자로 재호출.',
                },
                accessToken: {
                    type: 'string',
                    description: 'GitHub access token (선택). private repo / rate limit 우회. 요청 한정 — DB 미저장.',
                },
                category: {
                    type: 'string',
                    description: '카테고리 ID override (선택). manifest 의 category 가 우선.',
                },
            },
            required: ['gitUrl'],
        },
    },
    handler: async (args, context?: UserContext): Promise<MCPToolResult> => {
        if (!context?.userId) {
            return {
                content: [{ type: 'text', text: '인증 컨텍스트가 없어 agent 를 가져올 수 없습니다.' }],
                isError: true,
            };
        }
        const userId = String(context.userId);
        const isAdmin = context.role === 'admin';

        try {
            const { AgentIngestService } = await import('../agents/git-ingest/agent-ingest-service');
            const { GitFetcher } = await import('../agents/git-ingest/git-fetcher');
            const { LLMClient } = await import('../llm/client');
            const { getUnifiedDatabase } = await import('../data/models/unified-database');
            const { AGENT_CREATOR, SKILL_CREATOR } = await import('../config/constants');

            if (!AGENT_CREATOR.enabled || !AGENT_CREATOR.gitIngestEnabled) {
                return {
                    content: [{ type: 'text', text: 'Agent ingest 기능이 비활성화 상태입니다. 관리자에게 AGENT_CREATOR_GIT_INGEST_ENABLED 환경변수 확인 요청하세요.' }],
                    isError: true,
                };
            }

            const service = new AgentIngestService({
                pool: getUnifiedDatabase().getPool(),
                llmClientFactory: (model: string) => new LLMClient(model ? { model } : {}),
                fetcherFactory: (opts) => new GitFetcher({ accessToken: opts.accessToken, timeoutMs: SKILL_CREATOR.gitFetchTimeout }),
            });

            const result = await service.import({
                userId,
                isAdmin,
                gitUrl: args.gitUrl,
                gitRef: args.gitRef,
                gitPath: args.gitPath,
                accessToken: args.accessToken,
                category: args.category,
            });

            // multi-candidate 응답 — text 만
            if ('selectionRequired' in result && result.selectionRequired) {
                const list = result.candidates.map((c, i) => `  ${i + 1}. ${c.path} (${c.size} bytes)`).join('\n');
                const text = `AGENT.md 후보 ${result.totalCandidates}개 발견 — 가져올 파일 경로를 \`gitPath\` 인자로 명시해 재호출하세요:\n\n${list}\n\n예: \`import_agent_from_git({ gitUrl: "${args.gitUrl}", gitPath: "${result.candidates[0].path}" })\``;
                logger.info(`MCP import_agent_from_git multi-candidate: ${result.candidates.length} (user=${userId}, gitUrl=${args.gitUrl})`);
                return { content: [{ type: 'text', text }] };
            }

            // Single result — frontend 가 인라인 카드로 렌더할 resource content 동봉
            const previewCard = {
                kind: 'agent-draft' as const,
                agentId: result.agentId,
                name: result.name,
                description: result.description,
                category: result.category,
                emoji: undefined,  // AGENT.md frontmatter 의 emoji 는 manifestMeta 에 없으므로 컴포넌트가 기본값 사용
                contentPreview: result.contentPreview,
                gitUrl: result.gitUrl,
                gitRef: result.gitRef.slice(0, 7),
                gitPath: result.gitPath,
                skillBindingsResolved: result.skillBindingsResolved,
                skillBindingsUnresolved: result.skillBindingsUnresolved,
                conventionFindings: result.conventionFindings,
                modelUsed: result.modelUsed,
                tokensUsed: result.tokensUsed,
                deduped: result.deduped,
            };
            const assistantText = result.deduped
                ? `24시간 내 동일 git ref/path 라 기존 agent draft "${result.name}" 를 재사용했습니다. 아래 카드에서 검토·승인하세요.`
                : `Git URL 에서 "${result.name}" agent 를 가져왔습니다 (status=draft). 아래 카드에서 검토·승인하세요.`;
            const warningSuffix = result.validationWarnings.includes('ADMIN_REQUIRED')
                ? '\n\n⚠ 관리자 권한이 없어 target=user 로 변경되었습니다.'
                : '';
            const unresolvedSuffix = result.skillBindingsUnresolved.length > 0
                ? `\n\n⚠ skill_bindings 중 ${result.skillBindingsUnresolved.length}건 미해결 — 승인 전 확인하세요.`
                : '';
            const convSuffix = result.conventionFindings.length > 0
                ? `\n\n⚠ ConventionChecker 가 ${result.conventionFindings.length}건 발견 — 승인 전 검토하세요.`
                : '';

            const llmText = `Imported agent draft ${result.agentId} from ${result.gitUrl}@${result.gitRef.slice(0, 7)}:${result.gitPath} (name="${result.name}", category=${result.category}, status=draft, skill_bindings=${result.skillBindingsResolved.length} resolved / ${result.skillBindingsUnresolved.length} unresolved).`;

            logger.info(`MCP import_agent_from_git: ${result.agentId} (user=${userId}, gitUrl=${args.gitUrl}, deduped=${result.deduped})`);
            return {
                content: [
                    { type: 'text', text: llmText },
                    {
                        type: 'resource',
                        resource: {
                            uri: `openmake://agent-draft/${result.agentId}`,
                            mimeType: 'application/json',
                            text: JSON.stringify({ previewCard, assistantText: assistantText + warningSuffix + unresolvedSuffix + convSuffix }),
                        },
                    },
                ],
            };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`MCP import_agent_from_git 실패: ${msg}`);
            return {
                content: [{ type: 'text', text: `Git URL 에서 agent 가져오기 실패: ${msg}` }],
                isError: true,
            };
        }
    },
};
