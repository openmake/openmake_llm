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

import { LLMClient, createClient } from '../llm';
import { createLogger } from '../utils/logger';
import { HISTORY_SUMMARIZER } from '../config/runtime-limits';
import { estimateTokens } from '../llm/model-pool';
import { LLM_TEMPERATURES } from '../config/llm-parameters';
import { SUMMARY_SYSTEM_PROMPT } from './prompt-templates';

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
// 히스토리 요약 LLM 호출이 연속 실패하면 차단한다 (하네스 원칙⑥ Latch — 매 요청 실패를
// 반복해 지연·비용을 낭비하는 것을 방지). web-scraper circuit breaker 와 동형.
const SUMMARIZE_BREAKER = { failures: 0, openedAt: 0 };
const SUMMARIZE_BREAKER_THRESHOLD = 3;
const SUMMARIZE_BREAKER_RESET_MS = 5 * 60 * 1000;
function summarizeBreakerOpen(): boolean {
    if (SUMMARIZE_BREAKER.failures < SUMMARIZE_BREAKER_THRESHOLD) return false;
    if (Date.now() - SUMMARIZE_BREAKER.openedAt > SUMMARIZE_BREAKER_RESET_MS) {
        SUMMARIZE_BREAKER.failures = 0; // 리셋 윈도우 경과 → 재시도 허용
        return false;
    }
    return true;
}

export async function summarizeHistory(
    history: HistoryMessage[],
    model: string
): Promise<SummarizedHistory> {
    const originalCount = history.length;

    // 트리거: 메시지 개수 OR 누적 토큰 (거대 메시지 소수 대응 — count 단독은 놓침).
    // 요약하려면 보존분(RECENT_MESSAGES_TO_KEEP) 외 오래된 메시지가 최소 1개는 있어야 함.
    const totalTokens = history.reduce((sum, m) => sum + estimateTokens(m.content || ''), 0);
    const countTrigger = originalCount >= HISTORY_SUMMARIZER.MIN_MESSAGES_TO_SUMMARIZE;
    const tokenTrigger =
        totalTokens >= HISTORY_SUMMARIZER.MIN_TOKENS_TO_SUMMARIZE &&
        originalCount > HISTORY_SUMMARIZER.RECENT_MESSAGES_TO_KEEP;

    if (!countTrigger && !tokenTrigger) {
        return {
            messages: history,
            wasSummarized: false,
            originalCount,
            summarizedCount: originalCount,
        };
    }

    // circuit breaker: 연속 요약 실패 시 압축을 건너뛰고 원본을 사용한다 (채팅 진행 우선).
    if (summarizeBreakerOpen()) {
        logger.warn('히스토리 요약 circuit OPEN — 압축 건너뜀(원본 유지)');
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
        const client: LLMClient = createClient({
            model,
            timeout: HISTORY_SUMMARIZER.SUMMARY_TIMEOUT_MS,
        });

        const result = await client.chat(
            [
                { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
                { role: 'user', content: olderText },
            ],
            {
                temperature: LLM_TEMPERATURES.HISTORY_SUMMARY,
                num_predict: HISTORY_SUMMARIZER.MAX_SUMMARY_TOKENS,
            },
            undefined,
            {
                // 요약 태스크는 reasoning 불필요 — MAX_SUMMARY_TOKENS 가 reasoning 으로
                // 소비되면 본 요약문이 잘려나가 fallback notice 만 노출되는 사고 방지.
                think: false,
            }
        );

        SUMMARIZE_BREAKER.failures = 0; // LLM 호출 성공 → circuit 복구
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
        const errMsg = error instanceof Error ? error.message : String(error);
        // 연속 실패 누적 → threshold 도달 시 circuit OPEN (이후 RESET_MS 동안 압축 skip)
        SUMMARIZE_BREAKER.failures += 1;
        if (SUMMARIZE_BREAKER.failures >= SUMMARIZE_BREAKER_THRESHOLD) {
            SUMMARIZE_BREAKER.openedAt = Date.now();
            logger.warn(`히스토리 요약 ${SUMMARIZE_BREAKER.failures}회 연속 실패 — circuit OPEN (${SUMMARIZE_BREAKER_RESET_MS / 1000}s)`);
        }
        logger.warn(`히스토리 요약 실패 (원본 유지): ${errMsg}`);
        return {
            messages: history,
            wasSummarized: false,
            originalCount,
            summarizedCount: originalCount,
        };
    }
}
