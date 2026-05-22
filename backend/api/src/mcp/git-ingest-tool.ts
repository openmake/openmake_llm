/**
 * ============================================================
 * MCP Tool: import_skill_from_git - Git URL → Skill draft (Phase 2.5)
 * ============================================================
 *
 * 채팅 중 LLM 이 호출 가능한 도구. GitHub URL 을 받아 GitIngestService
 * 통해 SKILL.md 매니페스트를 가져와 status='draft' 로 저장합니다.
 *
 * UserContext 의 userId/role 로 소유권을 결정. dedupe, draft 상한, file size
 * 제한 같은 안전장치는 GitIngestService 내부에서 처리.
 *
 * Phase 1 의 `create_skill` (skill-creator-tool.ts) 패턴 100% 차용 — text 응답
 * (LLM next-turn) + resource content (frontend inline card) 듀얼 반환.
 *
 * @module mcp/git-ingest-tool
 */
import type { MCPToolDefinition, MCPToolResult } from './types';
import type { UserContext } from './user-sandbox';
import { createLogger } from '../utils/logger';

const logger = createLogger('GitIngestTool');

interface ImportSkillFromGitArgs extends Record<string, unknown> {
    gitUrl: string;
    gitRef?: string;
    gitPath?: string;
    accessToken?: string;
    target?: 'user' | 'system';
    category?: string;
}

export const importSkillFromGitTool: MCPToolDefinition<ImportSkillFromGitArgs> = {
    tool: {
        name: 'import_skill_from_git',
        description: 'GitHub URL 에서 SKILL.md 매니페스트를 가져와 draft 로 저장합니다. 사용자가 명시적으로 "이 git url 의 스킬 가져와줘", "이 저장소를 스킬로 import 해줘" 같은 요청을 했을 때만 호출하세요. tree 에 SKILL.md 가 여러 개면 후보 목록만 반환 (재호출에서 gitPath 명시 필요).',
        inputSchema: {
            type: 'object',
            properties: {
                gitUrl: {
                    type: 'string',
                    description: 'GitHub 저장소 URL. 형식: "https://github.com/owner/repo" 또는 단축 "owner/repo". 다른 호스팅 (GitLab/Bitbucket) 미지원.',
                },
                gitRef: {
                    type: 'string',
                    description: '브랜치/태그/SHA (선택). 기본 HEAD (default branch). 7+ chars hex 면 자동 SHA 처리.',
                },
                gitPath: {
                    type: 'string',
                    description: '명시적 단일 파일 경로 (선택). 미지정 시 자동 스캔 (root SKILL.md → *.skill.md → skills/*.md). multi-candidate 응답을 받았다면 이 인자로 재호출.',
                },
                accessToken: {
                    type: 'string',
                    description: 'GitHub access token (선택). private repo 접근 또는 rate limit 우회 (60→5000/hr). 요청 한정 — DB 미저장.',
                },
                target: {
                    type: 'string',
                    enum: ['user', 'system'],
                    description: '"user" = 본인 전용, "system" = 전역 공개 (admin 만 가능, 비-admin 은 user 로 강제). 기본 user',
                },
                category: {
                    type: 'string',
                    description: '카테고리 ID (예: legal, healthcare). manifest 의 category 가 우선이고, 본 인자는 명시적 override 용.',
                },
            },
            required: ['gitUrl'],
        },
    },
    handler: async (args, context?: UserContext): Promise<MCPToolResult> => {
        if (!context?.userId) {
            return {
                content: [{ type: 'text', text: '인증 컨텍스트가 없어 스킬을 가져올 수 없습니다.' }],
                isError: true,
            };
        }
        const userId = String(context.userId);
        const isAdmin = context.role === 'admin';

        try {
            const { GitIngestService } = await import('../agents/git-ingest/git-ingest-service');
            const { GitFetcher } = await import('../agents/git-ingest/git-fetcher');
            const { LLMClient } = await import('../llm/client');
            const { getUnifiedDatabase } = await import('../data/models/unified-database');
            const { SKILL_CREATOR } = await import('../config/constants');

            if (!SKILL_CREATOR.gitIngestEnabled) {
                return {
                    content: [{ type: 'text', text: 'Git ingest 기능이 비활성화 상태입니다. 관리자에게 SKILL_CREATOR_GIT_INGEST_ENABLED 환경변수 확인 요청하세요.' }],
                    isError: true,
                };
            }

            const service = new GitIngestService({
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
                target: args.target ?? 'user',
                category: args.category as never,  // SKILL_CATEGORIES enum 은 service 가 검증
            });

            // multi-candidate 응답 — frontend 인라인 카드 대신 text 로 후보 목록 반환
            if ('selectionRequired' in result && result.selectionRequired) {
                const list = result.candidates.map((c, i) => `  ${i + 1}. ${c.path} (${c.size} bytes)`).join('\n');
                const text = `SKILL.md 후보 ${result.totalCandidates}개 발견 — 가져올 파일 경로를 \`gitPath\` 인자로 명시해 재호출하세요:\n\n${list}\n\n예: \`import_skill_from_git({ gitUrl: "${args.gitUrl}", gitPath: "${result.candidates[0].path}" })\``;
                logger.info(`MCP import_skill_from_git multi-candidate: ${result.candidates.length} (user=${userId}, gitUrl=${args.gitUrl})`);
                return { content: [{ type: 'text', text }] };
            }

            // Single result — frontend 가 인라인 카드로 렌더할 resource content 동봉
            const previewCard = {
                kind: 'skill-draft' as const,
                skillId: result.skillId,
                name: result.name,
                description: result.description,
                category: result.category,
                target: result.target,
                contentPreview: result.contentPreview,
                gitUrl: result.gitUrl,
                gitRef: result.gitRef.slice(0, 7),
                gitPath: result.gitPath,
                conventionFindings: result.conventionFindings,
                modelUsed: result.modelUsed,
                tokensUsed: result.tokensUsed,
                deduped: result.deduped,
            };
            const assistantText = result.deduped
                ? `24시간 내 동일 git ref/path 라 기존 draft "${result.name}" 를 재사용했습니다. 아래 카드에서 검토·승인하세요.`
                : `Git URL 에서 "${result.name}" 스킬을 가져왔습니다 (status=draft). 아래 카드에서 검토·승인하세요.`;
            const warningSuffix = result.validationWarnings.includes('ADMIN_REQUIRED')
                ? '\n\n⚠ 관리자 권한이 없어 target=user 로 변경되었습니다.'
                : '';
            const convSuffix = result.conventionFindings.length > 0
                ? `\n\n⚠ ConventionChecker 가 ${result.conventionFindings.length}건 발견 — 승인 전 검토하세요.`
                : '';

            const llmText = `Imported skill draft ${result.skillId} from ${result.gitUrl}@${result.gitRef.slice(0, 7)}:${result.gitPath} (name="${result.name}", category=${result.category}, status=draft).`;

            logger.info(`MCP import_skill_from_git: ${result.skillId} (user=${userId}, gitUrl=${args.gitUrl}, deduped=${result.deduped})`);
            return {
                content: [
                    { type: 'text', text: llmText },
                    {
                        type: 'resource',
                        resource: {
                            uri: `openmake://skill-draft/${result.skillId}`,
                            mimeType: 'application/json',
                            text: JSON.stringify({ previewCard, assistantText: assistantText + warningSuffix + convSuffix }),
                        },
                    },
                ],
            };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`MCP import_skill_from_git 실패: ${msg}`);
            return {
                content: [{ type: 'text', text: `Git URL 에서 스킬 가져오기 실패: ${msg}` }],
                isError: true,
            };
        }
    },
};
