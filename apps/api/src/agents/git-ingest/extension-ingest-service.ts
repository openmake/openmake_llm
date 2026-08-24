/**
 * ExtensionIngestService — Git URL → plugin.json (Agent Plugins v1) 확장 번들 설치.
 *
 * 흐름:
 *   1. parseGitUrl → owner/repo
 *   2. fetcher.resolveRef → sha
 *   3. fetcher.listTree → tree
 *   4. scanForExtensionManifests → candidates ((multi) selectionRequired 조기 반환)
 *   5. fetchFile plugin.json → validateExtensionManifest
 *   6. dedupe(source_hash) + active 설치 상한 + 동명 active 설치 충돌 검사
 *   7. 구성요소 수집:
 *      - skills:  <root>skills/<dir>/SKILL.md → GitIngestService.import 체인 (기존 draft 파이프라인 재사용)
 *      - mcp:     plugin.json mcpServers > <root>mcp.json — ConventionChecker.checkMcpServer 후
 *                 McpServerDraftRepository.insertDraft (draft + enabled=false + user_private 3중 잠금)
 *   8. user_extensions INSERT + 구성요소 extension_id 링크
 *
 * 구성요소는 각자 기존 draft→approve 라이프사이클을 그대로 따른다 — 이 서비스는
 * 번들 단위 설치/기록만 담당하고 새 승인 경로를 만들지 않는다.
 *
 * @module agents/git-ingest/extension-ingest-service
 */
import * as crypto from 'crypto';
import type { Pool } from 'pg';
import type { LLMClient } from '../../llm/client';
import { createLogger } from '../../utils/logger';
import { parseGitUrl } from '../../schemas/git-ingest.schema';
import type { ImportExtensionFromGitInput } from '../../schemas/extension-ingest.schema';
import { GitFetcher } from './git-fetcher';
import { ArchiveFetcher, isArchiveUrl, archivePseudoRepo } from './archive-fetcher';
import { fetchCatalogSnapshot as fetchCatalogSnapshotImpl, buildSkillDiscoveryPattern, type CatalogSnapshot } from './catalog-snapshot';
import { translateCatalogDescriptions } from './catalog-translator';
// 기존 import 경로 호환 재노출 (테스트 등이 이 모듈에서 import)
export { buildSkillDiscoveryPattern } from './catalog-snapshot';
import { scanForExtensionManifests, scanForMarketplaceManifests, resolveExtensionRoot, detectUnsupportedComponents, type ManifestCandidate } from './repo-scanner';
import {
    validateExtensionManifest,
    parseMcpJsonFile,
    parseMarketplaceFile,
    type NormalizedMcpServer,
} from './extension-manifest-validator';
import { ConventionChecker, isBlockedByConvention, type ConventionFinding } from './convention-checker';
import { commandFileToSkillMarkdown, agentFileToCustomAgent } from './plugin-component-compat';
import { UserAgentRepository } from '../../data/repositories/user-agent-repository';
import { SkillAssetRepository } from '../../data/repositories/skill-asset-repository';
import { PLUGIN_COMPONENT_LIMITS, UNSUPPORTED_AGENT_FIELDS } from '../../config/skill-compat';
import { v4 as uuidv4 } from 'uuid';
import { GitIngestService } from './git-ingest-service';
import { McpServerDraftRepository } from '../../data/repositories/mcp-server-draft-repository';
import { UserExtensionRepository } from '../../data/repositories/user-extension-repository';
import { EXTENSION_INGEST, SKILL_CREATOR } from '../../config/constants';

const logger = createLogger('ExtensionIngestService');

export interface ImportInput extends ImportExtensionFromGitInput {
    userId: string;
    isAdmin: boolean;
}

export interface SkillInstallResult {
    path: string;
    skillId?: string;
    name?: string;
    deduped?: boolean;
    /** 설치 시 적응(호환 변환) 요약 — skill-compat */
    compatNotes?: string[];
    /** commands/<name>.md 를 스킬로 변환한 경우 */
    fromCommand?: boolean;
    /** 함께 저장된 번들 파일 (scripts/·references/·assets/) 상대 경로 */
    assets?: string[];
    error?: string;
}

export interface AgentInstallResult {
    /** agents/<name>.md 경로 */
    path: string;
    /** 원문 name (충돌 회피 전) */
    name: string;
    agentId?: string;
    /** 실제 저장된 이름 (충돌 시 prefix/suffix 적용) */
    storedName?: string;
    /** 이 환경이 적용하지 않는 원문 필드 안내 */
    ignoredFields?: string[];
    error?: string;
}

export interface McpServerInstallResult {
    name: string;
    serverId?: string;
    transportType?: 'stdio' | 'streamable-http';
    blockedByConvention?: boolean;
    conventionFindings?: ConventionFinding[];
    error?: string;
}

