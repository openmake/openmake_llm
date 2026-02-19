/**
 * ============================================================
 * Token Tracker - LLM 토큰 사용량 추적 시스템
 * ============================================================
 *
 * LLM 응답의 토큰 사용량을 실시간으로 추적하고 일별 통계를 제공합니다.
 * 프롬프트 토큰과 완료 토큰을 분리 기록하며, 최근 7일 통계를 조회할 수 있습니다.
 *
 * dailyStats는 PostgreSQL에 영속화되며, 인메모리 Map을 write-through 캐시로 사용한다.
 * usageHistory는 롤링 버퍼이므로 인메모리에만 유지한다.
 *
 * @module utils/token-tracker
 * @description
 * - 모델별 토큰 사용량 기록 (프롬프트/완료/총합)
 * - Ollama 응답에서 토큰 정보 자동 추출
 * - 일별 통계 집계 및 최근 7일 조회
 * - 메모리 내 히스토리 크기 제한 (최대 1,000건)
 * - 싱글톤 패턴으로 전역 인스턴스 관리
 * - PostgreSQL write-through 캐시 패턴 (dailyStats)
 */

import { createLogger } from './logger';
import { getPool } from '../data/models/unified-database';

const logger = createLogger('TokenTracker');

/**
 * 개별 토큰 사용 기록 인터페이스
 *
 * @interface TokenUsage
 */
interface TokenUsage {
    /** 사용된 LLM 모델 이름 */
    model: string;
    /** 프롬프트(입력)에 사용된 토큰 수 */
    promptTokens: number;
    /** 완료(출력)에 사용된 토큰 수 */
    completionTokens: number;
    /** 총 토큰 수 (promptTokens + completionTokens) */
    totalTokens: number;
    /** 기록 시점의 타임스탬프 */
    timestamp: Date;
}

/**
 * 일별 토큰 사용 통계 인터페이스
 *
 * @interface DailyStats
 */
interface DailyStats {
    /** 날짜 문자열 (YYYY-MM-DD 형식) */
    date: string;
    /** 해당 일의 총 프롬프트 토큰 수 */
    totalPromptTokens: number;
    /** 해당 일의 총 완료 토큰 수 */
    totalCompletionTokens: number;
    /** 해당 일의 총 토큰 수 */
    totalTokens: number;
    /** 해당 일의 총 요청 횟수 */
    requestCount: number;
}

/**
 * 토큰 사용량 추적 클래스
 *
 * LLM 요청마다 토큰 사용량을 기록하고, 일별 통계를 자동 집계합니다.
 * 메모리 내 히스토리는 최대 1,000건으로 제한되며, 초과 시 가장 오래된 기록이 제거됩니다.
 *
 * @class TokenTracker
 */
class TokenTracker {
    /** 토큰 사용 기록 배열 (최대 maxHistory건) — 인메모리 전용 (롤링 버퍼) */
    private usageHistory: TokenUsage[] = [];
    /** 날짜별 통계 맵 (키: YYYY-MM-DD) — 인메모리 캐시 */
    private dailyStats: Map<string, DailyStats> = new Map();
    /** 최대 히스토리 보관 수 */
    private maxHistory = 1000; // 최대 기록 수
    /** DB에서 캐시 워밍 완료 여부 */
    private cacheWarmed: boolean = false;

    /**
     * DB에서 일별 통계를 로드하여 인메모리 캐시를 워밍한다.
     * 최초 접근 시 한 번만 실행된다. fire-and-forget.
     */
    private warmCacheFromDB(): void {
        if (this.cacheWarmed) return;
        this.cacheWarmed = true;

        getPool().query(
            'SELECT date_key, total_prompt_tokens, total_completion_tokens, total_tokens, request_count FROM token_daily_stats'
        ).then((result) => {
            for (const row of result.rows) {
                const dateKey = row.date_key as string;
                // 캐시에 이미 값이 있으면 (현재 세션에서 이미 기록된 것) 스킵
                if (!this.dailyStats.has(dateKey)) {
                    this.dailyStats.set(dateKey, {
                        date: dateKey,
                        totalPromptTokens: row.total_prompt_tokens as number,
                        totalCompletionTokens: row.total_completion_tokens as number,
                        totalTokens: row.total_tokens as number,
                        requestCount: row.request_count as number
                    });
                }
            }
        }).catch(() => {
            // DB 접근 실패 시 인메모리만 사용 — 서비스 중단 없음
        });
    }

