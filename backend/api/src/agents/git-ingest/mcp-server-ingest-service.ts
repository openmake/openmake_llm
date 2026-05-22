/**
 * McpServerIngestService — Git URL → MCPSERVER.md → mcp_servers draft (Phase 4).
 *
 * 흐름:
 *   1. parseGitUrl → owner/repo
 *   2. fetcher.resolveRef → sha
 *   3. fetcher.listTree → tree
 *   4. scanForMcpServerManifests → candidates
 *   5. (multi) selectionRequired 조기 반환
 *   6. (single) fetcher.fetchFile → MCPSERVER.md raw
 *   7. parseMcpServerFile + validateMcpServerManifest
 *   8. ConventionChecker.checkMcpServer (정적 + LLM)
 *   9. dedupe + draft 상한
 *  10. McpServerDraftRepository.insertDraft
 *
 * @module agents/git-ingest/mcp-server-ingest-service
 */
import * as crypto from 'crypto';
import type { Pool } from 'pg';
import type { LLMClient } from '../../llm/client';
import { createLogger } from '../../utils/logger';
import { parseGitUrl } from '../../schemas/git-ingest.schema';
import type { ImportMcpServerFromGitInput } from '../../schemas/mcp-server-ingest.schema';
import { GitFetcher } from './git-fetcher';
import { scanForMcpServerManifests, type ManifestCandidate } from './repo-scanner';
import { parseMcpServerFile, validateMcpServerManifest } from './mcp-server-manifest-validator';
import { ConventionChecker, type ConventionFinding } from './convention-checker';
import { McpServerDraftRepository } from '../../data/repositories/mcp-server-draft-repository';
import { MCP_INGEST, SKILL_CREATOR } from '../../config/constants';

const logger = createLogger('McpServerIngestService');

export interface ImportInput extends ImportMcpServerFromGitInput {
    userId: string;
    isAdmin: boolean;
}

export interface ImportResult {
    serverId: string;
    name: string;
    description: string;
    category: string;
    transportType: 'stdio' | 'sse' | 'streamable-http';
    command?: string | null;
    args?: string[] | null;
    env?: Record<string, string> | null;
    url?: string | null;
    requiredEnv: string[];
    status: 'draft';
    source: 'git-url';
    gitUrl: string;
    gitRef: string;
    gitPath: string;
    contentPreview: string;
    conventionFindings: ConventionFinding[];
    blockedByConvention: boolean;
    tokensUsed: number;
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

export interface McpServerIngestOptions {
    pool: Pool;
    llmClientFactory: (model: string) => LLMClient;
    fetcherFactory: (opts: { accessToken?: string }) => GitFetcher;
}

export class McpServerIngestService {
    constructor(private opts: McpServerIngestOptions) {}

