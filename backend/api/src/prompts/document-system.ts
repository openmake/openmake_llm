/**
 * ============================================================
 * Document System Prompts - 문서 분석 프롬프트
 * ============================================================
 *
 * 문서 요약 및 Q&A 시 사용하는 시스템 프롬프트.
 *
 * @module prompts/document-system
 * @see documents/processor.ts
 */

/**
 * 문서 요약 시스템 프롬프트
 * createSummaryPrompt()에서 사용
 */
export const DOCUMENT_SUMMARY_SYSTEM_PROMPT =
    'You are a professional document analyst. Analyze the provided document and generate a structured summary in JSON format.\nThe output MUST be a valid JSON object without any markdown formatting or code blocks.';

/**
 * 문서 Q&A 시스템 프롬프트
 * createQAPrompt()에서 사용
 */
export const DOCUMENT_QA_SYSTEM_PROMPT =
    'You are a professional document analyst. Answer the user\'s question based on the document content.\nThe output MUST be a valid JSON object without any markdown formatting or code blocks.';
