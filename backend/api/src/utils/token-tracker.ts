/**
 * 토큰 사용량 추적 시스템
 * LLM 응답의 토큰 사용량을 추적하고 통계 제공
 */

import { createLogger } from './logger';

const logger = createLogger('TokenTracker');

// 토큰 사용 기록
interface TokenUsage {
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    timestamp: Date;
}

// 일별 통계
interface DailyStats {
    date: string;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    requestCount: number;
}

/**
 * 토큰 추적 클래스
 */
class TokenTracker {
    private usageHistory: TokenUsage[] = [];
    private dailyStats: Map<string, DailyStats> = new Map();
    private maxHistory = 1000; // 최대 기록 수

    /**
     * 토큰 사용량 기록
     */
    recordUsage(
        model: string,
        promptTokens: number,
        completionTokens: number
    ): void {
        const usage: TokenUsage = {
            model,
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            timestamp: new Date()
        };

        this.usageHistory.push(usage);

        // 히스토리 크기 제한
        if (this.usageHistory.length > this.maxHistory) {
            this.usageHistory.shift();
        }

        // 일별 통계 업데이트
        const dateKey = usage.timestamp.toISOString().split('T')[0];
        const stats = this.dailyStats.get(dateKey) || {
            date: dateKey,
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalTokens: 0,
            requestCount: 0
        };

        stats.totalPromptTokens += promptTokens;
        stats.totalCompletionTokens += completionTokens;
        stats.totalTokens += usage.totalTokens;
        stats.requestCount += 1;

        this.dailyStats.set(dateKey, stats);

        logger.debug(
            `토큰 기록: ${model} - 프롬프트:${promptTokens}, 완료:${completionTokens}, 총:${usage.totalTokens}`
        );
    }

    /**
     * Ollama 응답에서 토큰 정보 추출 및 기록
     */
    recordFromOllamaResponse(model: string, response: any): void {
        // Ollama 응답에서 토큰 정보 추출
        const promptTokens = response.prompt_eval_count || 0;
        const completionTokens = response.eval_count || 0;

        if (promptTokens > 0 || completionTokens > 0) {
            this.recordUsage(model, promptTokens, completionTokens);
        }
    }

    /**
     * 오늘 통계 조회
     */
    getTodayStats(): DailyStats {
        const today = new Date().toISOString().split('T')[0];
        return this.dailyStats.get(today) || {
            date: today,
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalTokens: 0,
            requestCount: 0
        };
    }

    /**
     * 전체 통계 조회
     */
    getTotalStats(): {
        totalTokens: number;
        totalRequests: number;
        avgTokensPerRequest: number;
        dailyStats: DailyStats[];
    } {
        let totalTokens = 0;
        let totalRequests = 0;

        const dailyStatsArray = Array.from(this.dailyStats.values());

        for (const stats of dailyStatsArray) {
            totalTokens += stats.totalTokens;
            totalRequests += stats.requestCount;
        }

        return {
            totalTokens,
            totalRequests,
            avgTokensPerRequest: totalRequests > 0 ? Math.round(totalTokens / totalRequests) : 0,
            dailyStats: dailyStatsArray.slice(-7) // 최근 7일
        };
    }

    /**
     * 통계 초기화
     */
    reset(): void {
        this.usageHistory = [];
        this.dailyStats.clear();
        logger.info('토큰 추적 통계 초기화됨');
    }
}

// 싱글톤 인스턴스
let trackerInstance: TokenTracker | null = null;

export function getTokenTracker(): TokenTracker {
    if (!trackerInstance) {
        trackerInstance = new TokenTracker();
    }
    return trackerInstance;
}

export { TokenTracker, TokenUsage, DailyStats };
