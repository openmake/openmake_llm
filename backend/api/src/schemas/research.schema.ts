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

/**
 * 리서치 세션 생성 스키마
 * @property {string} topic - 리서치 주제 (1~500자, 필수)
 * @property {string} [depth] - 리서치 깊이 (basic/deep/comprehensive, 기본값: deep)
 */
export const createResearchSessionSchema = z.object({
    topic: z.string().min(1, '리서치 주제를 입력하세요').max(500),
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
    query: z.string().max(1000).optional(),
    result: z.string().max(50000).optional(),
    sources: z.array(z.string().url()).optional(),
    status: z.enum(['pending', 'completed', 'failed']).optional().default('pending')
});

/**
 * 리서치 세션 상태 업데이트 스키마
 */
export const updateResearchSessionSchema = z.object({
    status: z.enum(['pending', 'in_progress', 'completed', 'failed']).optional(),
    progress: z.number().min(0).max(100).optional(),
    summary: z.string().max(10000).optional(),
    keyFindings: z.array(z.string()).optional(),
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
