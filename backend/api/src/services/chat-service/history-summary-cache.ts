/**
 * ============================================================
 * History Summary Cache — 세션별 사전 요약 캐시
 * ============================================================
 *
 * 이전 턴 응답 완료 후 백그라운드로 미리 요약한 결과를 저장하고,
 * 다음 턴 시작 시 즉시 사용하여 inline summarize LLM 호출(500~1500ms)을 우회합니다.
 *
 * 캐시 hit 조건: (sessionId, historyLength) 정확 일치.
 * Mismatch 시 caller 가 inline summarize 로 자동 fallback (안전).
 *
 * @module services/chat-service/history-summary-cache
 */
import { createLogger } from '../../utils/logger';

const logger = createLogger('HistorySummaryCache');

export interface CachedSummaryMessage {
    role: string;
    content: string;
    images?: string[];
}

interface CacheEntry {
    historyLength: number;
    messages: CachedSummaryMessage[];
    expiresAt: number;
}

const MAX_ENTRIES = 500;
const TTL_MS = 30 * 60_000;

class HistorySummaryCache {
    private store = new Map<string, CacheEntry>();

    get(sessionId: string, historyLength: number): CachedSummaryMessage[] | null {
        const entry = this.store.get(sessionId);
        if (!entry) return null;
        if (entry.expiresAt < Date.now()) {
            this.store.delete(sessionId);
            return null;
        }
        if (entry.historyLength !== historyLength) return null;
        return entry.messages;
    }

    set(sessionId: string, historyLength: number, messages: CachedSummaryMessage[]): void {
        if (this.store.size >= MAX_ENTRIES) {
            const oldestKey = this.store.keys().next().value;
            if (oldestKey !== undefined) this.store.delete(oldestKey);
        }
        this.store.set(sessionId, { historyLength, messages, expiresAt: Date.now() + TTL_MS });
        logger.debug(`사전 요약 저장: sessionId=${sessionId.slice(0, 8)}…, length=${historyLength}, msgs=${messages.length}`);
    }

    invalidate(sessionId: string): void {
        if (this.store.delete(sessionId)) {
            logger.debug(`캐시 무효화: sessionId=${sessionId.slice(0, 8)}…`);
        }
    }

    size(): number {
        return this.store.size;
    }
}

export const historySummaryCache = new HistorySummaryCache();
