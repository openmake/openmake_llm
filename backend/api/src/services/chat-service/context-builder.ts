/**
 * ============================================================
 * Context Builder — LLM 컨텍스트 구성 모듈
 * ============================================================
 *
 * 웹검색 컨텍스트를 사용자 메시지에 통합합니다.
 * (문서 첨부, 사용자 메모리 통합은 2026-05-19 제거됨)
 *
 * @module services/chat-service/context-builder
 */
import { GREETING_DETECTION } from '../../config/runtime-limits';
import { applySequentialThinking } from '../../mcp/sequential-thinking';

void GREETING_DETECTION; // 의도적 보존: 향후 컨텍스트 게이트 재도입 시 사용 예정

/**
 * buildContextForLLM 함수의 입력 파라미터
 */
export interface BuildContextParams {
    /** 사용자 원본 메시지 */
    message: string;
    /** 웹검색 컨텍스트 */
    webSearchContext: string | undefined;
    /** Sequential Thinking 모드 활성화 여부 */
    thinkingMode: boolean | undefined;
    /** API Key ID (외부 서비스 요청 판별용, 현재 미사용 — 호환성 보존) */
    apiKeyId?: string;
    /** 현재 클라이언트의 모델명 (현재 미사용 — 호환성 보존) */
    clientModel: string;
}

/**
 * buildContextForLLM 함수의 반환값
 */
export interface BuildContextResult {
    /** 최종 강화된 사용자 메시지 */
    finalEnhancedMessage: string;
    /** 문서에서 추출된 이미지 배열 (현재 항상 빈 배열 — 문서 첨부 폐기) */
    documentImages: string[];
}

/**
 * 웹검색 컨텍스트를 통합하여 최종 사용자 메시지를 구성합니다.
 *
 * @param params - 컨텍스트 구성에 필요한 파라미터
 * @returns 최종 강화된 메시지와 (빈) 이미지 배열
 */
export async function buildContextForLLM(params: BuildContextParams): Promise<BuildContextResult> {
    const { message, webSearchContext, thinkingMode } = params;

    const enhancedUserMessage = applySequentialThinking(message, thinkingMode === true);

    let finalEnhancedMessage = '';
    if (webSearchContext) finalEnhancedMessage += webSearchContext;
    finalEnhancedMessage += `\n## USER QUESTION\n${enhancedUserMessage}`;

    return { finalEnhancedMessage, documentImages: [] };
}
