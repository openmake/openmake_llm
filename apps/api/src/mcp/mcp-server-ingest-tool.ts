/**
 * ============================================================
 * MCP Tool: import_mcp_server_from_git - Git URL → MCP server draft (Phase 4.5)
 * ============================================================
 *
 * 채팅 중 LLM 이 호출 가능한 도구. GitHub URL 을 받아 McpServerIngestService
 * 통해 MCPSERVER.md 매니페스트를 가져와 status='draft' + enabled=false +
 * visibility='user_private' 3중 잠금으로 저장합니다.
 *
 * Phase 3.5 의 `import_agent_from_git` (agent-ingest-tool.ts) 패턴 100% 차용 —
 * text 응답 (LLM next-turn) + resource content (frontend inline card) 듀얼 반환.
 *
 * @module mcp/mcp-server-ingest-tool
 */
import type { MCPToolDefinition, MCPToolResult } from './types';
import type { UserContext } from './user-sandbox';
import { createLogger } from '../utils/logger';

const logger = createLogger('McpServerIngestTool');

interface ImportMcpServerFromGitArgs extends Record<string, unknown> {
    gitUrl: string;
    gitRef?: string;
    gitPath?: string;
    accessToken?: string;
}

export const importMcpServerFromGitTool: MCPToolDefinition<ImportMcpServerFromGitArgs> = {
    tool: {
        name: 'import_mcp_server_from_git',
        description: 'GitHub URL 에서 MCPSERVER.md 매니페스트를 가져와 MCP server draft 로 저장합니다. 사용자가 명시적으로 "이 git url 의 MCP server 가져와줘", "이 저장소를 MCP 서버로 import 해줘" 같은 요청을 했을 때만 호출하세요. 저장된 draft 는 status=draft + enabled=false + visibility=user_private 3중 잠금이라 사용자가 카드에서 검토 후 승인해야 활성화됩니다. tree 에 MCPSERVER.md 가 여러 개면 후보 목록만 반환 (재호출에서 gitPath 명시 필요). 위험 명령 패턴 (curl|sh, rm -rf, base64 exec 등) 이 감지되면 자동 승인이 차단됩니다.',
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
                    description: '명시적 단일 파일 경로 (선택). 미지정 시 자동 스캔 (root MCPSERVER.md → *.mcpserver.md → *.mcp-server.md → mcp-servers/*.md). multi-candidate 응답을 받았다면 이 인자로 재호출.',
                },
                accessToken: {
                    type: 'string',
                    description: 'GitHub access token (선택). private repo / rate limit 우회. 요청 한정 — DB 미저장.',
                },
            },
            required: ['gitUrl'],
        },
    },
    handler: async (args, context?: UserContext): Promise<MCPToolResult> => {
        if (!context?.userId) {
            return {
                content: [{ type: 'text', text: '인증 컨텍스트가 없어 MCP server 를 가져올 수 없습니다.' }],
                isError: true,
            };
        }
        const userId = String(context.userId);
        const isAdmin = context.role === 'admin';

        try {
            const { McpServerIngestService } = await import('../agents/git-ingest/mcp-server-ingest-service');
            const { GitFetcher } = await import('../agents/git-ingest/git-fetcher');
            const { LLMClient } = await import('../llm/client');
            const { getUnifiedDatabase } = await import('../data/models/unified-database');
            const { MCP_INGEST } = await import('../config/constants');

            if (!MCP_INGEST.enabled) {
                return {
                    content: [{ type: 'text', text: 'MCP server ingest 기능이 비활성화 상태입니다. 관리자에게 MCP_INGEST_ENABLED 환경변수 확인 요청하세요.' }],
                    isError: true,
                };
            }

            const service = new McpServerIngestService({
                pool: getUnifiedDatabase().getPool(),
                llmClientFactory: (model: string) => new LLMClient(model ? { model } : {}),
                fetcherFactory: (opts) => new GitFetcher({
                    accessToken: opts.accessToken,
                    timeoutMs: MCP_INGEST.gitFetchTimeoutMs,
                }),
            });

            const result = await service.import({
                userId,
                isAdmin,
                gitUrl: args.gitUrl,
                gitRef: args.gitRef,
                gitPath: args.gitPath,
                accessToken: args.accessToken,
            });

            // multi-candidate 응답 — text 만
            if ('selectionRequired' in result && result.selectionRequired) {
                const list = result.candidates.map((c, i) => `  ${i + 1}. ${c.path} (${c.size} bytes)`).join('\n');
                const text = `MCPSERVER.md 후보 ${result.totalCandidates}개 발견 — 가져올 파일 경로를 \`gitPath\` 인자로 명시해 재호출하세요:\n\n${list}\n\n예: \`import_mcp_server_from_git({ gitUrl: "${args.gitUrl}", gitPath: "${result.candidates[0].path}" })\``;
                logger.info(`MCP import_mcp_server_from_git multi-candidate: ${result.candidates.length} (user=${userId}, gitUrl=${args.gitUrl})`);
                return { content: [{ type: 'text', text }] };
            }

            // Single result — frontend 가 인라인 카드로 렌더할 resource content 동봉
            const previewCard = {
                kind: 'mcp-server-draft' as const,
                serverId: result.serverId,
                name: result.name,
                description: result.description,
                category: result.category,
                transportType: result.transportType,
                transport_type: result.transportType,
                command: result.command,
                args: result.args,
                env: result.env,
                url: result.url,
                requiredEnv: result.requiredEnv,
                manifest_meta: {
                    gitUrl: result.gitUrl,
                    gitRef: result.gitRef,
                    gitPath: result.gitPath,
                    description: result.description,
                    category: result.category,
                    requiredEnv: result.requiredEnv,
                    conventionFindings: result.conventionFindings,
                    blockedByConvention: result.blockedByConvention,
                },
                conventionFindings: result.conventionFindings,
                blockedByConvention: result.blockedByConvention,
                tokensUsed: result.tokensUsed,
                deduped: result.deduped,
            };

            const assistantText = result.deduped
                ? `24시간 내 동일 git ref/path 라 기존 MCP server draft "${result.name}" 를 재사용했습니다. 아래 카드에서 검토·승인하세요.`
                : `Git URL 에서 "${result.name}" MCP server 를 가져왔습니다 (status=draft, enabled=false). 아래 카드에서 검토·승인하세요.`;
            const blockedSuffix = result.blockedByConvention
                ? '\n\n⚠ 위험 명령 패턴이 감지되어 승인이 차단됩니다. command/args 를 검토하세요.'
                : '';
            const requiredEnvSuffix = result.requiredEnv.length > 0
                ? `\n\nℹ 필수 환경변수 ${result.requiredEnv.length}개 (${result.requiredEnv.join(', ')}) — 승인 시 실제 값으로 채워야 합니다.`
                : '';
            const convSuffix = !result.blockedByConvention && result.conventionFindings.length > 0
                ? `\n\nℹ ConventionChecker 가 ${result.conventionFindings.length}건 발견 — 승인 전 검토하세요.`
                : '';

            const llmText = `Imported MCP server draft ${result.serverId} from ${result.gitUrl}@${result.gitRef.slice(0, 7)}:${result.gitPath} (name="${result.name}", category=${result.category}, transport=${result.transportType}, status=draft, blockedByConvention=${result.blockedByConvention}, requiredEnv=${result.requiredEnv.length}).`;

            logger.info(`MCP import_mcp_server_from_git: ${result.serverId} (user=${userId}, gitUrl=${args.gitUrl}, deduped=${result.deduped}, blocked=${result.blockedByConvention})`);
            return {
                content: [
                    { type: 'text', text: llmText },
                    {
                        type: 'resource',
                        resource: {
                            uri: `openmake://mcp-server-draft/${result.serverId}`,
                            mimeType: 'application/json',
                            text: JSON.stringify({
                                previewCard,
                                assistantText: assistantText + blockedSuffix + requiredEnvSuffix + convSuffix,
                            }),
                        },
                    },
                ],
            };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`MCP import_mcp_server_from_git 실패: ${msg}`);
            return {
                content: [{ type: 'text', text: `Git URL 에서 MCP server 가져오기 실패: ${msg}` }],
                isError: true,
            };
        }
    },
};
