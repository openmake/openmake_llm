/**
 * SkillCreatorService
 * LLM 호출 → 매니페스트 생성 → Zod 검증 → DB 저장 (status='draft').
 * MCP tool create_skill 과 REST POST /api/skills/auto-create 가 공유.
 *
 * @module agents/skill-creator
 */

import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { Pool } from 'pg';
import { createLogger } from '../utils/logger';
import {
    llmSkillManifestSchema,
    type LlmSkillManifest,
} from '../schemas/skills.schema';
import SKILL_AUTHOR_SYSTEM_PROMPT from './prompts/skill-author-system-prompt';
import type { LLMClient } from '../llm/client';
import type { ChatMessage } from '../llm/types';

const logger = createLogger('SkillCreator');

export interface CreateInput {
    userId: string;
    isAdmin: boolean;
    purpose: string;
    target?: 'user' | 'system';
    category?: string;
    examples?: string[];
    hints?: string;
    /** LLM model override (fallback chain). Used for fallback to user's chat model. */
    model?: string;
}

export interface ManifestMeta {
    version: '1.0';
    source: 'auto-llm';
    model: string;
    modelTier: 'system' | 'user-fallback';
    createdAt: string;
    promptHash: string;
    userPrompt: string;
    triggers: string[];
    tags: string[];
    tokensUsed: number;
}

export interface CreateResult {
    skillId: string;
    name: string;
    description: string;
    category: string;
    target: 'user' | 'system';
    status: 'draft';
    contentPreview: string;
    triggers: string[];
    manifestMeta: ManifestMeta;
    modelUsed: string;
    tokensUsed: number;
    warnings: string[];
    deduped: boolean;
}

export interface SkillCreatorOptions {
    pool: Pool;
    /**
     * Factory creates a per-request LLMClient (memory: project_per_request_ollama_client).
     * Receives the model id to use; returns an LLMClient configured for that model.
     */
    llmClientFactory: (model: string) => LLMClient;
}

const DEDUPE_WINDOW_HOURS = 24;
const MAX_DRAFTS_PER_USER = parseInt(
    process.env.SKILL_AUTO_CREATE_MAX_DRAFTS_PER_USER || '50', 10
);

export class SkillCreatorService {
    constructor(private opts: SkillCreatorOptions) {}

    async create(input: CreateInput): Promise<CreateResult> {
        const warnings: string[] = [];

        // (1) target='system' soft-fail
        let effectiveTarget: 'user' | 'system' = input.target ?? 'user';
        if (effectiveTarget === 'system' && !input.isAdmin) {
            warnings.push('ADMIN_REQUIRED');
            effectiveTarget = 'user';
        }

        // (2) dedupe
        const promptHash = this.computePromptHash(input);
        const existing = await this.findRecentDraft(input.userId, promptHash);
        if (existing) {
            logger.info(`Dedupe hit: skillId=${existing.id}`);
            return this.buildResult(existing, { warnings, deduped: true });
        }

        // (3) draft 누적 상한
        const draftCount = await this.countUserDrafts(input.userId);
        if (draftCount >= MAX_DRAFTS_PER_USER) {
            throw new Error(`DRAFT_LIMIT_EXCEEDED: ${draftCount}/${MAX_DRAFTS_PER_USER}`);
        }

        // (4) LLM 호출 + Zod 검증 (retry 1회)
        const { manifest, modelUsed, tokensUsed, modelTier } = await this.generateManifest(input);

        // (5) category override (user 입력 우선)
        if (input.category) {
            manifest.category = input.category as LlmSkillManifest['category'];
        }

        // (6) DB INSERT
        const skillId = effectiveTarget === 'system'
            ? `auto-system-skill-${uuidv4()}`
            : `user-skill-${uuidv4()}`;
        const createdAt = new Date().toISOString();
        const manifestMeta: ManifestMeta = {
            version: '1.0',
            source: 'auto-llm',
            model: modelUsed,
            modelTier,
            createdAt,
            promptHash,
            userPrompt: input.purpose,
            triggers: manifest.triggers,
            tags: manifest.tags,
            tokensUsed,
        };

        await this.opts.pool.query(
            `INSERT INTO agent_skills
               (id, name, description, content, category, is_public, created_by, status, manifest_meta)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8::jsonb)`,
            [
                skillId,
                manifest.name,
                manifest.description,
                manifest.content,
                manifest.category,
                effectiveTarget === 'system',  // system 은 is_public=true
                effectiveTarget === 'system' ? null : input.userId,
                JSON.stringify(manifestMeta),
            ]
        );

        logger.info(`Draft created: ${skillId} (target=${effectiveTarget}, model=${modelUsed})`);

        return {
            skillId,
            name: manifest.name,
            description: manifest.description,
            category: manifest.category,
            target: effectiveTarget,
            status: 'draft',
            contentPreview: manifest.content.slice(0, 300),
            triggers: manifest.triggers,
            manifestMeta,
            modelUsed,
            tokensUsed,
            warnings,
            deduped: false,
        };
    }

    private computePromptHash(input: CreateInput): string {
        const payload = JSON.stringify({
            uid: input.userId,
            p: input.purpose.trim().toLowerCase(),
            c: input.category ?? '',
            ex: (input.examples ?? []).map((e) => e.trim().toLowerCase()),
        });
        return 'sha256:' + crypto.createHash('sha256').update(payload).digest('hex');
    }

