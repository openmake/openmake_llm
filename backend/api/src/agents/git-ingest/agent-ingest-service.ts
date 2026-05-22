/**
 * AgentIngestService — Git URL → Agent manifest ingest 파이프라인.
 *
 * 흐름:
 *   1. parseGitUrl → owner/repo
 *   2. fetcher.resolveRef → sha
 *   3. fetcher.listTree → tree entries
 *   4. scanForAgentManifests → candidates
 *   5. (multi) selectionRequired 조기 반환
 *   6. (single) fetcher.fetchFile → AGENT.md raw
 *   7. parseAgentFile + validateAgentManifest → AgentManifestFrontmatter
 *   8. resolveSkillBindings — skill-id lookup, git-url chained ingest
 *   9. ConventionChecker.check (system_prompt)
 *  10. dedupe + draft 상한
 *  11. CustomAgentRepository.insertDraft + agent_skill_assignments INSERT
 *
 * @module agents/git-ingest/agent-ingest-service
 */
import * as crypto from 'crypto';
import type { Pool } from 'pg';
import type { LLMClient } from '../../llm/client';
import { createLogger } from '../../utils/logger';
import { parseGitUrl } from '../../schemas/git-ingest.schema';
import type { ImportAgentFromGitInput } from '../../schemas/agent-ingest.schema';
import { GitFetcher } from './git-fetcher';
import { scanForAgentManifests, type ManifestCandidate } from './repo-scanner';
import { parseAgentFile, validateAgentManifest } from './agent-manifest-validator';
import { ConventionChecker, type ConventionFinding } from './convention-checker';
import { CustomAgentRepository, type CustomAgentRow } from '../../data/repositories/custom-agent-repository';
import { GitIngestService } from './git-ingest-service';
import { SKILL_CREATOR } from '../../config/constants';

const logger = createLogger('AgentIngestService');

const DEDUPE_WINDOW_HOURS = 24;
const MAX_DRAFT_AGENTS_PER_USER = parseInt(process.env.AGENT_CREATOR_MAX_DRAFTS_PER_USER || '20', 10);

export interface SkillBindingResolution {
    ref: string;
    resolved: boolean;
    skillId?: string;
    chainedIngest?: boolean;
    error?: string;
}

export interface ImportInput extends ImportAgentFromGitInput {
    userId: string;
    isAdmin: boolean;
}

export interface ImportResult {
    agentId: string;
    name: string;
    description: string;
    category: string;
    status: 'draft';
    source: 'git-url';
    gitUrl: string;
    gitRef: string;
    gitPath: string;
    contentPreview: string;
    skillBindingsResolved: SkillBindingResolution[];
    skillBindingsUnresolved: SkillBindingResolution[];
    validationWarnings: string[];
    conventionFindings: ConventionFinding[];
    modelUsed: string;
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

export interface AgentIngestOptions {
    pool: Pool;
    llmClientFactory: (model: string) => LLMClient;
    fetcherFactory: (opts: { accessToken?: string }) => GitFetcher;
}

export class AgentIngestService {
    constructor(private opts: AgentIngestOptions) {}

