/**
 * ============================================================
 * Canvas Schema - 캔버스 문서 Zod 검증 스키마
 * ============================================================
 *
 * 캔버스 문서 생성, 수정, 공유 요청의 유효성을 검증하는
 * Zod 스키마와 추론된 TypeScript 타입을 정의합니다.
 *
 * @module schemas/canvas.schema
 */
import { z } from 'zod';

/**
 * 캔버스 문서 생성 스키마
 * @property {string} title - 문서 제목 (1~200자, 필수)
 * @property {string} [docType] - 문서 유형 (markdown/plain/html, 기본값: markdown)
 * @property {string} [content] - 문서 내용
 * @property {string} [language] - 프로그래밍 언어 (코드 문서인 경우)
 * @property {string} [sessionId] - 세션 ID (선택적 연결)
 */
export const createCanvasSchema = z.object({
    title: z.string().min(1, '문서 제목을 입력하세요').max(200),
    docType: z.enum(['markdown', 'plain', 'html']).optional().default('markdown'),
    content: z.string().max(500000).optional(),
    language: z.string().max(50).optional(),
    sessionId: z.string().uuid().optional()
});

/**
 * 캔버스 문서 수정 스키마
 */
export const updateCanvasSchema = z.object({
    title: z.string().min(1, '문서 제목을 입력하세요').max(200).optional(),
    content: z.string().max(500000).optional(),
    changeSummary: z.string().max(500).optional()
});

/** 캔버스 문서 생성 요청 TypeScript 타입 */
export type CreateCanvasInput = z.infer<typeof createCanvasSchema>;
/** 캔버스 문서 수정 요청 TypeScript 타입 */
export type UpdateCanvasInput = z.infer<typeof updateCanvasSchema>;