    async import(input: ImportInput): Promise<ImportResult | CandidateListResult> {
        if (!MCP_INGEST.enabled) {
            throw new Error('MCP_INGEST_DISABLED');
        }

        const parsed = parseGitUrl(input.gitUrl);
        if (!parsed) throw new Error(`INVALID_GIT_URL: ${input.gitUrl}`);
        const { owner, repo } = parsed;

        const fetcher = this.opts.fetcherFactory({ accessToken: input.accessToken });
        const sha = await fetcher.resolveRef(owner, repo, input.gitRef ?? 'HEAD');

        const tree = await fetcher.listTree(owner, repo, sha);
        const candidates = scanForMcpServerManifests(tree.entries, input.gitPath);
        if (candidates.length === 0) {
            throw new Error(`NO_MCPSERVER_FOUND: tree 에 MCPSERVER.md 후보 없음 (gitUrl=${input.gitUrl}, ref=${sha})`);
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

        const candidate = candidates[0];
        const content = await fetcher.fetchFile(owner, repo, sha, candidate.path, MCP_INGEST.gitMaxFileSizeBytes);
        const parsedFile = parseMcpServerFile(content);
        const validation = await validateMcpServerManifest(parsedFile);
        if (!validation.ok) {
            throw new Error(`INVALID_MCPSERVER_MANIFEST: ${validation.errors.join('; ')}`);
        }
        const manifest = validation.manifest;

        const llm = this.opts.llmClientFactory(SKILL_CREATOR.authorModel);
        const checker = new ConventionChecker(llm);
        const conv = await checker.checkMcpServer(
            validation.raw_yaml,
            validation.body,
            { command: manifest.command, args: manifest.args },
        );
        const blockedByConvention = conv.findings.some(f => f.severity === 'error');

        const promptHash = 'sha256:' + crypto.createHash('sha256')
            .update(JSON.stringify({
                uid: input.userId,
                url: input.gitUrl,
                sha,
                path: candidate.path,
            }))
            .digest('hex');
        const repository = new McpServerDraftRepository(this.opts.pool);

        const existing = await repository.findRecentDraftByHash(input.userId, promptHash, MCP_INGEST.dedupeWindowHours);
        if (existing) {
            logger.info(`mcp-ingest dedupe hit: ${existing.id}`);
            return this.shapeFromRow(existing, manifest, conv.findings, blockedByConvention, conv.tokensUsed, true, sha, candidate.path, input.gitUrl);
        }

        const count = await repository.countDraftsForUser(input.userId);
        if (count >= MCP_INGEST.maxDraftsPerUser) {
            throw new Error(`DRAFT_LIMIT_EXCEEDED: ${count}/${MCP_INGEST.maxDraftsPerUser}`);
        }

        const manifestMeta = {
            version: '1.0',
            source: 'git-url',
            model: SKILL_CREATOR.authorModel || 'unset',
            createdAt: new Date().toISOString(),
            promptHash,
            gitUrl: input.gitUrl,
            gitRef: sha,
            gitPath: candidate.path,
            description: manifest.description,
            category: manifest.category,
            requiredEnv: manifest.required_env ?? [],
            requiredCapabilities: manifest.required_capabilities ?? [],
            securityMetadata: manifest.security_metadata ?? null,
            conventionFindings: conv.findings,
            blockedByConvention,
            tokensUsed: conv.tokensUsed,
            mcpManifestVersion: manifest.version,
            author: manifest.author ?? null,
            license: manifest.license ?? null,
            homepage: manifest.homepage ?? null,
        };

        const finalName = await this.resolveUniqueName(input.userId, manifest.name);

        const inserted = await repository.insertDraft({
            name: finalName,
            transportType: manifest.transport_type,
            command: manifest.command ?? null,
            args: manifest.args ?? null,
            env: manifest.env ?? null,
            url: manifest.url ?? null,
            createdBy: input.userId,
            manifestMeta,
        });

        logger.info(`mcp-ingest created: ${inserted.id} (${owner}/${repo}@${sha.slice(0, 7)}:${candidate.path})`);
        return this.shapeFromRow(inserted, manifest, conv.findings, blockedByConvention, conv.tokensUsed, false, sha, candidate.path, input.gitUrl);
    }

    /**
     * 사용자별 (user_id, name) unique 충돌 회피.
     * 이미 존재하면 random 6자 hex suffix.
     */
    private async resolveUniqueName(userId: string, name: string): Promise<string> {
        const r = await this.opts.pool.query<{ id: string }>(
            `SELECT id FROM mcp_servers WHERE user_id=$1 AND name=$2 LIMIT 1`,
            [userId, name]
        );
        if (r.rows.length === 0) return name;
        const suffix = crypto.randomBytes(3).toString('hex');
        return `${name}-${suffix}`.slice(0, 100);
    }

    private shapeFromRow(
        row: {
            id: string;
            name: string;
            transport_type: 'stdio' | 'sse' | 'streamable-http';
            command: string | null;
            args: string[] | null;
            env: Record<string, string> | null;
            url: string | null;
            manifest_meta: Record<string, unknown> | null;
        },
        manifest: { description: string; category: string; required_env?: string[] },
        findings: ConventionFinding[],
        blockedByConvention: boolean,
        tokensUsed: number,
        deduped: boolean,
        sha: string,
        path: string,
        gitUrl: string,
    ): ImportResult {
        return {
            serverId: row.id,
            name: row.name,
            description: manifest.description,
            category: manifest.category,
            transportType: row.transport_type,
            command: row.command,
            args: row.args,
            env: row.env,
            url: row.url,
            requiredEnv: manifest.required_env ?? [],
            status: 'draft',
            source: 'git-url',
            gitUrl,
            gitRef: sha,
            gitPath: path,
            contentPreview: `${row.command ?? row.url} ${(row.args || []).join(' ')}`.slice(0, 300),
            conventionFindings: findings,
            blockedByConvention,
            tokensUsed,
            deduped,
        };
    }
}