    async import(input: ImportInput): Promise<ImportResult | CandidateListResult> {
        // (1) URL parse
        const parsed = parseGitUrl(input.gitUrl);
        if (!parsed) throw new Error(`INVALID_GIT_URL: ${input.gitUrl}`);
        const { owner, repo } = parsed;

        // (2) fetcher
        const fetcher = this.opts.fetcherFactory({ accessToken: input.accessToken });
        const sha = await fetcher.resolveRef(owner, repo, input.gitRef ?? 'HEAD');

        // (3) tree → candidates
        const tree = await fetcher.listTree(owner, repo, sha);
        const candidates = scanForAgentManifests(tree.entries, input.gitPath);
        if (candidates.length === 0) {
            throw new Error(`NO_AGENT_FOUND: tree 에 AGENT.md 후보 없음 (gitUrl=${input.gitUrl}, ref=${sha})`);
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

        // (4) fetch + validate
        const candidate = candidates[0];
        const maxFileSize = SKILL_CREATOR.gitMaxFileSize ?? 256 * 1024;
        const content = await fetcher.fetchFile(owner, repo, sha, candidate.path, maxFileSize);
        const parsedFile = parseAgentFile(content);
        const validation = await validateAgentManifest(parsedFile);
        if (!validation.ok) {
            throw new Error(`INVALID_AGENT_MANIFEST: ${validation.errors.join('; ')}`);
        }

        // (5) skill_bindings 해결
        const warnings: string[] = [];
        const resolved: SkillBindingResolution[] = [];
        const unresolved: SkillBindingResolution[] = [];
        for (const ref of validation.manifest.skill_bindings ?? []) {
            const res = await this.resolveSkillBinding(ref, input);
            if (res.resolved) resolved.push(res);
            else unresolved.push(res);
        }
        if (unresolved.length > 0) warnings.push('SKILL_BINDING_UNRESOLVED');

        // (6) convention check (system_prompt)
        const llm = this.opts.llmClientFactory(SKILL_CREATOR.authorModel);
        const checker = new ConventionChecker(llm);
        const conv = await checker.check(validation.raw_yaml, validation.system_prompt);

        // (7) dedupe key
        const promptHash = 'sha256:' + crypto.createHash('sha256')
            .update(JSON.stringify({ uid: input.userId, url: input.gitUrl, sha, path: candidate.path }))
            .digest('hex');
        const repository = new CustomAgentRepository(this.opts.pool);

        const dedupeRes = await this.opts.pool.query<{ id: string }>(
            `SELECT id FROM custom_agents
               WHERE created_by = $1 AND status = 'draft'
                 AND manifest_meta->>'promptHash' = $2
                 AND created_at > NOW() - INTERVAL '${DEDUPE_WINDOW_HOURS} hours'
               LIMIT 1`,
            [input.userId, promptHash]
        );
        if (dedupeRes.rows[0]) {
            const existing = await repository.getById(dedupeRes.rows[0].id);
            if (existing) {
                logger.info(`agent-ingest dedupe hit: ${existing.id}`);
                return this.shapeFromRow(existing, resolved, unresolved, warnings, conv.findings, true, sha, candidate.path, input.gitUrl);
            }
        }

        // (8) draft 상한
        const count = await repository.countDraftsForUser(input.userId);
        if (count >= MAX_DRAFT_AGENTS_PER_USER) {
            throw new Error(`DRAFT_LIMIT_EXCEEDED: ${count}/${MAX_DRAFT_AGENTS_PER_USER}`);
        }

        // (9) INSERT
        const manifestMeta = {
            version: '1.0',
            source: 'git-url',
            model: SKILL_CREATOR.authorModel || 'unset',
            createdAt: new Date().toISOString(),
            promptHash,
            gitUrl: input.gitUrl,
            gitRef: sha,
            gitPath: candidate.path,
            skillBindingsResolved: resolved,
            skillBindingsUnresolved: unresolved,
            conventionFindings: conv.findings,
            tokensUsed: conv.tokensUsed,
        };
        const inserted = await repository.insertDraft({
            name: validation.manifest.name,
            description: validation.manifest.description,
            systemPrompt: validation.system_prompt,
            category: input.category ?? validation.manifest.category,
            emoji: validation.manifest.emoji,
            keywords: validation.manifest.keywords,
            temperature: validation.manifest.temperature,
            maxTokens: validation.manifest.max_tokens,
            createdBy: input.userId,
            manifestMeta,
        });

        // (10) skill_bindings → agent_skill_assignments INSERT (resolved 만)
        for (const r of resolved) {
            if (!r.skillId) continue;
            await this.opts.pool.query(
                `INSERT INTO agent_skill_assignments (agent_id, skill_id, priority, created_at)
                 VALUES ($1, $2, 0, NOW())
                 ON CONFLICT (agent_id, skill_id) DO NOTHING`,
                [inserted.id, r.skillId]
            );
        }

        logger.info(`agent-ingest created: ${inserted.id} (${owner}/${repo}@${sha.slice(0, 7)}:${candidate.path})`);
        return this.shapeFromRow(inserted, resolved, unresolved, warnings, conv.findings, false, sha, candidate.path, input.gitUrl);
    }

    private async resolveSkillBinding(ref: string, input: ImportInput): Promise<SkillBindingResolution> {
        if (ref.startsWith('skill-id:')) {
            const id = ref.slice('skill-id:'.length);
            const r = await this.opts.pool.query<{ id: string }>(
                `SELECT id FROM agent_skills WHERE id=$1 LIMIT 1`,
                [id]
            );
            if (r.rows[0]) return { ref, resolved: true, skillId: id };
            return { ref, resolved: false, error: `skill not found: ${id}` };
        }
        if (ref.startsWith('git-url:')) {
            const remainder = ref.slice('git-url:'.length);
            const [gitUrl, gitPath] = remainder.includes('#')
                ? (remainder.split('#') as [string, string])
                : [remainder, undefined];
            try {
                const skillService = new GitIngestService({
                    pool: this.opts.pool,
                    llmClientFactory: this.opts.llmClientFactory,
                    fetcherFactory: this.opts.fetcherFactory,
                });
                const subResult = await skillService.import({
                    userId: input.userId,
                    isAdmin: input.isAdmin,
                    gitUrl,
                    gitPath,
                    accessToken: input.accessToken,
                    target: 'user',
                });
                if ('selectionRequired' in subResult && subResult.selectionRequired) {
                    return { ref, resolved: false, error: 'chained skill has multi-candidate — explicit path required in ref' };
                }
                return { ref, resolved: true, skillId: subResult.skillId, chainedIngest: true };
            } catch (e) {
                return { ref, resolved: false, error: e instanceof Error ? e.message : String(e) };
            }
        }
        return { ref, resolved: false, error: 'unknown ref format' };
    }

    private shapeFromRow(
        row: CustomAgentRow,
        resolved: SkillBindingResolution[],
        unresolved: SkillBindingResolution[],
        warnings: string[],
        findings: ConventionFinding[],
        deduped: boolean,
        sha: string,
        path: string,
        gitUrl: string,
    ): ImportResult {
        return {
            agentId: row.id,
            name: row.name,
            description: row.description ?? '',
            category: row.category ?? 'general',
            status: 'draft',
            source: 'git-url',
            gitUrl,
            gitRef: sha,
            gitPath: path,
            contentPreview: row.system_prompt.slice(0, 300),
            skillBindingsResolved: resolved,
            skillBindingsUnresolved: unresolved,
            validationWarnings: warnings,
            conventionFindings: findings,
            modelUsed: String((row.manifest_meta as { model?: string } | null)?.model ?? ''),
            tokensUsed: Number((row.manifest_meta as { tokensUsed?: number } | null)?.tokensUsed ?? 0),
            deduped,
        };
    }
}
