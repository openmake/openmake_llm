/**
 * ============================================================
 * Memory Schema - 메모리 Zod 검증 스키마
 * ============================================================
 *
 * 메모리 생성, 수정 요청의 유효성을 검증하는
 * Zod 스키마와 추론된 TypeScript 타입을 정의합니다.
 *
 * @module schemas/memory.schema
 */
import { z } from 'zod';

/**
 * 메모리 생성 스키마
 * @property {string} category - 카테고리 (1~50자, 필수)
 * @property {string} key - 키 (1~200자, 필수, 고유)
 * @property {string} value - 값 (1~10000자, 필수)
 * @property {number} [importance] - 중요도 (0~10, 기본값: 5)
 * @property {string[]} [tags] - 태그 배열
 */
export const createMemorySchema = z.object({
    category: z.string().min(1, '카테고리를 입력하세요').max(50),
    key: z.string().min(1, '키를 입력하세요').max(200),
    value: z.string().min(1, '값을 입력하세요').max(10000),
    importance: z.number().min(0).max(10).optional().default(5),
    tags: z.array(z.string().max(30)).optional()
});

/**
 * 메모리 수정 스키마
 */
export const updateMemorySchema = z.object({
    value: z.string().min(1, '값을 입력하세요').max(10000).optional(),
    importance: z.number().min(0).max(10).optional()
});

/** 메모리 생성 요청 TypeScript 타입 */
export type CreateMemoryInput = z.infer<typeof createMemorySchema>;
/** 메모리 수정 요청 TypeScript 타입 */
export type UpdateMemoryInput = z.infer<typeof updateMemorySchema>;
