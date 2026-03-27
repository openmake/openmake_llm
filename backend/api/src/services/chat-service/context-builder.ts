/**
 * ============================================================
 * Context Builder — LLM 컨텍스트 구성 모듈
 * ============================================================
 *
 * 문서, 웹검색, 메모리 컨텍스트를 통합하여 최종 사용자 메시지를 구성합니다.
 * ChatService.buildContextForLLM 메서드에서 추출되었습니다.
 *
 * @module services/chat-service/context-builder
 */
import { createLogger } from '../../utils/logger';
import { isGeminiModel } from '../../ollama/types';
import { CONTEXT_LIMITS, GREETING_DETECTION } from '../../config/runtime-limits';
import { applySequentialThinking } from '../../mcp/sequential-thinking';
import type { DocumentStore } from '../../documents/store';

const logger = createLogger('ContextBuilder');

/**
 * buildContextForLLM 함수의 입력 파라미터
 */
export interface BuildContextParams {
    /** 사용자 원본 메시지 */
    message: string;
    /** 첨부 문서 ID */
    docId: string | undefined;
    /** 업로드된 문서 저장소 */
    uploadedDocuments: DocumentStore;
    /** 사용자 ID */
    userId: string | undefined;
    /** 웹검색 컨텍스트 */
    webSearchContext: string | undefined;
    /** Sequential Thinking 모드 활성화 여부 */
    thinkingMode: boolean | undefined;
    /** API Key ID (외부 서비스 요청 판별용) */
    apiKeyId?: string;
    /** 현재 클라이언트의 모델명 (Gemini 컨텍스트 한도 판별용) */
    clientModel: string;
}

/**
 * buildContextForLLM 함수의 반환값
 */
export interface BuildContextResult {
    /** 최종 강화된 사용자 메시지 */
    finalEnhancedMessage: string;
    /** 문서에서 추출된 이미지 배열 */
    documentImages: string[];
}

/**
 * 문서, 웹검색, 메모리 컨텍스트를 통합하여 최종 사용자 메시지를 구성합니다.
 *
 * @param params - 컨텍스트 구성에 필요한 파라미터
 * @returns 최종 강화된 메시지와 문서 이미지 배열
 */
export async function buildContextForLLM(params: BuildContextParams): Promise<BuildContextResult> {
    const {
        message, docId, uploadedDocuments, userId,
        webSearchContext, thinkingMode, apiKeyId, clientModel,
    } = params;

    // 문서 컨텍스트 구성: 업로드된 문서의 텍스트와 이미지를 추출
    let documentContext = '';
    const documentImages: string[] = [];

    if (docId) {
        const doc = uploadedDocuments.get(docId);
        if (doc) {
            let docText = doc.text || '';
            const maxChars = isGeminiModel(clientModel) ? CONTEXT_LIMITS.GEMINI_MAX_CONTEXT_CHARS : CONTEXT_LIMITS.DEFAULT_MAX_CONTEXT_CHARS;

            if (docText.length > maxChars) {
                const half = Math.floor(maxChars / 2);
                const front = docText.substring(0, half);
                const back = docText.substring(docText.length - half);
                docText = `${front}\n\n... [중간 내용 생략] ...\n\n${back}`;
            }

            documentContext = `## \u{1F4DA} REFERENCE DOCUMENT: ${doc.filename}\n` +
                `Type: ${doc.type.toUpperCase()}\n` +
                `Length: ${doc.text.length} chars\n\n` +
                `CONTENT:\n---\n${docText}\n---\n\n` +
                'Please analyze the document above and answer the user\'s question.\n\n';

            if (['image', 'pdf'].includes(doc.type) && doc.info?.base64) {
                documentImages.push(doc.info.base64);
            }
        }
    }

    // ── Memory 컨텍스트 주입: 사용자별 기억된 정보를 응답에 반영 ──
    // API Key 요청: 외부 서비스의 메모리와 내부 메모리가 교차 오염되지 않도록 스킵
    // 짧은 인사/단순 메시지에는 메모리 주입을 스킵하여 불필요한 컨텍스트 오염 방지
    let memoryContextStr = '';
    const isSimpleGreeting = message.trim().length < GREETING_DETECTION.MAX_LENGTH && GREETING_DETECTION.PATTERN.test(message.trim());
    if (userId && !isSimpleGreeting && !apiKeyId) {
        try {
            const { getMemoryService } = await import('../MemoryService');
            const memoryService = getMemoryService();
            const memoryContext = await memoryService.buildMemoryContext(userId, message);
            if (memoryContext.contextString) {
                memoryContextStr = memoryContext.contextString;
                logger.info(`Memory 컨텍스트 주입: ${memoryContext.memories.length}개 메모리`);
            }
        } catch (memError) {
            logger.warn('Memory 컨텍스트 로드 실패 (무시하고 계속):', memError);
        }
    }

    const enhancedUserMessage = applySequentialThinking(message, thinkingMode === true);

    let finalEnhancedMessage = '';
    if (documentContext) finalEnhancedMessage += documentContext;
    if (memoryContextStr) finalEnhancedMessage += memoryContextStr;
    if (webSearchContext) finalEnhancedMessage += webSearchContext;
    finalEnhancedMessage += `\n## USER QUESTION\n${enhancedUserMessage}`;

    return { finalEnhancedMessage, documentImages };
}
