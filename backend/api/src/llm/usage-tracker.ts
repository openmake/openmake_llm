/**
 * ============================================================
 * LLM Usage Tracker — 토큰 기반 시간/주간 쿼터
 * ============================================================
 *
 * Ollama 시절의 시간/주간 호출 횟수 limit 을 LLM 토큰 사용량 기반으로 재정의합니다.
 *
 * 환경변수:
 *   LLM_HOURLY_TOKEN_LIMIT — 1시간 토큰 합산 한도 (기본 300_000)
 *   LLM_WEEKLY_TOKEN_LIMIT — 1주일 토큰 합산 한도 (기본 5_000_000)
 *
 * 호환: 기존 ollama/api-usage-tracker.ts 의 getQuotaStatus() 시그니처 유지 —
 * routes/usage.routes.ts, services/chat-service-metrics.ts 등 호출자 변경 불필요.
 *
 * @module llm/usage-tracker
 */
import { getConfig } from '../config';
import { createLogger } from '../utils/logger';

const logger = createLogger('LLMUsageTracker');

interface UsageWindow {
    startedAt: number;
    tokens: number;
}

export interface QuotaStatus {
    hourly: { used: number; limit: number; remaining: number };
    weekly: { used: number; limit: number; remaining: number };
}

const HOUR_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

class LLMUsageTracker {
    private hourly: UsageWindow = { startedAt: Date.now(), tokens: 0 };
    private weekly: UsageWindow = { startedAt: Date.now(), tokens: 0 };

    record(tokens: number): void {
        if (!Number.isFinite(tokens) || tokens <= 0) return;
        const now = Date.now();
        if (now - this.hourly.startedAt > HOUR_MS) {
            this.hourly = { startedAt: now, tokens: 0 };
        }
        if (now - this.weekly.startedAt > WEEK_MS) {
            this.weekly = { startedAt: now, tokens: 0 };
        }
        this.hourly.tokens += tokens;
        this.weekly.tokens += tokens;
    }

    getQuotaStatus(): QuotaStatus {
        const cfg = getConfig();
        const hourlyLimit = cfg.llmHourlyTokenLimit;
        const weeklyLimit = cfg.llmWeeklyTokenLimit;
        return {
            hourly: {
                used: this.hourly.tokens,
                limit: hourlyLimit,
                remaining: Math.max(0, hourlyLimit - this.hourly.tokens),
            },
            weekly: {
                used: this.weekly.tokens,
                limit: weeklyLimit,
                remaining: Math.max(0, weeklyLimit - this.weekly.tokens),
            },
        };
    }

    reset(): void {
        const now = Date.now();
        this.hourly = { startedAt: now, tokens: 0 };
        this.weekly = { startedAt: now, tokens: 0 };
    }

    /** @deprecated 호환을 위해 유지 — Ollama 시절의 호출당 카운팅 호환 메서드 */
    recordRequest(_payload?: unknown): void {
        // 토큰 기반 트래커로 전환됨 — 호출 카운팅 메서드는 no-op
    }

    /**
     * 호환 stub — Ollama 시절의 routes/usage/metrics/monitoring 등이 기대하던 summary 구조.
     * 토큰 기반 트래커이므로 hourly/weekly tokens 와 최소 통계만 반환.
     */
    getSummary(): Record<string, unknown> & {
        hourly: { used: number; limit: number; remaining: number; totalTokens: number; avgResponseTime: number };
        weekly: { used: number; limit: number; remaining: number; totalTokens: number; avgResponseTime: number };
        today: { totalTokens: number; totalRequests: number; avgResponseTime: number; totalErrors: number; modelUsage: Record<string, number> };
        allTime: { totalTokens: number; totalRequests: number; avgResponseTime: number; totalErrors: number };
        quota: { hourly: { used: number; limit: number; remaining: number }; weekly: { used: number; limit: number; remaining: number } };
        totalRequests: number;
        successCount: number;
        errorCount: number;
        byKey: Record<string, number>;
    } {
        const q = this.getQuotaStatus();
        return {
            hourly: { ...q.hourly, totalTokens: q.hourly.used, avgResponseTime: 0 },
            weekly: { ...q.weekly, totalTokens: q.weekly.used, avgResponseTime: 0 },
            today: { totalTokens: this.hourly.tokens, totalRequests: 0, avgResponseTime: 0, totalErrors: 0, modelUsage: {} },
            allTime: { totalTokens: this.weekly.tokens, totalRequests: 0, avgResponseTime: 0, totalErrors: 0 },
            quota: { hourly: q.hourly, weekly: q.weekly },
            totalRequests: 0,
            successCount: 0,
            errorCount: 0,
            byKey: {},
        };
    }

    /** 호환 stub — routes/token-monitoring/usage 등에서 빈 배열 형태로 소비 */
    getDailyStats(_days?: number): Array<{
        date: string;
        tokens: number;
        requests: number;
        errors: number;
        totalTokens: number;
        totalRequests: number;
        avgResponseTime: number;
        hourlyBreakdown: Array<{ hour: number; tokens: number; requests: number }>;
        modelUsage: Record<string, number>;
    }> {
        return [];
    }

    /** 호환 stub */
    getTodayStats(): {
        date: string;
        tokens: number;
        requests: number;
        errors: number;
        totalTokens: number;
        totalRequests: number;
        avgResponseTime: number;
        hourlyBreakdown: Array<{ hour: number; tokens: number; requests: number }>;
        modelUsage: Record<string, number>;
    } {
        return {
            date: new Date().toISOString().slice(0, 10),
            tokens: this.hourly.tokens,
            requests: 0,
            errors: 0,
            totalTokens: this.hourly.tokens,
            totalRequests: 0,
            avgResponseTime: 0,
            hourlyBreakdown: [],
            modelUsage: {},
        };
    }

    /** 호환 stub */
    getWeeklyStats(): {
        tokens: number;
        requests: number;
        errors: number;
        totalTokens: number;
        totalRequests: number;
        avgResponseTime: number;
    } {
        return {
            tokens: this.weekly.tokens,
            requests: 0,
            errors: 0,
            totalTokens: this.weekly.tokens,
            totalRequests: 0,
            avgResponseTime: 0,
        };
    }
}

let _instance: LLMUsageTracker | null = null;
export function getApiUsageTracker(): LLMUsageTracker {
    if (!_instance) {
        _instance = new LLMUsageTracker();
        logger.info('LLM usage tracker initialized (token-based quota)');
    }
    return _instance;
}