export interface ImportResult {
    extensionId: string;
    name: string;
    version: string;
    description: string;
    status: 'active';
    source: 'git-url';
    gitUrl: string;
    gitRef: string;
    gitPath: string;
    skills: SkillInstallResult[];
    mcpServers: McpServerInstallResult[];
    /** agents/*.md → Custom Agent (Phase 2) */
    agents: AgentInstallResult[];
    validationWarnings: string[];
    deduped: boolean;
    /** 동일 소스 재설치인데 source_ref 가 이미 최신 — 아무것도 변경 안 함 */
    upToDate?: boolean;
    /** 동일 이름·동일 소스 재설치 → 기존 설치를 새 ref 로 교체 (구 구성요소 archive) */
    updated?: boolean;
    previousVersion?: string;
    selectionRequired?: false;
    candidates?: never;
}

export interface UpdateCheckResult {
    updateAvailable: boolean;
    currentRef: string;
    latestRef: string;
    /** 최신 ref 의 plugin.json version (조회 실패 시 null) */
    latestVersion: string | null;
}

export interface CandidateListResult {
    gitUrl: string;
    gitRef: string;
    candidates: ManifestCandidate[];
    totalCandidates: number;
    selectionRequired: true;
    /** marketplace.json 인덱스 발견 시 — plugin 인자로 이름을 지정해 재호출 */
    marketplace?: {
        name: string;
        plugins: Array<{ name: string; description?: string }>;
    };
}

export interface ExtensionIngestOptions {
    pool: Pool;
    llmClientFactory: (model: string) => LLMClient;
    fetcherFactory: (opts: { accessToken?: string }) => GitFetcher;
    /** .zip 아카이브 소스용 fetcher (테스트 주입용 — 기본은 ArchiveFetcher) */
    archiveFetcherFactory?: (url: string) => GitFetcher;
}

export class ExtensionIngestService {
    constructor(private opts: ExtensionIngestOptions) {}

    /** .zip 아카이브 fetcher 생성 — GitFetcher 동형 (duck-typed). */
    private makeArchiveFetcher(url: string): GitFetcher {
        if (this.opts.archiveFetcherFactory) return this.opts.archiveFetcherFactory(url);
        return new ArchiveFetcher(url, {
            maxArchiveBytes: EXTENSION_INGEST.archiveMaxBytes,
            maxEntries: EXTENSION_INGEST.archiveMaxEntries,
            maxTotalBytes: EXTENSION_INGEST.archiveMaxTotalBytes,
        }) as unknown as GitFetcher;
    }

