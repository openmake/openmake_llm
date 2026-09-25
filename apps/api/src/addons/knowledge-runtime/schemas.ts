/**
 * Knowledge 라우트 입력 Zod 스키마 — 길이 상한은 `validation.ts` 상수에서, 정책값은 프로필에서 온다.
 * 프로필 PUT 은 kind 별 스키마 룩업 맵으로 검증한다(if-체인 금지).
 *
 * @module addons/knowledge-runtime/schemas
 */
import { z } from 'zod';
import type { KnowledgeScopeType } from '@openmake/shared-types';
import { KNOWLEDGE_VALIDATION as V } from './validation';
import { SCOPE_TYPES } from './config/scope-policy';

const scopeTypeEnum = z.enum(SCOPE_TYPES as [KnowledgeScopeType, ...KnowledgeScopeType[]]);

export const createSpaceSchema = z.object({
    name: z.string().trim().min(V.NAME_MIN).max(V.NAME_MAX),
    description: z.string().max(V.DESCRIPTION_MAX).optional(),
    icon: z.string().max(V.ICON_MAX).optional(),
    instructions: z.string().max(V.INSTRUCTIONS_MAX).optional(),
    scopeType: scopeTypeEnum.optional(),
});
export type CreateSpaceBody = z.infer<typeof createSpaceSchema>;

export const updateSpaceSchema = z
    .object({
        name: z.string().trim().min(V.NAME_MIN).max(V.NAME_MAX).optional(),
        description: z.string().max(V.DESCRIPTION_MAX).nullable().optional(),
        icon: z.string().max(V.ICON_MAX).nullable().optional(),
        instructions: z.string().max(V.INSTRUCTIONS_MAX).nullable().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: '변경할 필드가 없습니다' });
export type UpdateSpaceBody = z.infer<typeof updateSpaceSchema>;

/** Space 메모리 입력 — 비지 않은 content(하드 캡). 정책 상한(항목당 문자 수)은 서비스가 프로필로 재검사한다. */
export const memoryInputSchema = z.object({
    content: z.string().trim().min(1).max(V.MEMORY_CONTENT_MAX),
});
export type MemoryInputBody = z.infer<typeof memoryInputSchema>;

// ── 프로필 kind 별 config 스키마 (관리자 PUT /admin/profiles/:id) ──
const chunkerConfig = z.object({
    strategy: z.string().min(1),
    size: z.number().int().positive(),
    overlap: z.number().int().nonnegative(),
});
const retrievalConfig = z.object({
    topK: z.number().int().positive(),
    candidateCount: z.number().int().positive(),
    minSimilarity: z.number().min(0).max(1),
    maxContextChars: z.number().int().positive(),
    maxTopK: z.number().int().positive(),
});
const limitsConfig = z.object({
    maxFileBytes: z.number().int().positive(),
    maxDocumentsPerSpace: z.number().int().positive(),
    maxSpacesPerScope: z.number().int().positive(),
    allowedMimeTypes: z.array(z.string().min(1)).min(1),
    purgeAfterDays: z.number().int().nonnegative(),
    minCharsPerPdfPage: z.number().int().nonnegative(),
    embedBatchSize: z.number().int().positive(),
    ingestConcurrency: z.number().int().positive(),
    jobLeaseMs: z.number().int().positive(),
    jobMaxAttempts: z.number().int().positive(),
    orgWriteRoles: z.array(z.string().min(1)),
    // Space 지침·메모리 주입 정책 — optional(구 시드 DB 호환). z.object 는 미선언 키를 버리므로
    // 관리자 PUT 이 이 값을 삭제하지 않도록 반드시 선언해 둔다(admin/service updateProfile).
    maxInstructionTokens: z.number().int().positive().optional(),
    maxMemoryItems: z.number().int().positive().optional(),
    maxMemoryCharsPerItem: z.number().int().positive().optional(),
    maxMemoryTokens: z.number().int().positive().optional(),
});
const spaceConfig = z.object({
    chunker: z.string().min(1),
    retrieval: z.string().min(1),
    limits: z.string().min(1),
});

/** kind → config 스키마. 알 수 없는 kind 는 맵에 없으므로 검증 거절로 이어진다. */
export const PROFILE_CONFIG_SCHEMAS: Readonly<Record<string, z.ZodTypeAny>> = {
    chunker: chunkerConfig,
    retrieval: retrievalConfig,
    limits: limitsConfig,
    space: spaceConfig,
};

/** 프로필 PUT 바디 — name(선택) + config(kind 별 검증). config 는 라우트에서 kind 로 재검증한다. */
export const updateProfileSchema = z.object({
    name: z.string().trim().min(1).max(V.PROFILE_NAME_MAX).optional(),
    config: z.record(z.string(), z.unknown()),
});
export type UpdateProfileBody = z.infer<typeof updateProfileSchema>;
