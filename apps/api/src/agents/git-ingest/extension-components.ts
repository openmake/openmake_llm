/**
 * 확장 번들 구성요소 설치 — ExtensionIngestService 에서 분리 (파일 크기 가드).
 *
 * 번들 매니페스트 해석·설치 레코드 관리는 서비스가 맡고, 이 모듈은 **개별 구성요소를
 * 실제로 설치**하는 네 갈래를 담당한다:
 *   - `commands/<name>.md` → 스킬          (Phase 2)
 *   - `agents/<name>.md`   → Custom Agent  (Phase 2)
 *   - 스킬 번들 `scripts/`·`references/`·`assets/` → skill_assets (Phase 2)
 *   - `mcpServers` / `mcp.json`            → MCP 서버 draft
 *
 * 모두 개별 실패를 결과 배열에 담고 진행한다 — 한 구성요소의 실패가 번들 설치 전체를
 * 죽이지 않는다.
 *
 * @module agents/git-ingest/extension-components
 */
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { Pool } from 'pg';
import type { LLMClient } from '../../llm/client';
import { createLogger } from '../../utils/logger';
import type { GitFetcher } from './git-fetcher';
import type { GitIngestService } from './git-ingest-service';
import { commandFileToSkillMarkdown, agentFileToCustomAgent } from './plugin-component-compat';
import { parseMcpJsonFile, type NormalizedMcpServer } from './extension-manifest-validator';
import { ConventionChecker, isBlockedByConvention } from './convention-checker';
import { McpServerDraftRepository } from '../../data/repositories/mcp-server-draft-repository';
import { UserAgentRepository } from '../../data/repositories/user-agent-repository';
import { SkillAssetRepository } from '../../data/repositories/skill-asset-repository';
import { EXTENSION_INGEST, SKILL_CREATOR } from '../../config/constants';
import { PLUGIN_COMPONENT_LIMITS, UNSUPPORTED_AGENT_FIELDS } from '../../config/skill-compat';
import type { SkillInstallResult, AgentInstallResult, McpServerInstallResult } from './extension-ingest-types';

const logger = createLogger('ExtensionIngestService');

/** tree 엔트리 최소 형태 (경로 + 크기). */
interface TreeLike {
    entries: Array<{ path: string; size: number }>;
}

/** 네 갈래가 공유하는 저장소 좌표 + 수집 결과 버킷. */
export interface ComponentContext {
    pool: Pool;
    fetcher: GitFetcher;
    owner: string;
    repo: string;
    sha: string;
    tree: TreeLike;
    /** 확장 루트 prefix ('' 또는 'dir/') */
    root: string;
    userId: string;
    isAdmin: boolean;
    accessToken?: string;
    /** 구성요소 ingest 에 기록할 git URL (marketplace 는 대상 저장소로 바뀔 수 있음) */
    gitUrl: string;
    /** plugin.json 의 tree 경로 (MCP draft manifest_meta 기록용) */
    manifestPath: string;
    /** 확장 이름 (구성요소 이름 prefix) */
    extensionName: string;
    /** 설치 리포트 — 각 갈래가 사유를 push 한다 */
    warnings: string[];
}

