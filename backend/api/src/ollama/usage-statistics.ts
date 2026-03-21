/**
 * ============================================================
 * Usage Statistics - 통계 계산 로직
 * ============================================================
 *
 * 일간/주간/전체 기간 통계를 계산하는 순수 함수를 제공합니다.
 *
 * @module ollama/usage-statistics
 */

import type {
    UsageData,
    UsageRecord,
    DailyStats,
    WeeklyStats,
    HourlyRecord,
    QuotaStatus
} from './usage-tracker-types';
import { calculateQuotaStatus } from './usage-quota';

/**
 * 빈 UsageRecord를 생성합니다.
 *
 * @param date - 날짜 (YYYY-MM-DD)
 * @returns 초기화된 UsageRecord
 */
export function createEmptyRecord(date: string): UsageRecord {
    return {
        date,
        requests: 0,
        tokens: 0,
        errors: 0,
        avgResponseTime: 0,
        models: {}
    };
}

/**
 * 오늘 통계를 계산합니다.
 *
 * @param data - 사용량 데이터
 * @param today - 오늘 날짜 (YYYY-MM-DD)
 * @param todayHourly - 오늘 시간별 기록 배열
 * @returns 오늘의 DailyStats
 */
export function calculateTodayStats(data: UsageData, today: string, todayHourly: HourlyRecord[]): DailyStats {
    const record = data.daily[today] || createEmptyRecord(today);

    return {
        date: today,
        totalRequests: record.requests,
        totalTokens: record.tokens,
        totalErrors: record.errors,
        avgResponseTime: record.avgResponseTime,
        hourlyBreakdown: todayHourly,
        modelUsage: record.models
    };
}

/**
 * 최근 N일간의 일간 통계를 계산합니다.
 *
 * 데이터가 없는 날짜는 0으로 채워진 빈 레코드로 반환합니다.
 * 결과는 오래된 순서(오름차순)로 정렬됩니다.
 *
 * @param data - 사용량 데이터
 * @param days - 조회할 일수 (기본값: 7)
 * @returns 일간 사용량 기록 배열 (오래된 순)
 */
export function calculateDailyStats(data: UsageData, days: number = 7): UsageRecord[] {
    const result: UsageRecord[] = [];
    const today = new Date();

    for (let i = 0; i < days; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];

        if (data.daily[dateStr]) {
            result.push(data.daily[dateStr]);
        } else {
            result.push(createEmptyRecord(dateStr));
        }
    }

    return result.reverse();
}

/**
 * 주간 통계를 계산합니다.
 *
 * @param data - 사용량 데이터
 * @returns 주간 통계 요약
 */
export function calculateWeeklyStats(data: UsageData): WeeklyStats {
    const dailyStats = calculateDailyStats(data, 7);
    const weekStart = dailyStats[0]?.date || new Date().toISOString().split('T')[0];
    const weekEnd = dailyStats[dailyStats.length - 1]?.date || new Date().toISOString().split('T')[0];

    const totals = dailyStats.reduce((acc, day) => ({
        requests: acc.requests + day.requests,
        tokens: acc.tokens + day.tokens,
        errors: acc.errors + day.errors,
        responseTimeSum: acc.responseTimeSum + (day.avgResponseTime * day.requests),
        requestsWithTime: acc.requestsWithTime + (day.avgResponseTime > 0 ? day.requests : 0)
    }), { requests: 0, tokens: 0, errors: 0, responseTimeSum: 0, requestsWithTime: 0 });

    return {
        weekStart,
        weekEnd,
        totalRequests: totals.requests,
        totalTokens: totals.tokens,
        totalErrors: totals.errors,
        avgResponseTime: totals.requestsWithTime > 0
            ? Math.round(totals.responseTimeSum / totals.requestsWithTime)
            : 0,
        dailyBreakdown: dailyStats
    };
}

/**
 * 전체 통계 요약을 계산합니다.
 *
 * @param data - 사용량 데이터
 * @param todayStats - 오늘 통계
 * @returns 전체 통계 요약 (today, weekly, allTime, quota)
 */
export function calculateSummary(data: UsageData, todayStats: DailyStats): {
    today: DailyStats;
    weekly: WeeklyStats;
    allTime: { totalRequests: number; totalTokens: number; totalErrors: number };
    quota: QuotaStatus;
} {
    const allRecords = Object.values(data.daily);
    const allTime = allRecords.reduce((acc, day) => ({
        totalRequests: acc.totalRequests + day.requests,
        totalTokens: acc.totalTokens + day.tokens,
        totalErrors: acc.totalErrors + day.errors
    }), { totalRequests: 0, totalTokens: 0, totalErrors: 0 });

    return {
        today: todayStats,
        weekly: calculateWeeklyStats(data),
        allTime,
        quota: calculateQuotaStatus(data, todayStats)
    };
}
