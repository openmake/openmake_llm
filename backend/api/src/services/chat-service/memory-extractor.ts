/**
 * ============================================================
 * Memory Extractor — 대화 메모리 자동 추출 모듈
 * ============================================================
 *
 * 대화에서 의미 있는 정보를 비동기로 추출하여 장기 메모리에 저장합니다.
 * ChatService.extractMemoriesAsync 메서드에서 추출되었습니다.
 *
 * @module services/chat-service/memory-extractor
 */
import { createLogger } from '../../utils/logger';
import { LLM_TIMEOUTS } from '../../config/timeouts';
import { LLM_TEMPERATURES, LLM_PREDICT_LIMITS } from '../../config/llm-parameters';
import type { OllamaClient } from '../../ollama/client';

const logger = createLogger('MemoryExtractor');

/**
 * extractMemoriesAsync 함수의 입력 파라미터
 */
export interface MemoryExtractorParams {
    /** 사용자 ID */
    userId: string;
    /** 사용자 메시지 */
    userMessage: string;
    /** AI 응답 */
    assistantResponse: string;
    /** 외부 컨텍스트(웹검색 등) 포함 여부 */
    hasExternalContext?: boolean;
    /** Ollama 클라이언트 인스턴스 (LLM 추출 호출용) */
    client: OllamaClient;
}

/**
 * 대화에서 메모리를 비동기로 추출합니다 (fire-and-forget).
 * LLM 추출기를 연결하여 의미 있는 정보를 자동으로 장기 메모리에 저장합니다.
 *
 * @param params - 메모리 추출에 필요한 파라미터
 */
export async function extractMemoriesAsync(params: MemoryExtractorParams): Promise<void> {
    const {
        userId, userMessage, assistantResponse,
        hasExternalContext = false, client,
    } = params;

    try {
        // 외부 컨텍스트(웹검색 등)가 주입된 답변은 메모리 추출 대상에서 제외
        if (hasExternalContext) {
            logger.debug('외부 컨텍스트(웹검색) 포함 답변 — 메모리 추출 스킵');
            return;
        }

        // 짧은 인사/단순 메시지는 메모리 추출 스킵
        if (userMessage.trim().length < 15) {
            return;
        }

        const { getMemoryService } = await import('../MemoryService');
        const memoryService = getMemoryService();

        // LLM 추출기: 현재 클라이언트를 활용하여 메모리 추출 프롬프트 실행
        const llmExtractor = async (prompt: string): Promise<string> => {
            const timeoutMs = LLM_TIMEOUTS.MEMORY_EXTRACTION_TIMEOUT_MS;
            let timeoutHandle: ReturnType<typeof setTimeout>;
            const result = await Promise.race([
                client.chat(
                    [{ role: 'user' as const, content: prompt }],
                    { temperature: LLM_TEMPERATURES.MEMORY_EXTRACTION, num_predict: LLM_PREDICT_LIMITS.MEMORY_EXTRACTION },
                ).finally(() => clearTimeout(timeoutHandle)),
                new Promise<never>((_, reject) => {
                    timeoutHandle = setTimeout(() => reject(new Error('Memory extraction timeout')), timeoutMs);
                }),
            ]);
            return result?.content || '';
        };

        const extracted = await memoryService.extractAndSaveMemories(
            userId, null, userMessage, assistantResponse, llmExtractor
        );

        if (extracted.length > 0) {
            logger.info(`장기 메모리 자동 추출: ${extracted.length}개 저장 (user=${userId})`);
        }
    } catch (e) {
        logger.debug('메모리 자동 추출 실패 (무시):', e instanceof Error ? e.message : e);
    }
}