/** `root` 하위 특정 디렉토리의 markdown 파일 경로 (1단계 중첩까지). */
function markdownPathsUnder(tree: TreeLike, root: string, dirName: string): string[] {
    const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escaped}${dirName}/(?:[^/]+/)?[^/]+\\.md$`, 'i');
    return tree.entries.filter(e => pattern.test(e.path)).map(e => e.path);
}

/**
 * `commands/<name>.md` → 스킬.
 *
 * openmake 는 슬래시 명령이 곧 스킬 매칭이라 등가물이다. name 프론트매터가 없어
 * (파일명이 명령 이름) SKILL.md 규격으로 정규화한 뒤 같은 파이프라인에 태운다.
 * 결과는 `skillResults` 에 `fromCommand: true` 로 합류한다.
 */
export async function collectCommandSkills(
    ctx: ComponentContext,
    skillService: GitIngestService,
    skillResults: SkillInstallResult[],
): Promise<void> {
    let commandPaths = markdownPathsUnder(ctx.tree, ctx.root, 'commands');
    if (commandPaths.length === 0) return;
    if (commandPaths.length > PLUGIN_COMPONENT_LIMITS.maxCommands) {
        ctx.warnings.push(`COMMANDS_TRUNCATED: ${commandPaths.length}개 중 ${PLUGIN_COMPONENT_LIMITS.maxCommands}개만 설치`);
        commandPaths = commandPaths.slice(0, PLUGIN_COMPONENT_LIMITS.maxCommands);
    }
    for (const path of commandPaths) {
        try {
            const raw = await ctx.fetcher.fetchFile(ctx.owner, ctx.repo, ctx.sha, path, SKILL_CREATOR.gitMaxFileSize ?? 262144);
            const normalized = commandFileToSkillMarkdown(path, raw);
            const r = await skillService.import({
                userId: ctx.userId,
                isAdmin: ctx.isAdmin,
                gitUrl: ctx.gitUrl,
                gitRef: ctx.sha,
                gitPath: path,
                accessToken: ctx.accessToken,
                target: 'user',
                contentOverride: normalized.content,
            });
            if ('selectionRequired' in r && r.selectionRequired) {
                skillResults.push({ path, error: 'unexpected multi-candidate', fromCommand: true });
            } else {
                skillResults.push({
                    path, skillId: r.skillId, name: r.name, deduped: r.deduped, fromCommand: true,
                    ...(r.compatNotes.length > 0 ? { compatNotes: r.compatNotes } : {}),
                });
            }
        } catch (e) {
            skillResults.push({ path, error: e instanceof Error ? e.message : String(e), fromCommand: true });
        }
    }
    const ok = skillResults.filter(r => r.fromCommand && r.skillId).length;
    ctx.warnings.push(`COMMANDS_CONVERTED: 슬래시 명령 ${ok}개를 스킬로 변환 (\`/이름\` 으로 호출)`);
}

/**
 * `agents/<name>.md` → Custom Agent.
 *
 * 본문이 곧 시스템 프롬프트다. 스킬/MCP 와 달리 실행 권한이 없고 사용자가 명시
 * 선택할 때만 적용되는 페르소나라 승인 게이트 없이 즉시 활성으로 만든다.
 */
export async function collectPluginAgents(ctx: ComponentContext): Promise<AgentInstallResult[]> {
    let agentPaths = markdownPathsUnder(ctx.tree, ctx.root, 'agents');
    if (agentPaths.length === 0) return [];
    if (agentPaths.length > PLUGIN_COMPONENT_LIMITS.maxAgents) {
        ctx.warnings.push(`AGENTS_TRUNCATED: ${agentPaths.length}개 중 ${PLUGIN_COMPONENT_LIMITS.maxAgents}개만 설치`);
        agentPaths = agentPaths.slice(0, PLUGIN_COMPONENT_LIMITS.maxAgents);
    }

    const results: AgentInstallResult[] = [];
    const agentRepo = new UserAgentRepository(ctx.pool);
    for (const path of agentPaths) {
        try {
            const raw = await ctx.fetcher.fetchFile(ctx.owner, ctx.repo, ctx.sha, path, SKILL_CREATOR.gitMaxFileSize ?? 262144);
            const parsedAgent = agentFileToCustomAgent(path, raw);
            if (!parsedAgent.systemPrompt || parsedAgent.systemPrompt.length < 10) {
                results.push({ path, name: parsedAgent.name, error: '시스템 프롬프트가 비어있음' });
                continue;
            }
            const storedName = await resolveUniqueAgentName(
                agentRepo, ctx.userId, `${ctx.extensionName}-${parsedAgent.name}`,
            );
            const ignoredFields = Object.keys(parsedAgent.upstreamFields)
                .filter(k => k in UNSUPPORTED_AGENT_FIELDS)
                .map(k => UNSUPPORTED_AGENT_FIELDS[k]);
            const created = await agentRepo.create({
                id: uuidv4(),
                userId: ctx.userId,
                name: storedName,
                description: parsedAgent.description,
                systemPrompt: parsedAgent.systemPrompt,
                extensionId: null,   // linkComponents 가 이어서 연결
            });
            results.push({
                path, name: parsedAgent.name, agentId: created.id, storedName,
                ...(ignoredFields.length > 0 ? { ignoredFields } : {}),
            });
        } catch (e) {
            results.push({ path, name: path, error: e instanceof Error ? e.message : String(e) });
        }
    }

    const okAgents = results.filter(r => r.agentId);
    if (okAgents.length > 0) {
        ctx.warnings.push(`AGENTS_CONVERTED: 서브에이전트 ${okAgents.length}개를 Custom Agent 로 변환 (즉시 사용 가능)`);
    }
    const ignored = [...new Set(results.flatMap(r => r.ignoredFields ?? []))];
    if (ignored.length > 0) {
        ctx.warnings.push(`AGENT_FIELDS_IGNORED: ${ignored.join(', ')} — 이 환경은 시스템 프롬프트만 사용합니다`);
    }
    return results;
}