    /**
     * 일별 통계를 DB에 비동기 upsert한다. fire-and-forget.
     */
    private persistDailyStatToDB(dateKey: string, stats: DailyStats): void {
        getPool().query(
            `INSERT INTO token_daily_stats (date_key, total_prompt_tokens, total_completion_tokens, total_tokens, request_count, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (date_key) DO UPDATE SET
                 total_prompt_tokens = $2,
                 total_completion_tokens = $3,
                 total_tokens = $4,
                 request_count = $5,
                 updated_at = NOW()`,
            [dateKey, stats.totalPromptTokens, stats.totalCompletionTokens, stats.totalTokens, stats.requestCount]
        ).catch(() => {
            // DB 쓰기 실패 시 무시 — 캐시에는 이미 반영됨
        });
    }

    /**
     * 토큰 사용량을 기록합니다.
     *
     * 히스토리에 추가하고 일별 통계를 자동 업데이트합니다.
     * 히스토리가 maxHistory를 초과하면 가장 오래된 기록을 제거합니다.
     * 캐시 업데이트 후 DB에 비동기 upsert (fire-and-forget).
     *
     * @param model - LLM 모델 이름
     * @param promptTokens - 프롬프트(입력) 토큰 수
     * @param completionTokens - 완료(출력) 토큰 수
     */
    recordUsage(
        model: string,
        promptTokens: number,
        completionTokens: number
    ): void {
        // 최초 접근 시 DB에서 캐시 워밍 (fire-and-forget)
        this.warmCacheFromDB();

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

        // Write-through: 캐시 업데이트 후 DB에 비동기 영속화
        this.persistDailyStatToDB(dateKey, stats);

        logger.debug(
            `토큰 기록: ${model} - 프롬프트:${promptTokens}, 완료:${completionTokens}, 총:${usage.totalTokens}`
        );
    }

    /**
     * Ollama 응답 객체에서 토큰 정보를 추출하여 기록합니다.
     *
     * `prompt_eval_count`와 `eval_count` 필드를 읽어 토큰 수를 추출합니다.
     * 두 값이 모두 0이면 기록하지 않습니다.
     *
     * @param model - LLM 모델 이름
     * @param response - Ollama API 응답 객체
     */
    recordFromOllamaResponse(model: string, response: Record<string, unknown>): void {
        // Ollama 응답에서 토큰 정보 추출
        const promptTokens = (typeof response.prompt_eval_count === 'number' ? response.prompt_eval_count : 0);
        const completionTokens = (typeof response.eval_count === 'number' ? response.eval_count : 0);

        if (promptTokens > 0 || completionTokens > 0) {
            this.recordUsage(model, promptTokens, completionTokens);
        }
    }

    /**
     * 오늘의 토큰 사용 통계를 조회합니다.
     *
     * 오늘 날짜에 해당하는 DailyStats를 반환합니다.
     * 기록이 없으면 모든 값이 0인 기본 객체를 반환합니다.
     *
     * @returns 오늘의 일별 통계
     */
    getTodayStats(): DailyStats {
        // 최초 접근 시 DB에서 캐시 워밍 (fire-and-forget)
        this.warmCacheFromDB();

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
     * 전체 누적 통계 및 최근 7일 일별 통계를 조회합니다.
     *
     * @returns 총 토큰 수, 총 요청 수, 요청당 평균 토큰 수, 최근 7일 일별 통계
     */
    getTotalStats(): {
        totalTokens: number;
        totalRequests: number;
        avgTokensPerRequest: number;
        dailyStats: DailyStats[];
    } {
        // 최초 접근 시 DB에서 캐시 워밍 (fire-and-forget)
        this.warmCacheFromDB();

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
     * 모든 토큰 추적 통계를 초기화합니다.
     *
     * 히스토리와 일별 통계를 모두 삭제합니다.
     */
    reset(): void {
        this.usageHistory = [];
        this.dailyStats.clear();

        // DB도 비동기로 클리어 (fire-and-forget)
        getPool().query('DELETE FROM token_daily_stats').catch(() => {});

        logger.info('토큰 추적 통계 초기화됨');
    }
}

/** 싱글톤 인스턴스 */
let trackerInstance: TokenTracker | null = null;

/**
 * TokenTracker 싱글톤 인스턴스를 반환합니다.
 *
 * 최초 호출 시 인스턴스를 생성하고, 이후 동일 인스턴스를 재사용합니다.
 *
 * @returns TokenTracker 싱글톤 인스턴스
 */
export function getTokenTracker(): TokenTracker {
    if (!trackerInstance) {
        trackerInstance = new TokenTracker();
    }
    return trackerInstance;
}

export { TokenTracker, TokenUsage, DailyStats };