    private async findRecentDraft(userId: string, promptHash: string) {
        const r = await this.opts.pool.query<{
            id: string;
            name: string;
            description: string;
            category: string;
            content: string;
            manifest_meta: ManifestMeta;
        }>(
            `SELECT id, name, description, category, content, manifest_meta
               FROM agent_skills
              WHERE created_by = $1
                AND status = 'draft'
                AND manifest_meta->>'promptHash' = $2
                AND created_at > NOW() - INTERVAL '${DEDUPE_WINDOW_HOURS} hours'
              LIMIT 1`,
            [userId, promptHash]
        );
        return r.rows[0] ?? null;
    }

    private async countUserDrafts(userId: string): Promise<number> {
        const r = await this.opts.pool.query<{ count: string }>(
            `SELECT COUNT(*)::text as count FROM agent_skills
              WHERE created_by = $1 AND status = 'draft'`,
            [userId]
        );
        return parseInt(r.rows[0]?.count ?? '0', 10);
    }

    private async generateManifest(input: CreateInput): Promise<{
        manifest: LlmSkillManifest;
        modelUsed: string;
        tokensUsed: number;
        modelTier: 'system' | 'user-fallback';
    }> {
        // E2E test seam — SKILL_AUTHOR_MOCK=true 면 LLM 호출 우회 + 결정론적 매니페스트.
        // 운영 환경에서는 반드시 false (기본값). CI/E2E 전용.
        if (process.env.SKILL_AUTHOR_MOCK === 'true') {
            const purposeSlug = (input.purpose || 'mock-skill').slice(0, 30).replace(/[<>"&]/g, '');
            return {
                manifest: {
                    name: `Mock Skill: ${purposeSlug}`,
                    description: `결정론적 mock 응답 — purpose 첫 30자 echo. 실제 LLM 호출 없음 (SKILL_AUTHOR_MOCK=true).`,
                    category: (input.category as LlmSkillManifest['category']) || 'general',
                    content: `## Mock Skill Content\n\nThis is a deterministic mock manifest for E2E testing.\n\nUser purpose: ${input.purpose}\n\n${'A'.repeat(300)}`,
                    triggers: ['mock', 'test', 'e2e'],
                    tags: ['mock-skill', 'e2e-fixture'],
                },
                modelUsed: 'mock',
                tokensUsed: 0,
                modelTier: 'system',
            };
        }

        const userPrompt = this.buildUserPrompt(input);
        const fallbackEnabled = process.env.SKILL_AUTHOR_FALLBACK === 'true';
        let modelTier: 'system' | 'user-fallback' = 'system';
        let modelUsed = process.env.SKILL_AUTHOR_MODEL || '';

        if (!modelUsed && input.model) {
            modelUsed = input.model;
            modelTier = 'user-fallback';
        }

        let lastErr = '';
        for (let attempt = 0; attempt < 2; attempt++) {
            const userContent = attempt === 0
                ? userPrompt
                : `${userPrompt}\n\n# 이전 응답이 schema 를 위반했습니다\n${lastErr}\n다시 JSON 만 출력하세요.`;
            const messages: ChatMessage[] = [
                { role: 'system', content: SKILL_AUTHOR_SYSTEM_PROMPT },
                { role: 'user', content: userContent },
            ];

            try {
                const client = this.opts.llmClientFactory(modelUsed);
                const resp = await client.chat(messages);
                const raw = resp.content ?? '';
                const tokensUsed = resp.metrics?.eval_count ?? 0;

                const json = this.extractJson(raw);
                const parsed = llmSkillManifestSchema.parse(json);
                return { manifest: parsed, modelUsed, tokensUsed, modelTier };
            } catch (e: unknown) {
                lastErr = e instanceof Error ? e.message : String(e);
                logger.warn(`LLM attempt ${attempt + 1} failed: ${lastErr}`);
                if (attempt === 1 && fallbackEnabled && modelTier === 'system' && input.model) {
                    modelUsed = input.model;
                    modelTier = 'user-fallback';
                    attempt = -1;  // will become 0 after ++ — retry from scratch with fallback model
                    continue;
                }
            }
        }
        throw new Error(`LLM_PARSE_FAIL: ${lastErr}`);
    }

    private buildUserPrompt(input: CreateInput): string {
        const parts = [`# 스킬 생성 요청\n\n## 목적\n${input.purpose}`];
        if (input.category) parts.push(`\n## 카테고리\n${input.category}`);
        if (input.examples?.length) {
            parts.push(
                `\n## 예시 질문/작업\n${input.examples.map((e, i) => `${i + 1}. ${e}`).join('\n')}`
            );
        }
        if (input.hints) parts.push(`\n## 추가 지침\n${input.hints}`);
        return parts.join('\n');
    }

    private extractJson(raw: string): unknown {
        const trimmed = raw.trim();
        const fence = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
        const candidate = fence ? fence[1] : trimmed;
        return JSON.parse(candidate);
    }

    private buildResult(
        row: {
            id: string;
            name: string;
            description: string;
            category: string;
            content: string;
            manifest_meta: ManifestMeta;
        },
        opts: { warnings: string[]; deduped: boolean }
    ): CreateResult {
        const meta = row.manifest_meta;
        return {
            skillId: row.id,
            name: row.name,
            description: row.description,
            category: row.category,
            target: row.id.startsWith('auto-system-skill-') ? 'system' : 'user',
            status: 'draft',
            contentPreview: (row.content ?? '').slice(0, 300),
            triggers: meta?.triggers ?? [],
            manifestMeta: meta,
            modelUsed: meta?.model ?? '',
            tokensUsed: meta?.tokensUsed ?? 0,
            warnings: opts.warnings,
            deduped: opts.deduped,
        };
    }
}
