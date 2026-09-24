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
import { SCHEMA_LIMITS } from '../config/http-data-limits';

const { skills: S } = SCHEMA_LIMITS;

// POST /api/agents/skills — 스킬 생성
export const createSkillSchema = z.object({
    name: z.string().min(1, '스킬 이름은 필수입니다').max(S.NAME_MAX),
    description: z.string().max(S.DESCRIPTION_MAX).optional().default(''),
    content: z.string().min(1, '스킬 내용은 필수입니다').max(S.CONTENT_MAX),
    category: z.string().max(S.CATEGORY_MAX).optional().default('general'),
    isPublic: z.boolean().optional().default(false),
});

// PUT /api/agents/skills/:skillId — 스킬 수정
export const updateSkillSchema = z.object({
    name: z.string().min(1).max(S.NAME_MAX).optional(),
    description: z.string().max(S.DESCRIPTION_MAX).optional(),
    content: z.string().min(1).max(S.CONTENT_MAX).optional(),
    category: z.string().max(S.CATEGORY_MAX).optional(),
    isPublic: z.boolean().optional(),
});

// GET /api/agents/skills query params — 스킬 검색
// status 필터는 의도적으로 미지원: draft 조회는 GET /api/agents/skills/drafts 전용 엔드포인트
// (admin 가드가 있는 곳) 으로만 가능. 여기서 ?status=draft 를 허용하면 is_public=TRUE 인
// system draft 가 일반 사용자에게 노출될 수 있음.
export const searchSkillsQuerySchema = z.object({
    search: z.string().max(S.SEARCH_MAX).optional(),
    category: z.string().max(S.CATEGORY_MAX).optional(),
    isPublic: z.coerce.boolean().optional(),
    sortBy: z.enum(['newest', 'name', 'category', 'updated']).optional().default('newest'),
    limit: z.coerce.number().int().min(1).max(S.SEARCH_LIMIT_MAX).optional().default(S.SEARCH_LIMIT_DEFAULT),
    offset: z.coerce.number().int().min(0).optional().default(0),
});

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
    purpose: z.string().min(S.PURPOSE_MIN).max(S.PURPOSE_MAX),
    target: z.enum(['user', 'system']).optional().default('user'),
    category: z.enum(SKILL_CATEGORIES).optional(),
    examples: z.array(z.string().max(S.EXAMPLE_MAX)).max(S.EXAMPLES_COUNT_MAX).optional(),
    hints: z.string().max(S.HINTS_MAX).optional(),
});

/** 일괄 draft 처리 — 한 요청에서 여러 스킬을 승인/거부 (부분 성공 허용) */
export const bulkDraftActionSchema = z.object({
    skillIds: z.array(z.string().min(1).max(S.SKILL_ID_MAX)).min(1).max(S.SKILL_IDS_COUNT_MAX),
    action: z.enum(['approve', 'reject']),
});

export const draftsQuerySchema = z.object({
    target: z.enum(['user', 'system', 'all']).default('user'),
    limit: z.coerce.number().int().positive().max(S.LIST_LIMIT_MAX).default(S.LIST_LIMIT_DEFAULT),
    offset: z.coerce.number().int().nonnegative().default(0),
});

// LLM 응답 검증 (SkillCreatorService 가 사용)
export const llmSkillManifestSchema = z.object({
    name: z.string().min(S.CREATE_NAME_MIN).max(S.CREATE_NAME_MAX),
    description: z.string().min(S.CREATE_DESCRIPTION_MIN).max(S.CREATE_DESCRIPTION_MAX),
    category: z.enum(SKILL_CATEGORIES).default('general'),
    content: z.string().min(S.CREATE_CONTENT_MIN).max(S.CREATE_CONTENT_MAX),
    triggers: z.array(z.string().max(S.TRIGGER_MAX)).max(S.TRIGGERS_COUNT_MAX).optional().default([]),
    tags: z.array(z.string().max(S.TAG_MAX)).max(S.TAGS_COUNT_MAX).optional().default([]),
});

export type LlmSkillManifest = z.infer<typeof llmSkillManifestSchema>;
