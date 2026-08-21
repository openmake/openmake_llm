/**
 * ============================================================
 * MCP Tool: import_extension_from_git - Git URL → 확장 번들 설치
 * ============================================================
 *
 * 채팅 중 LLM 이 호출 가능한 도구. GitHub URL 의 plugin.json (Agent Plugins v1)
 * 확장 번들을 ExtensionIngestService 로 설치한다 — 구성요소(skill/MCP 서버)는
 * 각자 기존 draft→approve 라이프사이클을 그대로 따른다.
 *
 * git-ingest-tool (import_skill_from_git) 패턴 100% 차용 — text 응답
 * (LLM next-turn) + resource content (frontend inline card) 듀얼 반환.
 *
 * @module mcp/extension-ingest-tool
 */
import type { MCPToolDefinition, MCPToolResult } from './types';
import type { UserContext } from './user-sandbox';
import { createLogger } from '../utils/logger';
import { isAdminRole } from '../data/user-manager';

const logger = createLogger('ExtensionIngestTool');

interface ImportExtensionFromGitArgs extends Record<string, unknown> {
    gitUrl: string;
    gitRef?: string;
    gitPath?: string;
    accessToken?: string;
    plugin?: string;
}

export const importExtensionFromGitTool: MCPToolDefinition<ImportExtensionFromGitArgs> = {
    tool: {
        name: 'import_extension_from_git',
        description: 'GitHub URL 또는 .zip 아카이브 URL 의 plugin.json (Agent Plugins v1) 확장 번들을 설치합니다 — skills/*/SKILL.md 와 MCP 서버 정의를 한 번에 draft 로 가져옵니다. 마켓플레이스 저장소(.claude-plugin/marketplace.json)면 먼저 플러그인 목록을 반환하고, plugin 인자로 이름을 지정해 재호출하면 해당 플러그인을 설치합니다 (엔트리의 고정 ref 추적). 같은 소스의 이미 설치된 확장을 다시 요청하면 최신 버전으로 업데이트합니다 (구 구성요소는 archive). 사용자가 명시적으로 "이 확장/플러그인 설치해줘", "이 확장 업데이트해줘" 같은 요청을 했을 때만 호출하세요. plugin.json 이 여러 개면 후보 목록만 반환 (재호출에서 gitPath 명시 필요). 단일 스킬/에이전트/MCP 서버만 가져올 때는 import_skill_from_git / import_agent_from_git / import_mcp_server_from_git 를 대신 사용하세요.',
        inputSchema: {
            type: 'object',
            properties: {
                gitUrl: {
                    type: 'string',
                    description: 'GitHub 저장소 URL("https://github.com/owner/repo" 또는 단축 "owner/repo") 또는 .zip 아카이브 URL("https://.../ext.zip"). 다른 git 호스팅 (GitLab/Bitbucket) 미지원.',
                },
                gitRef: {
                    type: 'string',
                    description: '브랜치/태그/SHA (선택). 기본 HEAD (default branch). 7+ chars hex 면 자동 SHA 처리.',
                },
                gitPath: {
                    type: 'string',
                    description: 'plugin.json 파일 경로 (선택). 미지정 시 자동 스캔. multi-candidate 응답을 받았다면 이 인자로 재호출.',
                },
                accessToken: {
                    type: 'string',
                    description: 'GitHub access token (선택). private repo 접근 또는 rate limit 우회 (60→5000/hr). 요청 한정 — DB 미저장.',
                },
                plugin: {
                    type: 'string',
                    description: '마켓플레이스 저장소(.claude-plugin/marketplace.json 보유)에서 설치할 플러그인 이름 (선택). 미지정 시 마켓플레이스 목록만 반환 — 목록에서 이름을 골라 이 인자로 재호출.',
                },
            },
            required: ['gitUrl'],
        },
    },
    handler: async (args, context?: UserContext): Promise<MCPToolResult> => {
        if (!context?.userId) {
            return {
                content: [{ type: 'text', text: '인증 컨텍스트가 없어 확장을 설치할 수 없습니다.' }],
                isError: true,
            };
        }
        const userId = String(context.userId);
        const isAdmin = isAdminRole(context.role);

        try {
            const { ExtensionIngestService } = await import('../agents/git-ingest/extension-ingest-service');
            const { GitFetcher } = await import('../agents/git-ingest/git-fetcher');
            const { LLMClient } = await import('../llm/client');
            const { getUnifiedDatabase } = await import('../data/models/unified-database');
            const { EXTENSION_INGEST, SKILL_CREATOR } = await import('../config/constants');

            if (!EXTENSION_INGEST.enabled) {
                return {
                    content: [{ type: 'text', text: '확장 설치 기능이 비활성화 상태입니다. 관리자에게 EXTENSION_INGEST_ENABLED 환경변수 확인 요청하세요.' }],
                    isError: true,
                };
            }

            const service = new ExtensionIngestService({
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
                plugin: args.plugin,
            });

            // marketplace 인덱스 — 플러그인 목록 반환 (plugin 인자로 재호출 유도)
            if ('selectionRequired' in result && result.selectionRequired && result.marketplace) {
                const list = result.marketplace.plugins
                    .map((p, i) => `  ${i + 1}. ${p.name}${p.description ? ` — ${p.description.slice(0, 120)}` : ''}`)
                    .join('\n');
                const text = `마켓플레이스 "${result.marketplace.name}" 발견 — 플러그인 ${result.totalCandidates}개. 설치할 플러그인 이름을 \`plugin\` 인자로 지정해 재호출하세요:\n\n${list}\n\n예: \`import_extension_from_git({ gitUrl: "${args.gitUrl}", plugin: "${result.marketplace.plugins[0].name}" })\``;
                logger.info(`MCP import_extension_from_git marketplace listing: ${result.totalCandidates} (user=${userId}, gitUrl=${args.gitUrl})`);
                return { content: [{ type: 'text', text }] };
            }

            // multi-candidate — 후보 목록 반환
            if ('selectionRequired' in result && result.selectionRequired) {
                const list = result.candidates.map((c, i) => `  ${i + 1}. ${c.path} (${c.size} bytes)`).join('\n');
                const text = `plugin.json 후보 ${result.totalCandidates}개 발견 — 설치할 파일 경로를 \`gitPath\` 인자로 명시해 재호출하세요:\n\n${list}\n\n예: \`import_extension_from_git({ gitUrl: "${args.gitUrl}", gitPath: "${result.candidates[0].path}" })\``;
                logger.info(`MCP import_extension_from_git multi-candidate: ${result.candidates.length} (user=${userId}, gitUrl=${args.gitUrl})`);
                return { content: [{ type: 'text', text }] };
            }

            const okSkills = result.skills.filter(s => s.skillId);
            const failedSkills = result.skills.filter(s => s.error);
            const okServers = result.mcpServers.filter(s => s.serverId);
            const failedServers = result.mcpServers.filter(s => s.error);
            const blockedServers = result.mcpServers.filter(s => s.blockedByConvention);

            const previewCard = {
                kind: 'extension-install' as const,
                extensionId: result.extensionId,
                name: result.name,
                version: result.version,
                description: result.description,
                gitUrl: result.gitUrl,
                gitRef: result.gitRef.slice(0, 7),
                gitPath: result.gitPath,
                skills: result.skills,
                mcpServers: result.mcpServers,
                validationWarnings: result.validationWarnings,
                deduped: result.deduped,
                upToDate: result.upToDate,
                updated: result.updated,
                previousVersion: result.previousVersion,
            };
            const assistantText = result.upToDate
                ? `확장 "${result.name}@${result.version}" 은 이미 최신 상태입니다 (변경 없음).`
                : result.updated
                ? `확장 "${result.name}" 을 v${result.previousVersion} → v${result.version} 으로 업데이트했습니다 — skill ${okSkills.length}개, MCP 서버 ${okServers.length}개 (모두 draft, 구버전 구성요소는 보관 처리). 각 구성요소를 검토·승인해야 활성화됩니다.`
                : result.deduped
                ? `24시간 내 동일 git ref 라 기존 설치 "${result.name}@${result.version}" 를 재사용했습니다.`
                : `확장 "${result.name}@${result.version}" 을 설치했습니다 — skill ${okSkills.length}개, MCP 서버 ${okServers.length}개 (모두 draft). 각 구성요소를 검토·승인해야 활성화됩니다.`;
            const failSuffix = (failedSkills.length + failedServers.length) > 0
                ? `\n\n⚠ 일부 구성요소 실패: ${[...failedSkills.map(s => `${s.path}: ${s.error}`), ...failedServers.map(s => `${s.name}: ${s.error}`)].join('; ')}`
                : '';
            const blockSuffix = blockedServers.length > 0
                ? `\n\n⚠ MCP 서버 ${blockedServers.length}개가 위험 명령 패턴으로 차단 표시 — 승인 전 반드시 검토하세요.`
                : '';

            const llmText = result.upToDate
                ? `Extension ${result.extensionId} "${result.name}@${result.version}" is already up to date (ref ${result.gitRef.slice(0, 7)}). No changes made.`
                : `${result.updated ? `Updated extension ${result.extensionId} "${result.name}" v${result.previousVersion} -> v${result.version}` : `Installed extension ${result.extensionId} "${result.name}@${result.version}"`} from ${result.gitUrl}@${result.gitRef.slice(0, 7)} — skills: ${okSkills.length} ok/${failedSkills.length} failed, mcpServers: ${okServers.length} ok/${failedServers.length} failed/${blockedServers.length} convention-blocked. All components are drafts requiring user approval.`;

            logger.info(`MCP import_extension_from_git: ${result.extensionId} (user=${userId}, gitUrl=${args.gitUrl}, deduped=${result.deduped})`);
            return {
                content: [
                    { type: 'text', text: llmText },
                    {
                        type: 'resource',
                        resource: {
                            uri: `openmake://extension-install/${result.extensionId}`,
                            mimeType: 'application/json',
                            text: JSON.stringify({ previewCard, assistantText: assistantText + failSuffix + blockSuffix }),
                        },
                    },
                ],
            };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`MCP import_extension_from_git 실패: ${msg}`);
            return {
                content: [{ type: 'text', text: `확장 설치 실패: ${msg}` }],
                isError: true,
            };
        }
    },
};
