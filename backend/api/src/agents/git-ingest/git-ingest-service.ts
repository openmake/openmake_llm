/**
 * GitIngestService — Git URL → Skill 매니페스트 ingest 파이프라인.
 *
 * 흐름:
 *   1. parseGitUrl(gitUrl) → { owner, repo }
 *   2. fetcher.resolveRef(ref ?? 'HEAD') → commit SHA
 *   3. fetcher.listTree(sha) → tree entries
 *   4. scanForSkillManifests(tree, explicitPath) → candidates
 *   5. (multi-candidate) selectionRequired=true 로 조기 반환
 *   6. (single) fetcher.fetchFile → raw markdown
 *   7. agents/manifest-validator.ts validateManifest → SkillValidator 통과 검증
 *   8. ConventionChecker.check → ConventionFinding[]
 *   9. dedupe (promptHash = sha256(userId+url+sha+path)) + draft 상한 (50/user)
 *  10. agent_skills INSERT (status='draft', manifest_meta.source='git-url')
 *
 * @module agents/git-ingest/git-ingest-service
 */
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { Pool } from 'pg';
import type { LLMClient } from '../../llm/client';
import { createLogger } from '../../utils/logger';
import { parseGitUrl, type ImportFromGitInput } from '../../schemas/git-ingest.schema';
import { GitFetcher } from './git-fetcher';
import { scanForSkillManifests, type ManifestCandidate } from './repo-scanner';
import { ConventionChecker, type ConventionFinding } from './convention-checker';
import { parseSkillFile, validateManifest } from '../manifest-validator';
import { SKILL_CREATOR } from '../../config/constants';

const logger = createLogger('GitIngestService');

export interface ImportInput extends ImportFromGitInput {
    userId: string;
    isAdmin: boolean;
}

export interface ImportResult {
    skillId: string;
    name: string;
    description: string;
    category: string;
    target: 'user' | 'system';
    status: 'draft';
    source: 'git-url';
    gitUrl: string;
    gitRef: string;
    gitPath: string;
    contentPreview: string;
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

export interface GitIngestOptions {
    pool: Pool;
    llmClientFactory: (model: string) => LLMClient;
    fetcherFactory: (opts: { accessToken?: string }) => GitFetcher;
}

export class GitIngestService {
    constructor(private opts: GitIngestOptions) {}