    async import(input: ImportInput): Promise<ImportResult | CandidateListResult> {
        if (!EXTENSION_INGEST.enabled) {
            throw new Error('EXTENSION_INGEST_DISABLED');
        }

        // (1) URL parse — .zip 아카이브 URL 은 pseudo repo (ArchiveFetcher 가 owner/repo 무시)
        const isArchive = isArchiveUrl(input.gitUrl);
        const parsed = isArchive ? archivePseudoRepo(input.gitUrl) : parseGitUrl(input.gitUrl);
        if (!parsed) throw new Error(`INVALID_GIT_URL: ${input.gitUrl}`);
        let { owner, repo } = parsed;
        // marketplace 엔트리가 다른 저장소/고정 ref 를 가리킬 수 있어 effective 값으로 관리
        let effectiveGitUrl = input.gitUrl;
        // 아카이브는 ref 개념이 없음 — tracking_ref=null, 업데이트 확인은 재다운로드 해시 비교
        let effectiveTrackingRef: string | null = isArchive ? null : (input.gitRef ?? null);

        // (2) fetcher — 아카이브면 safeFetch 기반 ArchiveFetcher (SSRF 가드 + 압축 폭탄 방어)
        const fetcher = isArchive
            ? this.makeArchiveFetcher(input.gitUrl)
            : this.opts.fetcherFactory({ accessToken: input.accessToken });
        let sha = await fetcher.resolveRef(owner, repo, input.gitRef ?? 'HEAD');

        // (3) tree
        let tree = await fetcher.listTree(owner, repo, sha, EXTENSION_INGEST.maxTreeEntries);
        let candidate: ManifestCandidate | undefined;

        // (3-a) marketplace.json 인덱스 (gitPath 미지정 시) — Claude Code 마켓플레이스 저장소
        if (!input.gitPath) {
            const mkCandidates = scanForMarketplaceManifests(tree.entries);
            if (mkCandidates.length > 0) {
                const mkRaw = await fetcher.fetchFile(owner, repo, sha, mkCandidates[0].path, EXTENSION_INGEST.marketplaceMaxBytes);
                const mk = parseMarketplaceFile(mkRaw);
                if (mk.ok && !input.plugin) {
                    // 목록만 반환 — plugin 인자로 재호출 유도
                    return {
                        gitUrl: input.gitUrl,
                        gitRef: sha,
                        candidates: [],
                        totalCandidates: mk.marketplace.plugins.length,
                        selectionRequired: true,
                        marketplace: {
                            name: mk.marketplace.name,
                            plugins: mk.marketplace.plugins.map(p => ({ name: p.name, description: p.description })),
                        },
                    };
                }
                if (mk.ok && input.plugin) {
                    const entry = mk.marketplace.plugins.find(p => p.name === input.plugin);
                    if (!entry) {
                        throw new Error(`PLUGIN_NOT_IN_MARKETPLACE: "${input.plugin}" — 가능한 플러그인: ${mk.marketplace.plugins.map(p => p.name).join(', ')}`);
                    }
                    // 다른 저장소를 가리키는 엔트리 (git-subdir url)
                    if (entry.url) {
                        const p2 = parseGitUrl(entry.url);
                        if (p2 && (p2.owner !== owner || p2.repo !== repo)) {
                            owner = p2.owner;
                            repo = p2.repo;
                            effectiveGitUrl = entry.url;
                        }
                    }
                    // 고정 ref (릴리스 태그) 또는 저장소 변경 시 tree 재조회
                    if (entry.ref || effectiveGitUrl !== input.gitUrl) {
                        sha = await fetcher.resolveRef(owner, repo, entry.ref ?? 'HEAD');
                        tree = await fetcher.listTree(owner, repo, sha, EXTENSION_INGEST.maxTreeEntries);
                    }
                    if (entry.ref) effectiveTrackingRef = entry.ref;
                    const prefix = entry.path ? `${entry.path}/` : '';
                    const pj = tree.entries.find(e => e.path === `${prefix}.claude-plugin/plugin.json`)
                        ?? tree.entries.find(e => e.path === `${prefix}plugin.json`);
                    if (!pj) {
                        throw new Error(`MARKETPLACE_PLUGIN_MANIFEST_NOT_FOUND: "${input.plugin}" (path=${entry.path || '.'}, ref=${sha.slice(0, 7)})`);
                    }
                    candidate = { path: pj.path, sha: pj.sha, size: pj.size };
                    logger.info(`marketplace plugin resolved: ${input.plugin} → ${owner}/${repo}@${sha.slice(0, 7)}:${pj.path}`);
                }
                // mk 파싱 실패 → 일반 plugin.json 스캔으로 폴백
            }
        }

        // (3-b) 일반 plugin.json 스캔 (marketplace 미해당)
        if (!candidate) {
            const candidates = scanForExtensionManifests(tree.entries, input.gitPath);
            if (candidates.length === 0) {
                // 잘못된 gitPath 로 마켓플레이스 분기를 우회한 경우 — plugin 인자 사용을 안내해
                // 도구 루프 내 자가 교정 유도 (2026-08-16 라이브 실측: 모델이 gitPath 를 지어냄)
                const mk = scanForMarketplaceManifests(tree.entries);
                if (mk.length > 0) {
                    throw new Error(`NO_EXTENSION_FOUND: 해당 gitPath 에 plugin.json 없음. 이 저장소는 마켓플레이스(.claude-plugin/marketplace.json)입니다 — gitPath 대신 plugin 인자로 플러그인 이름을 지정해 재호출하세요. 예: import_extension_from_git({ gitUrl: "${input.gitUrl}", plugin: "<플러그인 이름>" }) (gitPath/gitRef 는 생략)`);
                }
                throw new Error(`NO_EXTENSION_FOUND: tree 에 plugin.json 후보 없음 (gitUrl=${input.gitUrl}, ref=${sha})`);
            }
            if (candidates.length > 1 && !input.gitPath) {
                return {
                    gitUrl: input.gitUrl,
                    gitRef: sha,
                    candidates,
                    totalCandidates: candidates.length,
                    selectionRequired: true,
                };
            }
            candidate = candidates[0];
        }

        // (4) plugin.json fetch + validate
        const manifestRaw = await fetcher.fetchFile(owner, repo, sha, candidate.path, EXTENSION_INGEST.manifestMaxBytes);
        const validation = validateExtensionManifest(manifestRaw);
        if (!validation.ok) {
            throw new Error(`INVALID_EXTENSION_MANIFEST: ${validation.errors.join('; ')}`);
        }
        const manifest = validation.manifest;
        const root = resolveExtensionRoot(candidate.path);

        // (5) dedupe + 상한 + 동명 충돌
        const sourceHash = 'sha256:' + crypto.createHash('sha256')
            .update(JSON.stringify({ uid: input.userId, url: effectiveGitUrl, sha, path: candidate.path }))
            .digest('hex');
        const extRepo = new UserExtensionRepository(this.opts.pool);

        const existing = await extRepo.findRecentByHash(input.userId, sourceHash, EXTENSION_INGEST.dedupeWindowHours);
        if (existing) {
            logger.info(`extension-ingest dedupe hit: ${existing.id}`);
            return this.shapeFromRow(existing, true);
        }

        // 동일 이름 active 설치: 같은 소스(같은 repo 또는 같은 아카이브 URL)면 업데이트 모드, 다른 소스면 충돌
        const sameName = await extRepo.findActiveByName(input.userId, manifest.name);
        let updateTarget: typeof sameName = null;
        if (sameName) {
            const prevParsed = isArchive ? null : parseGitUrl(sameName.source_url);
            const sameSource = isArchive
                ? sameName.source_url === effectiveGitUrl
                : !!(prevParsed && prevParsed.owner === owner && prevParsed.repo === repo);
            if (sameSource) {
                if (sameName.source_ref === sha) {
                    // 이미 최신 — 변경 없음
                    return { ...this.shapeFromRow(sameName, false), upToDate: true };
                }
                updateTarget = sameName;
            } else {
                throw new Error(`EXTENSION_ALREADY_INSTALLED: "${manifest.name}" 이 다른 소스(${sameName.source_url})로 이미 설치됨 (${sameName.id}) — 먼저 제거 후 재설치하세요`);
            }
        }

        if (!updateTarget) {
            const activeCount = await extRepo.countActiveForUser(input.userId);
            if (activeCount >= EXTENSION_INGEST.maxPerUser) {
                throw new Error(`EXTENSION_LIMIT_EXCEEDED: ${activeCount}/${EXTENSION_INGEST.maxPerUser}`);
            }
        }

        const warnings: string[] = [];

        // (5-c) 이 환경이 설치하지 않는 구성요소 — 조용히 무시하지 않고 리포트한다
        const unsupported = detectUnsupportedComponents(tree.entries, root, manifest.raw);
        if (unsupported.length > 0) {
            warnings.push(`UNSUPPORTED_COMPONENTS: ${unsupported.join(', ')} — 이 환경에 대응 개념이 없어 설치되지 않았습니다`);
        }
        // plugin.json mcpServers 항목 단위 사유 (설치는 나머지 항목으로 계속)
        if (manifest.mcpWarnings.length > 0) {
            warnings.push(`MCP_ENTRIES_SKIPPED: ${manifest.mcpWarnings.join('; ')}`);
        }

        // (6-a) skills — <root>skills/<dir>/SKILL.md (Agent Plugins v1: 직계 하위만)
        const skillPattern = buildSkillDiscoveryPattern(root);
        let skillPaths = tree.entries.filter(e => skillPattern.test(e.path)).map(e => e.path);
        if (skillPaths.length > EXTENSION_INGEST.maxSkillsPerExtension) {
            warnings.push(`SKILLS_TRUNCATED: ${skillPaths.length}개 중 ${EXTENSION_INGEST.maxSkillsPerExtension}개만 설치`);
            skillPaths = skillPaths.slice(0, EXTENSION_INGEST.maxSkillsPerExtension);
        }
        const skillResults: SkillInstallResult[] = [];
        const skillService = new GitIngestService({
            pool: this.opts.pool,
            llmClientFactory: this.opts.llmClientFactory,
            // 아카이브 소스면 이미 로드된 동일 ArchiveFetcher 재사용 (재다운로드 방지)
            fetcherFactory: isArchive ? () => fetcher : this.opts.fetcherFactory,
            // 거대 마켓플레이스 repo — 확장 경로 상한으로 재조회 (스킬 ingest 기본 상한이면 REPO_TOO_LARGE)
            maxTreeEntries: EXTENSION_INGEST.maxTreeEntries,
        });
        for (const path of skillPaths) {
            try {
                const r = await skillService.import({
                    userId: input.userId,
                    isAdmin: input.isAdmin,
                    gitUrl: effectiveGitUrl,
                    gitRef: sha,
                    gitPath: path,
                    accessToken: input.accessToken,
                    target: 'user',
                });
                if ('selectionRequired' in r && r.selectionRequired) {
                    // explicit gitPath 라 도달 불가하지만 방어
                    skillResults.push({ path, error: 'unexpected multi-candidate' });
                } else {
                    skillResults.push({
                        path, skillId: r.skillId, name: r.name, deduped: r.deduped,
                        ...(r.compatNotes.length > 0 ? { compatNotes: r.compatNotes } : {}),
                    });
                }
            } catch (e) {
                skillResults.push({ path, error: e instanceof Error ? e.message : String(e) });
            }
        }

        // (6-a2) commands/<name>.md → 스킬 (Phase 2)
        // openmake 는 슬래시 명령이 곧 스킬 매칭이라 등가물이다. name 프론트매터가 없어
        // (파일명이 명령 이름) SKILL.md 규격으로 정규화한 뒤 같은 파이프라인에 태운다.
        const commandPattern = new RegExp(`^${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}commands/(?:[^/]+/)?[^/]+\\.md$`, 'i');
        let commandPaths = tree.entries.filter(e => commandPattern.test(e.path)).map(e => e.path);
        if (commandPaths.length > PLUGIN_COMPONENT_LIMITS.maxCommands) {
            warnings.push(`COMMANDS_TRUNCATED: ${commandPaths.length}개 중 ${PLUGIN_COMPONENT_LIMITS.maxCommands}개만 설치`);
            commandPaths = commandPaths.slice(0, PLUGIN_COMPONENT_LIMITS.maxCommands);
        }
        for (const path of commandPaths) {
            try {
                const raw = await fetcher.fetchFile(owner, repo, sha, path, SKILL_CREATOR.gitMaxFileSize ?? 262144);
                const normalized = commandFileToSkillMarkdown(path, raw);
                const r = await skillService.import({
                    userId: input.userId,
                    isAdmin: input.isAdmin,
                    gitUrl: effectiveGitUrl,
                    gitRef: sha,
                    gitPath: path,
                    accessToken: input.accessToken,
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
        if (commandPaths.length > 0) {
            const ok = skillResults.filter(r => r.fromCommand && r.skillId).length;
            warnings.push(`COMMANDS_CONVERTED: 슬래시 명령 ${ok}개를 스킬로 변환 (\`/이름\` 으로 호출)`);
        }

        // (6-a3) 스킬 번들 파일 — SKILL.md 와 같은 디렉토리의 scripts/·references/·assets/
        // 본문이 "run scripts/check.py" 라고 지시하는데 파일이 없던 상태를 해소한다.
        await this.collectSkillAssets({
            fetcher, owner, repo, sha, tree,
            skillResults, warnings,
        });

        // (6-b) MCP servers — plugin.json mcpServers 우선, 없으면 <root>mcp.json / <root>.mcp.json
        let mcpEntries: NormalizedMcpServer[] = manifest.mcpServers;
        if (mcpEntries.length === 0) {
            const mcpJsonEntry = tree.entries.find(
                e => e.path === `${root}mcp.json` || e.path === `${root}.mcp.json`
            );
            if (mcpJsonEntry) {
                const mcpRaw = await fetcher.fetchFile(owner, repo, sha, mcpJsonEntry.path, EXTENSION_INGEST.manifestMaxBytes);
                const parsedMcp = parseMcpJsonFile(mcpRaw);
                // 항목 단위 — 일부 실패해도 나머지는 설치된다 (upstream 의 빈 url placeholder 등)
                if (parsedMcp.errors.length > 0) {
                    warnings.push(`MCP_ENTRIES_SKIPPED: ${parsedMcp.errors.join('; ')}`);
                }
                if (parsedMcp.warnings.length > 0) {
                    warnings.push(`MCP_FIELDS_IGNORED: ${parsedMcp.warnings.join('; ')}`);
                }
                mcpEntries = parsedMcp.servers;
            }
        }
        if (mcpEntries.length > EXTENSION_INGEST.maxMcpServersPerExtension) {
            warnings.push(`MCP_SERVERS_TRUNCATED: ${mcpEntries.length}개 중 ${EXTENSION_INGEST.maxMcpServersPerExtension}개만 설치`);
            mcpEntries = mcpEntries.slice(0, EXTENSION_INGEST.maxMcpServersPerExtension);
        }
        const mcpResults: McpServerInstallResult[] = [];
        if (mcpEntries.length > 0) {
            const checker = new ConventionChecker(this.opts.llmClientFactory(SKILL_CREATOR.authorModel));
            const draftRepo = new McpServerDraftRepository(this.opts.pool);
            for (const entry of mcpEntries) {
                try {
                    const conv = await checker.checkMcpServer(
                        JSON.stringify(entry, null, 2),
                        '',
                        { command: entry.command, args: entry.args },
                    );
                    const blockedByConvention = isBlockedByConvention(conv.findings);
                    const finalName = await this.resolveUniqueServerName(input.userId, `${manifest.name}-${entry.name}`);
                    const inserted = await draftRepo.insertDraft({
                        name: finalName,
                        transportType: entry.transportType,
                        command: entry.command ?? null,
                        args: entry.args ?? null,
                        env: entry.env ?? null,
                        url: entry.url ?? null,
                        createdBy: input.userId,
                        manifestMeta: {
                            version: '1.0',
                            source: 'extension',
                            createdAt: new Date().toISOString(),
                            gitUrl: effectiveGitUrl,
                            gitRef: sha,
                            gitPath: candidate.path,
                            extensionName: manifest.name,
                            serverKey: entry.name,
                            conventionFindings: conv.findings,
                            blockedByConvention,
                            tokensUsed: conv.tokensUsed,
                        },
                    });
                    mcpResults.push({
                        name: entry.name,
                        serverId: inserted.id,
                        transportType: entry.transportType,
                        blockedByConvention,
                        conventionFindings: conv.findings,
                    });
                } catch (e) {
                    mcpResults.push({ name: entry.name, error: e instanceof Error ? e.message : String(e) });
                }
            }
        }

        // (6-c) agents/<name>.md → Custom Agent (Phase 2)
        // 본문이 곧 시스템 프롬프트다. 스킬/MCP 와 달리 실행 권한이 없고 사용자가 명시
        // 선택할 때만 적용되는 페르소나라 승인 게이트 없이 즉시 활성으로 만든다.
        const agentPattern = new RegExp(`^${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}agents/(?:[^/]+/)?[^/]+\\.md$`, 'i');
        let agentPaths = tree.entries.filter(e => agentPattern.test(e.path)).map(e => e.path);
        if (agentPaths.length > PLUGIN_COMPONENT_LIMITS.maxAgents) {
            warnings.push(`AGENTS_TRUNCATED: ${agentPaths.length}개 중 ${PLUGIN_COMPONENT_LIMITS.maxAgents}개만 설치`);
            agentPaths = agentPaths.slice(0, PLUGIN_COMPONENT_LIMITS.maxAgents);
        }
        const agentResults: AgentInstallResult[] = [];
        if (agentPaths.length > 0) {
            const agentRepo = new UserAgentRepository(this.opts.pool);
            for (const path of agentPaths) {
                try {
                    const raw = await fetcher.fetchFile(owner, repo, sha, path, SKILL_CREATOR.gitMaxFileSize ?? 262144);
                    const parsedAgent = agentFileToCustomAgent(path, raw);
                    if (!parsedAgent.systemPrompt || parsedAgent.systemPrompt.length < 10) {
                        agentResults.push({ path, name: parsedAgent.name, error: '시스템 프롬프트가 비어있음' });
                        continue;
                    }
                    const storedName = await this.resolveUniqueAgentName(
                        agentRepo, input.userId, `${manifest.name}-${parsedAgent.name}`,
                    );
                    const ignoredFields = Object.keys(parsedAgent.upstreamFields)
                        .filter(k => k in UNSUPPORTED_AGENT_FIELDS)
                        .map(k => UNSUPPORTED_AGENT_FIELDS[k]);
                    const created = await agentRepo.create({
                        id: uuidv4(),
                        userId: input.userId,
                        name: storedName,
                        description: parsedAgent.description,
                        systemPrompt: parsedAgent.systemPrompt,
                        extensionId: null,   // linkComponents 가 이어서 연결
                    });
                    agentResults.push({
                        path, name: parsedAgent.name, agentId: created.id, storedName,
                        ...(ignoredFields.length > 0 ? { ignoredFields } : {}),
                    });
                } catch (e) {
                    agentResults.push({ path, name: path, error: e instanceof Error ? e.message : String(e) });
                }
            }
            const okAgents = agentResults.filter(r => r.agentId);
            if (okAgents.length > 0) {
                warnings.push(`AGENTS_CONVERTED: 서브에이전트 ${okAgents.length}개를 Custom Agent 로 변환 (즉시 사용 가능)`);
            }
            const ignored = [...new Set(agentResults.flatMap(r => r.ignoredFields ?? []))];
            if (ignored.length > 0) {
                warnings.push(`AGENT_FIELDS_IGNORED: ${ignored.join(', ')} — 이 환경은 시스템 프롬프트만 사용합니다`);
            }
        }

        // 스킬 적응 요약 — 확장 단위 리포트에 합류 (구성요소별 상세는 skills[].compatNotes)
        const adaptedSkills = skillResults.filter(r => r.compatNotes && r.compatNotes.length > 0);
        if (adaptedSkills.length > 0) {
            warnings.push(`SKILLS_ADAPTED: ${adaptedSkills.length}개 스킬에 호환 안내 주입 (${adaptedSkills.map(r => r.name ?? r.path).join(', ')})`);
        }

        // (7) 전 구성요소 실패/부재 검증
        const okSkills = skillResults.filter(r => r.skillId);
        const okServers = mcpResults.filter(r => r.serverId);
        const okAgentResults = agentResults.filter(r => r.agentId);
        if (okSkills.length === 0 && okServers.length === 0 && okAgentResults.length === 0) {
            const detail = [...skillResults, ...mcpResults, ...agentResults]
                .map(r => r.error)
                .filter(Boolean)
                .join('; ');
            throw new Error(`NO_COMPONENTS_INSTALLED: 설치 가능한 구성요소 없음${detail ? ` (${detail})` : ''}`);
        }

        // (8) user_extensions INSERT(신규) 또는 UPDATE(재설치) + 링크
        const componentManifest = {
            plugin: manifest.raw,
            components: { skills: skillResults, mcpServers: mcpResults, agents: agentResults },
            // 설치 리포트 — 미지원 구성요소·건너뛴 MCP 항목·스킬 적응 (상세 UI 노출)
            warnings,
        };
        let row;
        let previousVersion: string | undefined;
        if (updateTarget) {
            previousVersion = updateTarget.version;
            await extRepo.archiveLinkedComponents(updateTarget.id);
            row = await extRepo.updateAfterReinstall(updateTarget.id, {
                version: manifest.version,
                description: manifest.description ?? null,
                sourceRef: sha,
                sourcePath: candidate.path,
                sourceHash,
                trackingRef: effectiveTrackingRef,
                manifest: componentManifest,
            });
            if (!row) throw new Error(`EXTENSION_UPDATE_FAILED: ${updateTarget.id} 갱신 실패`);
        } else {
            row = await extRepo.insert({
                userId: input.userId,
                name: manifest.name,
                version: manifest.version,
                description: manifest.description ?? null,
                sourceUrl: effectiveGitUrl,
                sourceRef: sha,
                sourcePath: candidate.path,
                sourceHash,
                trackingRef: effectiveTrackingRef,
                manifest: componentManifest,
            });
        }
        await extRepo.linkComponents(
            row.id,
            okSkills.map(r => r.skillId!),
            okServers.map(r => r.serverId!),
            okAgentResults.map(r => r.agentId!),
        );

        logger.info(`extension-ingest ${updateTarget ? 'updated' : 'created'}: ${row.id} "${manifest.name}@${manifest.version}"${previousVersion ? ` (from ${previousVersion})` : ''} (${owner}/${repo}@${sha.slice(0, 7)}, skills=${okSkills.length}, mcp=${okServers.length}, agents=${okAgentResults.length})`);
        return {
            extensionId: row.id,
            name: manifest.name,
            version: manifest.version,
            description: manifest.description ?? '',
            status: 'active',
            source: 'git-url',
            gitUrl: effectiveGitUrl,
            gitRef: sha,
            gitPath: candidate.path,
            skills: skillResults,
            mcpServers: mcpResults,
            agents: agentResults,
            validationWarnings: warnings,
            deduped: false,
            ...(updateTarget ? { updated: true, previousVersion } : {}),
        };
    }

    /**
     * 업데이트 확인 — tracking_ref(NULL=HEAD)를 다시 resolve 해 설치된 source_ref 와 비교.
     * 변경이 있으면 최신 ref 의 plugin.json version 도 조회 (실패 시 null, fail-open).
     */
    async checkForUpdate(input: {
        sourceUrl: string;
        sourcePath: string;
        currentRef: string;
        trackingRef?: string | null;
        accessToken?: string;
    }): Promise<UpdateCheckResult> {
        // 아카이브 소스: 재다운로드 sha256 을 latestRef 로 사용 (내용 변경 감지)
        const isArchive = isArchiveUrl(input.sourceUrl);
        const parsed = isArchive ? archivePseudoRepo(input.sourceUrl) : parseGitUrl(input.sourceUrl);
        if (!parsed) throw new Error(`INVALID_GIT_URL: ${input.sourceUrl}`);
        const fetcher = isArchive
            ? this.makeArchiveFetcher(input.sourceUrl)
            : this.opts.fetcherFactory({ accessToken: input.accessToken });
        const latestRef = await fetcher.resolveRef(parsed.owner, parsed.repo, input.trackingRef ?? 'HEAD');
        if (latestRef === input.currentRef) {
            return { updateAvailable: false, currentRef: input.currentRef, latestRef, latestVersion: null };
        }
        let latestVersion: string | null = null;
        try {
            const raw = await fetcher.fetchFile(parsed.owner, parsed.repo, latestRef, input.sourcePath, EXTENSION_INGEST.manifestMaxBytes);
            const validation = validateExtensionManifest(raw);
            if (validation.ok) latestVersion = validation.manifest.version;
        } catch {
            /* 최신 버전 조회 실패 — updateAvailable 판정에는 영향 없음 */
        }
        return { updateAvailable: true, currentRef: input.currentRef, latestRef, latestVersion };
    }

    /**
     * 카탈로그 스냅샷 (admin 큐레이션 갤러리) — catalog-snapshot.ts 위임.
     * 판정 규칙·형식은 그 모듈 doc 참고 (600줄 파일 가드 분할).
     */
    async fetchCatalogSnapshot(url: string, accessToken?: string): Promise<CatalogSnapshot> {
        return fetchCatalogSnapshotImpl({
            fetcherFactory: this.opts.fetcherFactory,
            archiveFetcherFor: (u) => this.makeArchiveFetcher(u),
        }, url, accessToken);
    }

    /**
     * 카탈로그 설명 한국어 번역 — catalog-translator.ts 위임 (fail-open, snapshot mutate).
     * previous 를 주면 (name, description) 일치 항목의 기존 번역을 재사용한다.
     */
    async translateCatalogSnapshot(
        snapshot: CatalogSnapshot,
        previous?: Array<{ name: string; description?: string; description_ko?: string }>,
    ): Promise<void> {
        const llm = this.opts.llmClientFactory(SKILL_CREATOR.authorModel);
        await translateCatalogDescriptions(llm, snapshot.plugins, previous);
    }

    /** mcp_servers (user_id, name) unique 충돌 회피 — McpServerIngestService 관용구 동형. */
    private async resolveUniqueServerName(userId: string, name: string): Promise<string> {
        const base = name.slice(0, 100);
        const r = await this.opts.pool.query<{ id: string }>(
            `SELECT id FROM mcp_servers WHERE user_id=$1 AND name=$2 LIMIT 1`,
            [userId, base]
        );
        if (r.rows.length === 0) return base;
        const suffix = crypto.randomBytes(3).toString('hex');
        return `${base.slice(0, 93)}-${suffix}`;
    }

    /**
     * 스킬 번들 파일 수집 — SKILL.md 와 같은 디렉토리의 `scripts/`·`references/`·`assets/`.
     *
     * 외부 스킬 본문은 "see references/rules.md" 처럼 딸린 파일을 참조하는데 ingest 는
     * SKILL.md 한 장만 가져와 참조 대상이 없었다. 원본 바이트를 skill_assets 에 보존해
     * 목록 안내와 에이전트 작업 샌드박스 주입에 쓴다. 실패는 fail-soft — 스킬 설치는 유지.
     */
    private async collectSkillAssets(ctx: {
        fetcher: GitFetcher;
        owner: string;
        repo: string;
        sha: string;
        tree: { entries: Array<{ path: string; size: number }> };
        skillResults: SkillInstallResult[];
        warnings: string[];
    }): Promise<void> {
        const assetRepo = new SkillAssetRepository(this.opts.pool);
        for (const result of ctx.skillResults) {
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
                await this.appendAssetIndex(result.skillId, stored);
                ctx.warnings.push(`ASSETS_STORED: ${result.name ?? result.path} 번들 파일 ${stored.length}개 보존 (${stored.slice(0, 5).join(', ')}${stored.length > 5 ? ' …' : ''})`);
            }
        }
    }

    /**
     * 저장된 번들 파일 목록을 스킬 본문 끝에 안내로 덧붙인다.
     *
     * 파일을 보존만 하면 모델은 그 존재를 모른다 — 본문의 "see references/rules.md" 는
     * 여전히 허공을 가리킨다. 목록과 여는 방법(`load_skill(asset_paths)`)을 명시해야
     * 참조가 실제로 이어진다. `skill_manifests.prompt_md`·checksum 도 함께 동기화한다
     * (주입 SoT 가 그쪽이라 어긋나면 안내가 반영되지 않는다).
     */
    private async appendAssetIndex(skillId: string, relPaths: string[]): Promise<void> {
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
            const r = await this.opts.pool.query<{ content: string }>(
                `UPDATE agent_skills SET content = content || $2, updated_at = NOW()
                  WHERE id = $1 RETURNING content`,
                [skillId, block],
            );
            const updated = r.rows[0]?.content;
            if (!updated) return;
            const checksum = crypto.createHash('sha256').update(updated).digest('hex');
            await this.opts.pool.query(
                `UPDATE skill_manifests SET prompt_md = $2, checksum = $3 WHERE id = $1`,
                [skillId, updated, checksum],
            );
        } catch (e) {
            logger.warn(`번들 파일 안내 추가 실패 (fail-soft): ${skillId} — ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    /** Custom Agent 이름 충돌 회피 — UNIQUE(user_id, name) 위반 방지 (MCP 서버명 규칙 동형). */
    private async resolveUniqueAgentName(
        repo: UserAgentRepository, userId: string, name: string,
    ): Promise<string> {
        const base = name.slice(0, 100);
        if (!(await repo.existsByName(userId, base))) return base;
        const suffix = crypto.randomBytes(3).toString('hex');
        return `${base.slice(0, 93)}-${suffix}`;
    }

    /** dedupe hit 시 기존 설치 레코드를 ImportResult shape 로 변환. */
    private shapeFromRow(
        row: {
            id: string; name: string; version: string; description: string | null;
            source_url: string; source_ref: string; source_path: string;
            manifest: Record<string, unknown>;
        },
        deduped: boolean,
    ): ImportResult {
        const components = (row.manifest?.components ?? {}) as {
            skills?: SkillInstallResult[];
            mcpServers?: McpServerInstallResult[];
            agents?: AgentInstallResult[];
        };
        return {
            extensionId: row.id,
            name: row.name,
            version: row.version,
            description: row.description ?? '',
            status: 'active',
            source: 'git-url',
            gitUrl: row.source_url,
            gitRef: row.source_ref,
            gitPath: row.source_path,
            skills: components.skills ?? [],
            agents: components.agents ?? [],
            mcpServers: components.mcpServers ?? [],
            validationWarnings: [],
            deduped,
        };
    }
}
