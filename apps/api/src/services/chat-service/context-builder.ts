/**
 * ============================================================
 * Context Builder — LLM 컨텍스트 구성 모듈
 * ============================================================
 *
 * 첨부 파일·웹검색 컨텍스트를 사용자 메시지에 통합합니다.
 * (문서 첨부, 사용자 메모리 통합은 2026-05-19 제거됨)
 *
 * @module services/chat-service/context-builder
 */

/**
 * buildContextForLLM 함수의 입력 파라미터
 */
interface BuildContextParams {
    /** 사용자 원본 메시지 */
    message: string;
    /** 웹검색 컨텍스트 */
    webSearchContext: string | undefined;
    /** 첨부 파일 컨텍스트 (텍스트 파일 내용/바이너리 메타) */
    fileContext?: string;
}

/**
 * buildContextForLLM 함수의 반환값
 */
interface BuildContextResult {
    /** 최종 강화된 사용자 메시지 */
    finalEnhancedMessage: string;
}

/**
 * 첨부 파일·웹검색 컨텍스트를 통합하여 최종 사용자 메시지를 구성합니다.
 *
 * @param params - 컨텍스트 구성에 필요한 파라미터
 * @returns 최종 강화된 메시지
 */
export async function buildContextForLLM(params: BuildContextParams): Promise<BuildContextResult> {
    const { message, webSearchContext, fileContext } = params;

    let finalEnhancedMessage = '';
    if (fileContext) finalEnhancedMessage += fileContext;
    if (webSearchContext) finalEnhancedMessage += webSearchContext;
    finalEnhancedMessage += `\n## USER QUESTION\n${message}`;

    return { finalEnhancedMessage };
}
