/**
 * ============================================================
 * Documents Schema - 문서 처리 Zod 검증 스키마
 * ============================================================
 *
 * 문서 요약 및 Q&A 요청의 유효성을 검증하는
 * Zod 스키마와 추론된 TypeScript 타입을 정의합니다.
 *
 * @module schemas/documents.schema
 */
import { z } from 'zod';
import { secureTextSchema, secureOptionalTextSchema } from './security.schema';

/**
 * 문서 요약 스키마
 * @property {string} docId - 업로드된 문서 ID (필수)
 * @property {string} [model] - 사용할 모델 별칭
 */
export const summarizeDocumentSchema = z.object({
    docId: secureTextSchema({ minLength: 1, maxLength: 500, fieldName: 'docId', allowNewLines: false }),
    model: secureOptionalTextSchema({ maxLength: 200, fieldName: 'model', allowNewLines: false }),
});

/**
 * 문서 Q&A 스키마
 * @property {string} docId - 업로드된 문서 ID (필수)
 * @property {string} question - 질문 내용 (필수, 5000자 이하)
 * @property {string} [model] - 사용할 모델 별칭
 */
export const documentAskSchema = z.object({
    docId: secureTextSchema({ minLength: 1, maxLength: 500, fieldName: 'docId', allowNewLines: false }),
    question: secureTextSchema({ minLength: 1, maxLength: 5000, fieldName: 'question', allowHtmlLikeContent: true, detectMaliciousPatterns: false }),
    model: secureOptionalTextSchema({ maxLength: 200, fieldName: 'model', allowNewLines: false }),
});

/** 문서 요약 요청 TypeScript 타입 */
export type SummarizeDocumentInput = z.infer<typeof summarizeDocumentSchema>;
/** 문서 Q&A 요청 TypeScript 타입 */
export type DocumentAskInput = z.infer<typeof documentAskSchema>;
