/**
 * ============================================================
 * Skills Schema - 스킬 API 요청 Zod 검증 스키마
 * ============================================================
 *
 * 스킬 생성/수정/검색 요청의
 * 유효성을 검증하는 Zod 스키마를 정의합니다.
 *
 * @module schemas/skills.schema
 */
import { z } from 'zod';

// POST /api/agents/skills — 스킬 생성
export const createSkillSchema = z.object({
    name: z.string().min(1, '스킬 이름은 필수입니다').max(200),
    description: z.string().max(2000).optional().default(''),
    content: z.string().min(1, '스킬 내용은 필수입니다').max(50000),
    category: z.string().max(100).optional().default('general'),
    isPublic: z.boolean().optional().default(false),
});

export type CreateSkillInput = z.infer<typeof createSkillSchema>;

// PUT /api/agents/skills/:skillId — 스킬 수정
export const updateSkillSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    content: z.string().min(1).max(50000).optional(),
    category: z.string().max(100).optional(),
    isPublic: z.boolean().optional(),
});

export type UpdateSkillInput = z.infer<typeof updateSkillSchema>;

// GET /api/agents/skills query params — 스킬 검색
// status 필터는 의도적으로 미지원: draft 조회는 GET /api/agents/skills/drafts 전용 엔드포인트
// (admin 가드가 있는 곳) 으로만 가능. 여기서 ?status=draft 를 허용하면 is_public=TRUE 인
// system draft 가 일반 사용자에게 노출될 수 있음.
export const searchSkillsQuerySchema = z.object({
    search: z.string().max(200).optional(),
    category: z.string().max(100).optional(),
    isPublic: z.coerce.boolean().optional(),
    sortBy: z.enum(['newest', 'name', 'category', 'updated']).optional().default('newest'),
    limit: z.coerce.number().int().min(1).max(200).optional().default(20),
    offset: z.coerce.number().int().min(0).optional().default(0),
});

export type SearchSkillsQuery = z.infer<typeof searchSkillsQuerySchema>;

// ============================================================
// Skill Creator (Phase 1) — 자동 생성 + draft 워크플로
// ============================================================

export const SKILL_CATEGORIES = [
    'general', 'coding', 'writing', 'analysis', 'creative', 'education',
    'business', 'science', 'technology', 'finance', 'healthcare', 'legal',
    'engineering', 'media', 'social-welfare', 'government', 'real-estate',
    'energy', 'logistics', 'hospitality', 'agriculture', 'productivity',
    'communication', 'system',
] as const;

export const autoCreateSkillSchema = z.object({
    purpose: z.string().min(5).max(500),
    target: z.enum(['user', 'system']).optional().default('user'),
    category: z.enum(SKILL_CATEGORIES).optional(),
    examples: z.array(z.string().max(500)).max(5).optional(),
    hints: z.string().max(1000).optional(),
});

export type AutoCreateSkillInput = z.infer<typeof autoCreateSkillSchema>;

export const draftsQuerySchema = z.object({
    target: z.enum(['user', 'system', 'all']).default('user'),
    limit: z.coerce.number().int().positive().max(100).default(50),
    offset: z.coerce.number().int().nonnegative().default(0),
});

export type DraftsQuery = z.infer<typeof draftsQuerySchema>;

// LLM 응답 검증 (SkillCreatorService 가 사용)
export const llmSkillManifestSchema = z.object({
    name: z.string().min(5).max(100),
    description: z.string().min(10).max(500),
    category: z.enum(SKILL_CATEGORIES).default('general'),
    content: z.string().min(200).max(20000),
    triggers: z.array(z.string().max(50)).max(20).optional().default([]),
    tags: z.array(z.string().max(30)).max(10).optional().default([]),
});

export type LlmSkillManifest = z.infer<typeof llmSkillManifestSchema>;
