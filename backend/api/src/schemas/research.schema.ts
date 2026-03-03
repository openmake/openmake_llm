/**
 * ============================================================
 * Research Schema - 리서치 Zod 검증 스키마
 * ============================================================
 *
 * 리서치 세션 생성, 스텝 추가, 실행 요청의 유효성을 검증하는
 * Zod 스키마와 추론된 TypeScript 타입을 정의합니다.
 *
 * @module schemas/research.schema
 */
import { z } from 'zod';
import { secureOptionalTextSchema, secureTextSchema } from './security.schema';

/**
 * 리서치 세션 생성 스키마
 * @property {string} topic - 리서치 주제 (1~500자, 필수)
 * @property {string} [depth] - 리서치 깊이 (basic/deep/comprehensive, 기본값: deep)
 */
export const createResearchSessionSchema = z.object({
    topic: secureTextSchema({ minLength: 1, maxLength: 500, fieldName: 'topic', detectMaliciousPatterns: false }),
    depth: z.enum(['basic', 'deep', 'comprehensive']).optional().default('deep')
});

/**
 * 리서치 스텝 추가 스키마
 * @property {number} stepNumber - 스텝 번호 (필수)
 * @property {string} stepType - 스텝 유형 (search/analysis/synthesis, 필수)
 * @property {string} [query] - 검색 쿼리
 * @property {string} [result] - 스텝 결과
 * @property {string[]} [sources] - 소스 URL 배열
 * @property {string} [status] - 스텝 상태 (pending/completed/failed)
 */
export const addResearchStepSchema = z.object({
    stepNumber: z.number().int().positive('스텝 번호는 양수여야 합니다'),
    stepType: z.enum(['search', 'analysis', 'synthesis']),
    query: secureOptionalTextSchema({ maxLength: 1000, fieldName: 'query', detectMaliciousPatterns: false }),
    result: secureOptionalTextSchema({ maxLength: 50000, fieldName: 'result', allowHtmlLikeContent: true, detectMaliciousPatterns: false }),
    sources: z.array(z.string().url()).optional(),
    status: z.enum(['pending', 'completed', 'failed']).optional().default('pending')
});

/**
 * 리서치 세션 상태 업데이트 스키마
 */
export const updateResearchSessionSchema = z.object({
    status: z.enum(['pending', 'in_progress', 'completed', 'failed']).optional(),
    progress: z.number().min(0).max(100).optional(),
    summary: secureOptionalTextSchema({ maxLength: 10000, fieldName: 'summary', allowHtmlLikeContent: true, detectMaliciousPatterns: false }),
    keyFindings: z.array(secureTextSchema({ maxLength: 1000, fieldName: 'keyFindings', detectMaliciousPatterns: false })).optional(),
    sources: z.array(z.string().url()).optional()
});

/**
 * 리서치 실행 스키마
 * @property {number} [maxLoops] - 최대 반복 횟수 (1~10, 기본값: 5)
 */
export const executeResearchSchema = z.object({
    maxLoops: z.number().int().min(1).max(10).optional().default(5)
});

/** 리서치 세션 생성 요청 TypeScript 타입 */
export type CreateResearchSessionInput = z.infer<typeof createResearchSessionSchema>;
/** 리서치 스텝 추가 요청 TypeScript 타입 */
export type AddResearchStepInput = z.infer<typeof addResearchStepSchema>;
/** 리서치 세션 상태 업데이트 요청 TypeScript 타입 */
export type UpdateResearchSessionInput = z.infer<typeof updateResearchSessionSchema>;
/** 리서치 실행 요청 TypeScript 타입 */
export type ExecuteResearchInput = z.infer<typeof executeResearchSchema>;
