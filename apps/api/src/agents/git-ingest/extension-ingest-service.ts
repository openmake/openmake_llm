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
import { scanForExtensionManifests, scanForMarketplaceManifests, resolveExtensionRoot, type ManifestCandidate } from './repo-scanner';
import {
    validateExtensionManifest,
    parseMcpJsonFile,
    parseMarketplaceFile,
    type NormalizedMcpServer,
} from './extension-manifest-validator';
import { ConventionChecker, type ConventionFinding } from './convention-checker';
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
        let tree = await fetcher.listTree(owner, repo, sha, SKILL_CREATOR.gitMaxTreeEntries);
        let candidate: ManifestCandidate | undefined;

        // (3-a) marketplace.json 인덱스 (gitPath 미지정 시) — Claude Code 마켓플레이스 저장소
        if (!input.gitPath) {
            const mkCandidates = scanForMarketplaceManifests(tree.entries);
            if (mkCandidates.length > 0) {
                const mkRaw = await fetcher.fetchFile(owner, repo, sha, mkCandidates[0].path, EXTENSION_INGEST.manifestMaxBytes);
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
                        tree = await fetcher.listTree(owner, repo, sha, SKILL_CREATOR.gitMaxTreeEntries);
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
                    skillResults.push({ path, skillId: r.skillId, name: r.name, deduped: r.deduped });
                }
            } catch (e) {
                skillResults.push({ path, error: e instanceof Error ? e.message : String(e) });
            }
        }

        // (6-b) MCP servers — plugin.json mcpServers 우선, 없으면 <root>mcp.json / <root>.mcp.json
        let mcpEntries: NormalizedMcpServer[] = manifest.mcpServers;
        if (mcpEntries.length === 0) {
            const mcpJsonEntry = tree.entries.find(
                e => e.path === `${root}mcp.json` || e.path === `${root}.mcp.json`
            );
            if (mcpJsonEntry) {
                const mcpRaw = await fetcher.fetchFile(owner, repo, sha, mcpJsonEntry.path, EXTENSION_INGEST.manifestMaxBytes);
                const parsedMcp = parseMcpJsonFile(mcpRaw);
                if (parsedMcp.errors.length > 0) {
                    warnings.push(`MCP_JSON_INVALID: ${parsedMcp.errors.join('; ')}`);
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
                    const blockedByConvention = conv.findings.some(f => f.severity === 'error');
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

        // (7) 전 구성요소 실패/부재 검증
        const okSkills = skillResults.filter(r => r.skillId);
        const okServers = mcpResults.filter(r => r.serverId);
        if (okSkills.length === 0 && okServers.length === 0) {
            const detail = [...skillResults, ...mcpResults]
                .map(r => r.error)
                .filter(Boolean)
                .join('; ');
            throw new Error(`NO_COMPONENTS_INSTALLED: 설치 가능한 구성요소 없음${detail ? ` (${detail})` : ''}`);
        }

        // (8) user_extensions INSERT(신규) 또는 UPDATE(재설치) + 링크
        const componentManifest = {
            plugin: manifest.raw,
            components: { skills: skillResults, mcpServers: mcpResults },
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
        );

        logger.info(`extension-ingest ${updateTarget ? 'updated' : 'created'}: ${row.id} "${manifest.name}@${manifest.version}"${previousVersion ? ` (from ${previousVersion})` : ''} (${owner}/${repo}@${sha.slice(0, 7)}, skills=${okSkills.length}, mcp=${okServers.length})`);
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
            mcpServers: components.mcpServers ?? [],
            validationWarnings: [],
            deduped,
        };
    }
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 확장 루트 기준 SKILL.md 탐지 패턴 (순수 함수 — 테스트용 export).
 * 매칭: skills/<dir>/SKILL.md (Agent Plugins v1) · skill/SKILL.md (Qwen-MM-Plugins 등
 * 단수 레이아웃) · skills/SKILL.md. 하위 디렉토리 중첩은 1단계까지만.
 */
export function buildSkillDiscoveryPattern(root: string): RegExp {
    return new RegExp(`^${escapeRegExp(root)}skills?/(?:[^/]+/)?SKILL\\.md$`, 'i');
}
