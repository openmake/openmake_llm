/**
 * 다음 턴을 위한 사전 요약(백그라운드) — request-handler.ts 에서 분리 (max-lines 가드).
 *
 * @module chat/history-presummary
 */
import { historySummaryCache } from '../services/chat-service/history-summary-cache';
import { summarizeHistory } from './history-summarizer';
import { HISTORY_SUMMARIZER } from '../config/runtime-limits';
import { createLogger } from '../utils/logger';
import type { ChatRequestParams } from './request-handler-types';

// 로그 모듈명은 분리 전과 같게 둔다(운영 로그 검색 호환).
const log = createLogger('ChatRequestHandler');

export function scheduleHistoryPresummary(
    history: ChatRequestParams['history'],
    message: string,
    cleanedResponse: string,
    maskedModel: string,
    currentSessionId: string,
): void {
    // 8. 다음 턴을 위한 사전 요약 (백그라운드, fire-and-forget)
    // 새 history = 기존 + user message + cleanedResponse (placeholder 포함).
    // 길이가 임계값 이상일 때만 요약 LLM 호출. 실패는 무시 (다음 턴이 inline fallback).
    // 캐시는 ChatRequest 시 cached.length === request.history.length 정확 일치만 사용.
    const newHistoryLength = (history?.length ?? 0) + 2;
    if (newHistoryLength >= HISTORY_SUMMARIZER.MIN_MESSAGES_TO_SUMMARIZE) {
        const newHistory = [
            ...(history ?? []),
            { role: 'user', content: message },
            { role: 'assistant', content: cleanedResponse },
        ];
        void summarizeHistory(newHistory, maskedModel)
            .then((s) => {
                if (s.wasSummarized) {
                    historySummaryCache.set(currentSessionId, newHistoryLength, s.messages);
                }
            })
            .catch((err) => log.warn(`[RequestHandler] 사전 요약 백그라운드 실패 (무시): ${err instanceof Error ? err.message : err}`));
    }
}