/**
 * 스킬 번들 파일 수집 — SKILL.md 와 같은 디렉토리의 `scripts/`·`references/`·`assets/`.
 *
 * 외부 스킬 본문은 "see references/rules.md" 처럼 딸린 파일을 참조하는데 ingest 는
 * SKILL.md 한 장만 가져와 참조 대상이 없었다. 원본 바이트를 skill_assets 에 보존해
 * 목록 안내와 에이전트 작업 샌드박스 주입에 쓴다. 실패는 fail-soft — 스킬 설치는 유지.
 */
export async function collectSkillAssets(
    ctx: ComponentContext,
    skillResults: SkillInstallResult[],
): Promise<void> {
    const assetRepo = new SkillAssetRepository(ctx.pool);
    for (const result of skillResults) {
        if (!result.skillId) continue;
        // SKILL.md 의 디렉토리 (commands/ 변환분은 번들 개념이 없어 건너뜀)
        if (result.fromCommand) continue;
        const dir = result.path.slice(0, result.path.lastIndexOf('/') + 1);
        if (!dir) continue;
        const candidates = ctx.tree.entries.filter(e =>
            e.path.startsWith(dir)
            && e.path !== result.path
            && /^(scripts|references|assets)\//.test(e.path.slice(dir.length))
        );
        if (candidates.length === 0) continue;

        let picked = candidates;
        if (picked.length > PLUGIN_COMPONENT_LIMITS.maxAssetsPerSkill) {
            ctx.warnings.push(`ASSETS_TRUNCATED: ${result.name ?? result.path} 의 번들 파일 ${picked.length}개 중 ${PLUGIN_COMPONENT_LIMITS.maxAssetsPerSkill}개만 저장`);
            picked = picked.slice(0, PLUGIN_COMPONENT_LIMITS.maxAssetsPerSkill);
        }
        const stored: string[] = [];
        let total = 0;
        for (const entry of picked) {
            const relPath = entry.path.slice(dir.length);
            if (entry.size > PLUGIN_COMPONENT_LIMITS.maxAssetBytes) {
                ctx.warnings.push(`ASSET_TOO_LARGE: ${relPath} (${entry.size}B) 는 상한 초과로 건너뜀`);
                continue;
            }
            if (total + entry.size > PLUGIN_COMPONENT_LIMITS.maxAssetTotalBytes) {
                ctx.warnings.push(`ASSETS_BUDGET_EXCEEDED: ${result.name ?? result.path} 의 번들 파일 합계 상한 초과 — 이후 파일 생략`);
                break;
            }
            try {
                const raw = await ctx.fetcher.fetchFile(
                    ctx.owner, ctx.repo, ctx.sha, entry.path, PLUGIN_COMPONENT_LIMITS.maxAssetBytes,
                );
                const buf = Buffer.from(raw, 'utf8');
                total += buf.length;
                await assetRepo.upsert({ skillId: result.skillId, relPath, content: buf });
                stored.push(relPath);
            } catch (e) {
                logger.warn(`번들 파일 저장 실패 (fail-soft): ${entry.path} — ${e instanceof Error ? e.message : String(e)}`);
            }
        }
        if (stored.length > 0) {
            result.assets = stored;
            // 모델이 파일의 존재와 경로를 알아야 load_skill(asset_paths) 로 열 수 있다
            await appendAssetIndex(ctx.pool, result.skillId, stored);
            ctx.warnings.push(`ASSETS_STORED: ${result.name ?? result.path} 번들 파일 ${stored.length}개 보존 (${stored.slice(0, 5).join(', ')}${stored.length > 5 ? ' …' : ''})`);
        }
    }
}

