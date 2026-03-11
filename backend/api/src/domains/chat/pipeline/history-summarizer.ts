/**
 * ============================================================
 * History Summarizer - 대화 히스토리 압축 모듈
 * ============================================================
 *
 * 긴 대화 히스토리를 LLM으로 요약하여 토큰 비용을 절감합니다.
 * 최근 N개 메시지는 그대로 유지하고, 나머지 오래된 메시지를
 * 하나의 요약문으로 압축합니다.
 *
 * @module chat/history-summarizer
 * @see services/ChatService - processMessage()에서 히스토리 조립 전 호출
 */

import { OllamaClient, createClient } from '../../../ollama/client';
import { createLogger } from '../../../utils/logger';
import { HISTORY_SUMMARIZER } from '../../../config/runtime-limits';
import { errorMessage } from '../../../utils/error-message';

const logger = createLogger('HistorySummarizer');

interface HistoryMessage {
    role: string;
    content: string;
    images?: string[];
}

interface SummarizedHistory {
    messages: HistoryMessage[];
    wasSummarized: boolean;
    originalCount: number;
    summarizedCount: number;
}

const SUMMARY_SYSTEM_PROMPT = `You are a conversation summarizer. Summarize the older conversation messages into a concise paragraph that preserves:
- Key topics discussed
- Important decisions or conclusions
- User preferences or requirements mentioned
- Any unresolved questions

Output ONLY the summary paragraph. No headers, no bullet points, no explanation.
Keep it under 200 words. Use the same language as the conversation.`;

/**
 * 긴 대화 히스토리를 요약하여 압축합니다.
 *
 * - 히스토리가 MIN_MESSAGES_TO_SUMMARIZE 미만이면 그대로 반환
 * - 최근 RECENT_MESSAGES_TO_KEEP개는 원문 유지
 * - 나머지 오래된 메시지를 LLM으로 요약하여 system 메시지로 삽입
 *
 * @param history - 원본 대화 히스토리
 * @param model - 요약에 사용할 모델명
 * @returns 압축된 히스토리 배열과 메타데이터
 */
export async function summarizeHistory(
    history: HistoryMessage[],
    model: string
): Promise<SummarizedHistory> {
    const originalCount = history.length;

    if (originalCount < HISTORY_SUMMARIZER.MIN_MESSAGES_TO_SUMMARIZE) {
        return {
            messages: history,
            wasSummarized: false,
            originalCount,
            summarizedCount: originalCount,
        };
    }

    const keepCount = HISTORY_SUMMARIZER.RECENT_MESSAGES_TO_KEEP;
    const olderMessages = history.slice(0, -keepCount);
    const recentMessages = history.slice(-keepCount);

    // 오래된 메시지를 텍스트로 변환
    let olderText = olderMessages
        .map(m => `${m.role}: ${m.content}`)
        .join('\n');

    // 입력 길이 제한
    if (olderText.length > HISTORY_SUMMARIZER.MAX_CHARS_FOR_SUMMARY_INPUT) {
        olderText = olderText.substring(0, HISTORY_SUMMARIZER.MAX_CHARS_FOR_SUMMARY_INPUT) + '\n...(truncated)';
    }

    try {
        const client: OllamaClient = createClient({
            model,
            timeout: HISTORY_SUMMARIZER.SUMMARY_TIMEOUT_MS,
        });

        const result = await client.chat(
            [
                { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
                { role: 'user', content: olderText },
            ],
            {
                temperature: 0.3,
                num_predict: HISTORY_SUMMARIZER.MAX_SUMMARY_TOKENS,
            }
        );

        const summary = result.content?.trim();
        if (!summary || summary.length < 20) {
            logger.warn('히스토리 요약 결과가 너무 짧음 — 원본 유지');
            return {
                messages: history,
                wasSummarized: false,
                originalCount,
                summarizedCount: originalCount,
            };
        }

        // 요약문을 system 메시지로 삽입 + 최근 메시지 유지
        const summarizedMessages: HistoryMessage[] = [
            {
                role: 'system',
                content: `[Previous conversation summary]\n${summary}`,
            },
            ...recentMessages,
        ];

        logger.info(
            `히스토리 요약 완료: ${olderMessages.length}개 → 1개 요약 + ${recentMessages.length}개 유지 ` +
            `(${olderText.length}자 → ${summary.length}자)`
        );

        return {
            messages: summarizedMessages,
            wasSummarized: true,
            originalCount,
            summarizedCount: summarizedMessages.length,
        };
    } catch (error) {
        const errMsg = errorMessage(error);
        logger.warn(`히스토리 요약 실패 (원본 유지): ${errMsg}`);
        return {
            messages: history,
            wasSummarized: false,
            originalCount,
            summarizedCount: originalCount,
        };
    }
}
