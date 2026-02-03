/**
 * API Usage Tracker 스텁
 * 
 * 실제 구현: backend/api/src/ollama/api-usage-tracker.ts
 * Infrastructure 레이어에서 타입 호환을 위한 최소 인터페이스
 * 
 * NOTE: infrastructure 모듈은 DEPRECATED 상태입니다.
 * 이 스텁은 기존 코드의 타입 에러 해소를 위해 존재합니다.
 */

interface DailyStats {
    totalRequests: number;
    totalTokens: number;
    totalErrors: number;
    avgResponseTime: number;
    models?: Record<string, number>;
    [key: string]: unknown;
}

interface WeeklyStats {
    totalTokens: number;
    totalRequests: number;
    [key: string]: unknown;
}

interface UsageSummary {
    today: DailyStats;
    weekly: WeeklyStats;
    allTime: { totalRequests: number; totalTokens: number; totalErrors: number };
    quota: Record<string, unknown>;
}

interface ApiUsageTracker {
    getSummary(): UsageSummary;
    getCurrentHourUsage(): number;
}

let instance: ApiUsageTracker | null = null;

/**
 * API 사용량 추적기 반환
 * Infrastructure 레이어용 스텁 — 실제 런타임에서는 backend 모듈 사용
 */
export function getApiUsageTracker(): ApiUsageTracker {
    if (!instance) {
        // 스텁 구현: 빈 통계 반환
        instance = {
            getSummary: () => ({
                today: { totalRequests: 0, totalTokens: 0, totalErrors: 0, avgResponseTime: 0 },
                weekly: { totalTokens: 0, totalRequests: 0 },
                allTime: { totalRequests: 0, totalTokens: 0, totalErrors: 0 },
                quota: {},
            }),
            getCurrentHourUsage: () => 0,
        };
    }
    return instance;
}
