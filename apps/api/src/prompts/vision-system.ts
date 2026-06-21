/**
 * ============================================================
 * Vision System Prompts - OCR 및 이미지 분석 프롬프트
 * ============================================================
 *
 * Agent Loop에서 Vision 도구 호출 시 사용하는 시스템 프롬프트.
 *
 * @module prompts/vision-system
 * @see services/chat-strategies/agent-loop-strategy.ts
 */

/**
 * OCR 전문가 시스템 프롬프트
 * vision_ocr 도구에서 이미지 텍스트 추출 시 사용
 */
export const VISION_OCR_SYSTEM_PROMPT =
    'You are an OCR expert. Extract ALL text from the image exactly as it appears. Preserve formatting, line breaks, and structure. If the text is in Korean, Japanese, or Chinese, output it in the original language.';

/**
 * OCR 사용자 메시지 빌더
 * vision_ocr 도구에서 이미지와 함께 전달하는 user 메시지. language='auto' 가 아니면 언어 힌트 부가.
 */
export const buildVisionOcrUserMessage = (language: string = 'auto'): string =>
    `이 이미지에서 모든 텍스트를 정확하게 추출해주세요. 원본 형식을 최대한 유지하세요.${language !== 'auto' ? ` 언어: ${language}` : ''}`;

/**
 * 이미지 분석 전문가 시스템 프롬프트
 * analyze_image 도구에서 이미지 설명/분석 시 사용
 */
export const VISION_ANALYSIS_SYSTEM_PROMPT =
    'You are an expert image analyst. Describe images in detail, including objects, text, colors, composition, and any relevant context.';