    async import(input: ImportInput): Promise<ImportResult | CandidateListResult> {
        // (1) URL parse
        const parsed = parseGitUrl(input.gitUrl);
        if (!parsed) throw new Error(`INVALID_GIT_URL: ${input.gitUrl}`);
        const { owner, repo } = parsed;

        // (2) target=system soft-fail
        let effectiveTarget: 'user' | 'system' = input.target ?? 'user';
        const warnings: string[] = [];
        if (effectiveTarget === 'system' && !input.isAdmin) {
            warnings.push('ADMIN_REQUIRED');
            effectiveTarget = 'user';
        }

        // (3) fetcher 준비
        const fetcher = this.opts.fetcherFactory({ accessToken: input.accessToken });
        const sha = await fetcher.resolveRef(owner, repo, input.gitRef ?? 'HEAD');

        // (4) tree → candidates
        const tree = await fetcher.listTree(owner, repo, sha);
        const candidates = scanForSkillManifests(tree.entries, input.gitPath);

        if (candidates.length === 0) {
            throw new Error(`NO_SKILL_FOUND: tree 에 SKILL.md 후보 없음 (gitUrl=${input.gitUrl}, ref=${sha})`);
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

        // (5) single candidate → fetch + validate
        const candidate = candidates[0];
        const maxFileSize = SKILL_CREATOR.gitMaxFileSize ?? 256 * 1024;
        const content = await fetcher.fetchFile(owner, repo, sha, candidate.path, maxFileSize);
        const parsedFile = parseSkillFile(content);
        const validation = await validateManifest(parsedFile, { availableToolNames: new Set() });
        if (!validation.ok) {
            throw new Error(`MANIFEST_INVALID: ${validation.errors.join('; ')}`);
        }

        // (6) convention check
        const llm = this.opts.llmClientFactory(SKILL_CREATOR.authorModel);
        const checker = new ConventionChecker(llm);
        const conv = await checker.check(validation.raw_yaml, validation.prompt_md);

        // (7) dedupe
        const promptHash = 'sha256:' + crypto.createHash('sha256')
            .update(JSON.stringify({ uid: input.userId, url: input.gitUrl, sha, path: candidate.path }))
            .digest('hex');
        const existing = await this.opts.pool.query<{ id: string }>(
            `SELECT id FROM agent_skills
               WHERE created_by = $1 AND status = 'draft'
                 AND manifest_meta->>'promptHash' = $2
                 AND created_at > NOW() - INTERVAL '${SKILL_CREATOR.dedupeWindowHours} hours'
               LIMIT 1`,
            [input.userId, promptHash]
        );
        if (existing.rows[0]) {
            logger.info(`git-ingest dedupe hit: ${existing.rows[0].id}`);
            return this.fetchAndShape(existing.rows[0].id, conv, warnings, true, sha, candidate.path, input.gitUrl);
        }

        // (8) draft 상한
        const cnt = await this.opts.pool.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM agent_skills WHERE created_by=$1 AND status='draft'`,
            [input.userId]
        );
        if (parseInt(cnt.rows[0]?.count ?? '0', 10) >= SKILL_CREATOR.maxDraftsPerUser) {
            throw new Error(`DRAFT_LIMIT_EXCEEDED`);
        }

        // (9) INSERT
        const skillId = effectiveTarget === 'system'
            ? `git-system-skill-${uuidv4()}`
            : `user-skill-${uuidv4()}`;
        const manifestMeta = {
            version: '1.0',
            source: 'git-url',
            model: SKILL_CREATOR.authorModel || 'unset',
            createdAt: new Date().toISOString(),
            promptHash,
            gitUrl: input.gitUrl,
            gitRef: sha,
            gitPath: candidate.path,
            conventionFindings: conv.findings,
            tokensUsed: conv.tokensUsed,
        };
        await this.opts.pool.query(
            `INSERT INTO agent_skills
               (id, name, description, content, category, is_public, created_by, status, manifest_meta)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8::jsonb)`,
            [
                skillId,
                validation.manifest.name,
                validation.manifest.description ?? '',
                validation.prompt_md,
                input.category ?? validation.manifest.category ?? 'general',
                effectiveTarget === 'system',
                effectiveTarget === 'system' ? null : input.userId,
                JSON.stringify(manifestMeta),
            ]
        );
        logger.info(`git-ingest created: ${skillId} (${owner}/${repo}@${sha.slice(0, 7)}:${candidate.path})`);

        return {
            skillId,
            name: validation.manifest.name,
            description: validation.manifest.description ?? '',
            category: input.category ?? validation.manifest.category ?? 'general',
            target: effectiveTarget,
            status: 'draft',
            source: 'git-url',
            gitUrl: input.gitUrl,
            gitRef: sha,
            gitPath: candidate.path,
            contentPreview: validation.prompt_md.slice(0, 300),
            validationWarnings: warnings,
            conventionFindings: conv.findings,
            modelUsed: SKILL_CREATOR.authorModel || 'unset',
            tokensUsed: conv.tokensUsed,
            deduped: false,
        };
    }

    /** dedupe hit 시 기존 draft 를 ImportResult shape 로 변환 */
    private async fetchAndShape(
        skillId: string,
        conv: { findings: ConventionFinding[]; tokensUsed: number },
        warnings: string[],
        deduped: boolean,
        sha: string,
        path: string,
        gitUrl: string,
    ): Promise<ImportResult> {
        const r = await this.opts.pool.query<{
            id: string; name: string; description: string; category: string; content: string; manifest_meta: Record<string, unknown>;
        }>(
            `SELECT id, name, description, category, content, manifest_meta FROM agent_skills WHERE id=$1`,
            [skillId]
        );
        const row = r.rows[0]!;
        const target: 'user' | 'system' = row.id.startsWith('git-system-skill-') ? 'system' : 'user';
        return {
            skillId: row.id,
            name: row.name,
            description: row.description,
            category: row.category,
            target,
            status: 'draft',
            source: 'git-url',
            gitUrl,
            gitRef: sha,
            gitPath: path,
            contentPreview: (row.content ?? '').slice(0, 300),
            validationWarnings: warnings,
            conventionFindings: conv.findings,
            modelUsed: String(row.manifest_meta?.model ?? ''),
            tokensUsed: 0,
            deduped,
        };
    }
}
