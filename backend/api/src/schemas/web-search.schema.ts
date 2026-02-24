/**
 * ============================================================
 * Web Search Schema - 웹 검색 Zod 검증 스키마
 * ============================================================
 *
 * 웹 검색 요청의 유효성을 검증하는 Zod 스키마와
 * 추론된 TypeScript 타입을 정의합니다.
 *
 * @module schemas/web-search.schema
 */
import { z } from 'zod';

/**
 * 웹 검색 요청 스키마
 * @property {string} query - 검색 쿼리 (1~1000자, 필수)
 * @property {string} [model] - 사용할 모델 (기본값: default)
 */
export const webSearchSchema = z.object({
    query: z.string().min(1, '검색 쿼리를 입력하세요').max(1000, '검색 쿼리가 너무 깁니다 (최대 1000자)'),
    model: z.string().max(100).optional()
});

/** 웹 검색 요청 TypeScript 타입 */
export type WebSearchInput = z.infer<typeof webSearchSchema>;
