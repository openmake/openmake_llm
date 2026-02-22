/**
 * ============================================================
 * Skills Schema - 스킬 API 요청 Zod 검증 스키마
 * ============================================================
 *
 * 스킬 생성/수정/검색 및 마켓플레이스 임포트 요청의
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
export const searchSkillsQuerySchema = z.object({
    search: z.string().max(200).optional(),
    category: z.string().max(100).optional(),
    isPublic: z.coerce.boolean().optional(),
    sortBy: z.enum(['newest', 'name', 'category', 'updated']).optional().default('newest'),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    offset: z.coerce.number().int().min(0).optional().default(0),
});

export type SearchSkillsQuery = z.infer<typeof searchSkillsQuerySchema>;

// POST /api/skills-marketplace/import — 마켓플레이스 임포트
export const importSkillSchema = z.object({
    repo: z.string().min(1, 'repo는 필수입니다'),
    path: z.string().min(1, 'path는 필수입니다'),
    name: z.string().max(200).optional(),
    category: z.string().max(100).optional(),
});

export type ImportSkillInput = z.infer<typeof importSkillSchema>;

// GET /api/skills-marketplace/search query params — 마켓플레이스 검색
export const searchMarketplaceQuerySchema = z.object({
    query: z.string().max(200).optional().default(''),
    category: z.string().max(100).optional(),
    sort: z.enum(['stars', 'recent']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    offset: z.coerce.number().int().min(0).optional().default(0),
});

export type SearchMarketplaceQuery = z.infer<typeof searchMarketplaceQuerySchema>;

// GET /api/skills-marketplace/detail query params — 마켓플레이스 상세 조회
export const detailQuerySchema = z.object({
    repo: z.string().min(1, 'repo는 필수입니다'),
    path: z.string().min(1, 'path는 필수입니다'),
});

export type DetailQuery = z.infer<typeof detailQuerySchema>;