/**
 * MCP 서버 draft 설치 — plugin.json `mcpServers` 우선, 없으면 `<root>mcp.json` / `.mcp.json`.
 *
 * ConventionChecker 통과 여부와 무관하게 draft + enabled=false + user_private 3중 잠금으로
 * 저장하고, 차단 표시(`blockedByConvention`)만 남긴다 — 승인은 사용자 몫.
 */
export async function collectMcpDrafts(
    ctx: ComponentContext,
    manifestServers: NormalizedMcpServer[],
    llmClientFactory: (model: string) => LLMClient,
): Promise<McpServerInstallResult[]> {
    let mcpEntries: NormalizedMcpServer[] = manifestServers;
    if (mcpEntries.length === 0) {
        const mcpJsonEntry = ctx.tree.entries.find(
            e => e.path === `${ctx.root}mcp.json` || e.path === `${ctx.root}.mcp.json`
        );
        if (mcpJsonEntry) {
            const mcpRaw = await ctx.fetcher.fetchFile(ctx.owner, ctx.repo, ctx.sha, mcpJsonEntry.path, EXTENSION_INGEST.manifestMaxBytes);
            const parsedMcp = parseMcpJsonFile(mcpRaw);
            // 항목 단위 — 일부 실패해도 나머지는 설치된다 (upstream 의 빈 url placeholder 등)
            if (parsedMcp.errors.length > 0) {
                ctx.warnings.push(`MCP_ENTRIES_SKIPPED: ${parsedMcp.errors.join('; ')}`);
            }
            if (parsedMcp.warnings.length > 0) {
                ctx.warnings.push(`MCP_FIELDS_IGNORED: ${parsedMcp.warnings.join('; ')}`);
            }
            mcpEntries = parsedMcp.servers;
        }
    }
    if (mcpEntries.length > EXTENSION_INGEST.maxMcpServersPerExtension) {
        ctx.warnings.push(`MCP_SERVERS_TRUNCATED: ${mcpEntries.length}개 중 ${EXTENSION_INGEST.maxMcpServersPerExtension}개만 설치`);
        mcpEntries = mcpEntries.slice(0, EXTENSION_INGEST.maxMcpServersPerExtension);
    }
    if (mcpEntries.length === 0) return [];

    const results: McpServerInstallResult[] = [];
    const checker = new ConventionChecker(llmClientFactory(SKILL_CREATOR.authorModel));
    const draftRepo = new McpServerDraftRepository(ctx.pool);
    for (const entry of mcpEntries) {
        try {
            const conv = await checker.checkMcpServer(
                JSON.stringify(entry, null, 2),
                '',
                { command: entry.command, args: entry.args },
            );
            const blockedByConvention = isBlockedByConvention(conv.findings);
            const finalName = await resolveUniqueServerName(ctx.pool, ctx.userId, `${ctx.extensionName}-${entry.name}`);
            const inserted = await draftRepo.insertDraft({
                name: finalName,
                transportType: entry.transportType,
                command: entry.command ?? null,
                args: entry.args ?? null,
                env: entry.env ?? null,
                url: entry.url ?? null,
                createdBy: ctx.userId,
                manifestMeta: {
                    version: '1.0',
                    source: 'extension',
                    createdAt: new Date().toISOString(),
                    gitUrl: ctx.gitUrl,
                    gitRef: ctx.sha,
                    gitPath: ctx.manifestPath,
                    extensionName: ctx.extensionName,
                    serverKey: entry.name,
                    conventionFindings: conv.findings,
                    blockedByConvention,
                    tokensUsed: conv.tokensUsed,
                },
            });
            results.push({
                name: entry.name,
                serverId: inserted.id,
                transportType: entry.transportType,
                blockedByConvention,
                conventionFindings: conv.findings,
            });
        } catch (e) {
            results.push({ name: entry.name, error: e instanceof Error ? e.message : String(e) });
        }
    }
    return results;
}

