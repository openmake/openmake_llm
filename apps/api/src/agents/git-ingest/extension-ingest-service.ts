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
import { scanForExtensionManifests, resolveExtensionRoot, type ManifestCandidate } from './repo-scanner';
import {
    validateExtensionManifest,
    parseMcpJsonFile,
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
    selectionRequired?: false;
    candidates?: never;
}

export interface CandidateListResult {
    gitUrl: string;
    gitRef: string;
    candidates: ManifestCandidate[];
    totalCandidates: number;
    selectionRequired: true;
}

export interface ExtensionIngestOptions {
    pool: Pool;
    llmClientFactory: (model: string) => LLMClient;
    fetcherFactory: (opts: { accessToken?: string }) => GitFetcher;
}

export class ExtensionIngestService {
    constructor(private opts: ExtensionIngestOptions) {}

    async import(input: ImportInput): Promise<ImportResult | CandidateListResult> {
        if (!EXTENSION_INGEST.enabled) {
            throw new Error('EXTENSION_INGEST_DISABLED');
        }

        // (1) URL parse
        const parsed = parseGitUrl(input.gitUrl);
        if (!parsed) throw new Error(`INVALID_GIT_URL: ${input.gitUrl}`);
        const { owner, repo } = parsed;

        // (2) fetcher
        const fetcher = this.opts.fetcherFactory({ accessToken: input.accessToken });
        const sha = await fetcher.resolveRef(owner, repo, input.gitRef ?? 'HEAD');

        // (3) tree → candidates
        const tree = await fetcher.listTree(owner, repo, sha, SKILL_CREATOR.gitMaxTreeEntries);
        const candidates = scanForExtensionManifests(tree.entries, input.gitPath);
        if (candidates.length === 0) {
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

        // (4) plugin.json fetch + validate
        const candidate = candidates[0];
        const manifestRaw = await fetcher.fetchFile(owner, repo, sha, candidate.path, EXTENSION_INGEST.manifestMaxBytes);
        const validation = validateExtensionManifest(manifestRaw);
        if (!validation.ok) {
            throw new Error(`INVALID_EXTENSION_MANIFEST: ${validation.errors.join('; ')}`);
        }
        const manifest = validation.manifest;
        const root = resolveExtensionRoot(candidate.path);

        // (5) dedupe + 상한 + 동명 충돌
        const sourceHash = 'sha256:' + crypto.createHash('sha256')
            .update(JSON.stringify({ uid: input.userId, url: input.gitUrl, sha, path: candidate.path }))
            .digest('hex');
        const extRepo = new UserExtensionRepository(this.opts.pool);

        const existing = await extRepo.findRecentByHash(input.userId, sourceHash, EXTENSION_INGEST.dedupeWindowHours);
        if (existing) {
            logger.info(`extension-ingest dedupe hit: ${existing.id}`);
            return this.shapeFromRow(existing, true);
        }

        const activeCount = await extRepo.countActiveForUser(input.userId);
        if (activeCount >= EXTENSION_INGEST.maxPerUser) {
            throw new Error(`EXTENSION_LIMIT_EXCEEDED: ${activeCount}/${EXTENSION_INGEST.maxPerUser}`);
        }
        const sameName = await extRepo.findActiveByName(input.userId, manifest.name);
        if (sameName) {
            throw new Error(`EXTENSION_ALREADY_INSTALLED: "${manifest.name}" 이 이미 설치됨 (${sameName.id}) — 먼저 제거 후 재설치하세요`);
        }

        const warnings: string[] = [];

        // (6-a) skills — <root>skills/<dir>/SKILL.md (Agent Plugins v1: 직계 하위만)
        const skillPattern = new RegExp(`^${escapeRegExp(root)}skills/[^/]+/SKILL\\.md$`, 'i');
        let skillPaths = tree.entries.filter(e => skillPattern.test(e.path)).map(e => e.path);
        if (skillPaths.length > EXTENSION_INGEST.maxSkillsPerExtension) {
            warnings.push(`SKILLS_TRUNCATED: ${skillPaths.length}개 중 ${EXTENSION_INGEST.maxSkillsPerExtension}개만 설치`);
            skillPaths = skillPaths.slice(0, EXTENSION_INGEST.maxSkillsPerExtension);
        }
        const skillResults: SkillInstallResult[] = [];
        const skillService = new GitIngestService({
            pool: this.opts.pool,
            llmClientFactory: this.opts.llmClientFactory,
            fetcherFactory: this.opts.fetcherFactory,
        });
        for (const path of skillPaths) {
            try {
                const r = await skillService.import({
                    userId: input.userId,
                    isAdmin: input.isAdmin,
                    gitUrl: input.gitUrl,
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
                            gitUrl: input.gitUrl,
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

        // (8) user_extensions INSERT + 링크
        const row = await extRepo.insert({
            userId: input.userId,
            name: manifest.name,
            version: manifest.version,
            description: manifest.description ?? null,
            sourceUrl: input.gitUrl,
            sourceRef: sha,
            sourcePath: candidate.path,
            sourceHash,
            manifest: {
                plugin: manifest.raw,
                components: { skills: skillResults, mcpServers: mcpResults },
            },
        });
        await extRepo.linkComponents(
            row.id,
            okSkills.map(r => r.skillId!),
            okServers.map(r => r.serverId!),
        );

        logger.info(`extension-ingest created: ${row.id} "${manifest.name}@${manifest.version}" (${owner}/${repo}@${sha.slice(0, 7)}, skills=${okSkills.length}, mcp=${okServers.length})`);
        return {
            extensionId: row.id,
            name: manifest.name,
            version: manifest.version,
            description: manifest.description ?? '',
            status: 'active',
            source: 'git-url',
            gitUrl: input.gitUrl,
            gitRef: sha,
            gitPath: candidate.path,
            skills: skillResults,
            mcpServers: mcpResults,
            validationWarnings: warnings,
            deduped: false,
        };
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