/**
 * 저장된 번들 파일 목록을 스킬 본문 끝에 안내로 덧붙인다.
 *
 * 파일을 보존만 하면 모델은 그 존재를 모른다 — 본문의 "see references/rules.md" 는
 * 여전히 허공을 가리킨다. 목록과 여는 방법(`load_skill(asset_paths)`)을 명시해야
 * 참조가 실제로 이어진다. `skill_manifests.prompt_md`·checksum 도 함께 동기화한다
 * (주입 SoT 가 그쪽이라 어긋나면 안내가 반영되지 않는다).
 */
async function appendAssetIndex(pool: Pool, skillId: string, relPaths: string[]): Promise<void> {
    const list = relPaths.map(p => `- \`${p}\``).join('\n');
    const block = [
        '',
        '---',
        '',
        '> **[이 스킬에 딸린 파일]** 아래 파일이 함께 설치되어 있습니다. 내용이 필요하면',
        '> `load_skill` 을 이 스킬 이름과 `asset_paths: ["<경로>"]` 로 호출해 여세요.',
        '>',
        ...list.split('\n').map(l => `> ${l}`),
    ].join('\n');
    try {
        const r = await pool.query<{ content: string }>(
            `UPDATE agent_skills SET content = content || $2, updated_at = NOW()
              WHERE id = $1 RETURNING content`,
            [skillId, block],
        );
        const updated = r.rows[0]?.content;
        if (!updated) return;
        const checksum = crypto.createHash('sha256').update(updated).digest('hex');
        await pool.query(
            `UPDATE skill_manifests SET prompt_md = $2, checksum = $3 WHERE id = $1`,
            [skillId, updated, checksum],
        );
    } catch (e) {
        logger.warn(`번들 파일 안내 추가 실패 (fail-soft): ${skillId} — ${e instanceof Error ? e.message : String(e)}`);
    }
}

/** mcp_servers (user_id, name) unique 충돌 회피 — McpServerIngestService 관용구 동형. */
async function resolveUniqueServerName(pool: Pool, userId: string, name: string): Promise<string> {
    const base = name.slice(0, 100);
    const r = await pool.query<{ id: string }>(
        `SELECT id FROM mcp_servers WHERE user_id=$1 AND name=$2 LIMIT 1`,
        [userId, base]
    );
    if (r.rows.length === 0) return base;
    const suffix = crypto.randomBytes(3).toString('hex');
    return `${base.slice(0, 93)}-${suffix}`;
}

/** Custom Agent 이름 충돌 회피 — UNIQUE(user_id, name) 위반 방지 (MCP 서버명 규칙 동형). */
async function resolveUniqueAgentName(
    repo: UserAgentRepository, userId: string, name: string,
): Promise<string> {
    const base = name.slice(0, 100);
    if (!(await repo.existsByName(userId, base))) return base;
    const suffix = crypto.randomBytes(3).toString('hex');
    return `${base.slice(0, 93)}-${suffix}`;
}
