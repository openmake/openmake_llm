/**
 * API Usage Tracker
 * 🆕 일간/주간 API 사용량 추적 및 통계
 */

import * as fs from 'fs';
import * as path from 'path';
import { getApiKeyManager } from './api-key-manager';
import { getConfig } from '../config/env';

interface UsageRecord {
    date: string;        // YYYY-MM-DD
    requests: number;
    tokens: number;
    errors: number;
    avgResponseTime: number;
    models: Record<string, number>;  // 모델별 사용량
    profiles?: Record<string, number>; // §9 프로파일(brand alias)별 사용량
}

interface HourlyRecord {
    hour: number;        // 0-23
    requests: number;
    tokens: number;
}

interface DailyStats {
    date: string;
    totalRequests: number;
    totalTokens: number;
    totalErrors: number;
    avgResponseTime: number;
    hourlyBreakdown: HourlyRecord[];
    modelUsage: Record<string, number>;
}

interface WeeklyStats {
    weekStart: string;
    weekEnd: string;
    totalRequests: number;
    totalTokens: number;
    totalErrors: number;
    avgResponseTime: number;
    dailyBreakdown: UsageRecord[];
}

interface UsageData {
    daily: Record<string, UsageRecord>;
    lastUpdated: string;
    // 🆕 키별 사용량 추적
    perKey?: Record<string, KeyUsageStats>;
}

// 🆕 개별 API 키 사용량 통계
interface KeyUsageStats {
    keyId: string;       // 키 식별자 (앞 8자)
    totalRequests: number;
    weeklyRequests: number;
    hourlyRequests: number;
    lastReset: string;   // ISO 날짜
    lastHourReset: number; // 시간 (0-23)
}

// 🆕 API 사용량 한계 설정
interface QuotaLimits {
    hourlyLimit: number;
    weeklyLimit: number;
    monthlyPremiumLimit: number;
}

interface QuotaUsage {
    used: number;
    limit: number;
    percentage: number;
    remaining: number;
}

// 🆕 개별 키 할당량 상태
interface KeyQuotaStatus {
    keyId: string;
    isActive: boolean;
    hourly: QuotaUsage;
    weekly: QuotaUsage;
    isExhausted: boolean;
}

interface QuotaStatus {
    hourly: QuotaUsage;
    weekly: QuotaUsage;
    daily: QuotaUsage;
    isOverLimit: boolean;
    warningLevel: 'safe' | 'warning' | 'critical';
    // 🆕 개별 키 상태
    keys?: {
        primary: KeyQuotaStatus;
        secondary: KeyQuotaStatus;
    };
    activeKey?: string;
}

/**
 * 🆕 환경변수에서 할당량 한계 로드
 */
function getQuotaLimits(): QuotaLimits {
    const config = getConfig();
    return {
        hourlyLimit: config.ollamaHourlyLimit,
        weeklyLimit: config.ollamaWeeklyLimit,
        monthlyPremiumLimit: config.ollamaMonthlyPremiumLimit
    };
}

/**
 * 🆕 API 키 ID 생성 (앞 8자)
 */
function getKeyId(key: string): string {
    return key ? key.substring(0, 8) : 'unknown';
}

class ApiUsageTracker {
    private dataPath: string;
    private data: UsageData;
    private todayHourly: HourlyRecord[] = [];
    private saveDebounceTimer: NodeJS.Timeout | null = null;

    constructor(dataDir: string = './data') {
        this.dataPath = path.join(dataDir, 'api-usage.json');
        this.data = this.loadData();
        this.initHourlyRecords();
        console.log('[ApiUsageTracker] 초기화됨');
    }

    private loadData(): UsageData {
        try {
            if (fs.existsSync(this.dataPath)) {
                const content = fs.readFileSync(this.dataPath, 'utf-8');
                return JSON.parse(content);
            }
        } catch (error) {
            console.error('[ApiUsageTracker] 데이터 로드 실패:', error);
        }
        return { daily: {}, lastUpdated: new Date().toISOString() };
    }

    private saveData(): void {
        // 디바운스로 너무 빈번한 저장 방지
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }
        this.saveDebounceTimer = setTimeout(() => {
            try {
                const dir = path.dirname(this.dataPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                this.data.lastUpdated = new Date().toISOString();
                fs.writeFileSync(this.dataPath, JSON.stringify(this.data, null, 2));
            } catch (error) {
                console.error('[ApiUsageTracker] 데이터 저장 실패:', error);
            }
        }, 1000);
    }

    private initHourlyRecords(): void {
        this.todayHourly = Array.from({ length: 24 }, (_, hour) => ({
            hour,
            requests: 0,
            tokens: 0
        }));
    }

    private getToday(): string {
        return new Date().toISOString().split('T')[0];
    }

    private ensureTodayRecord(): UsageRecord {
        const today = this.getToday();
        if (!this.data.daily[today]) {
            this.data.daily[today] = {
                date: today,
                requests: 0,
                tokens: 0,
                errors: 0,
                avgResponseTime: 0,
                models: {}
            };
        }
        return this.data.daily[today];
    }

    /**
     * API 요청 기록
     */
    recordRequest(params: {
        tokens?: number;
        responseTime?: number;
        model?: string;
        error?: boolean;
        apiKeyId?: string;  // 🆕 API 키 식별자
        profileId?: string; // §9 Pipeline Profile ID (brand model alias)
        promptTokens?: number;
        completionTokens?: number;
        totalDuration?: number;
        loadDuration?: number;
        evalDuration?: number;
        promptEvalDuration?: number;
    }): void {
        const record = this.ensureTodayRecord();
        const hour = new Date().getHours();

        record.requests++;
        record.tokens += params.tokens || 0;

        // 🆕 상세 메트릭 저장 (UsageRecord에 필드 추가 필요 - 여기서는 기존 구조 활용 또는 확장)
        // 기존 구조 호환성을 위해 total tokens는 유지하되, 내부적으로 상세 필드를 저장할 공간이 있다면 저장.
        // 현재 UsageRecord 인터페이스는 간단하므로, 확장하거나 로깅만 수행.
        // *실제* 구현에서는 UsageRecord 인터페이스 확장이 필요함.
        if (params.promptTokens || params.completionTokens) {
            // 확장된 로직: (임시) console log for verification
            // 추후 UsageRecord 인터페이스 확장을 통해 저장
        }

        if (params.error) {
            record.errors++;
        }

        // 평균 응답시간 업데이트
        if (params.responseTime && !params.error) {
            const prevTotal = record.avgResponseTime * (record.requests - 1);
            record.avgResponseTime = Math.round((prevTotal + params.responseTime) / record.requests);
        }

        // 모델별 사용량
        if (params.model) {
            record.models[params.model] = (record.models[params.model] || 0) + 1;
        }

        // §9 프로파일(brand alias)별 사용량
        if (params.profileId) {
            if (!record.profiles) record.profiles = {};
            record.profiles[params.profileId] = (record.profiles[params.profileId] || 0) + 1;
        }

        // 시간별 기록
        this.todayHourly[hour].requests++;
        this.todayHourly[hour].tokens += params.tokens || 0;

        // 🆕 키별 사용량 기록
        if (params.apiKeyId) {
            this.recordKeyUsage(params.apiKeyId, hour);
        }

        this.saveData();
    }

    /**
     * 🆕 개별 API 키 사용량 기록
     */
    private recordKeyUsage(keyId: string, currentHour: number): void {
        if (!this.data.perKey) {
            this.data.perKey = {};
        }

        const today = this.getToday();
        let keyStats = this.data.perKey[keyId];

        if (!keyStats) {
            keyStats = {
                keyId,
                totalRequests: 0,
                weeklyRequests: 0,
                hourlyRequests: 0,
                lastReset: today,
                lastHourReset: currentHour
            };
            this.data.perKey[keyId] = keyStats;
        }

        // 주간 리셋 체크 (7일 경과 시)
        const lastResetDate = new Date(keyStats.lastReset);
        const daysSinceReset = Math.floor((Date.now() - lastResetDate.getTime()) / (24 * 60 * 60 * 1000));
        if (daysSinceReset >= 7) {
            keyStats.weeklyRequests = 0;
            keyStats.lastReset = today;
        }

        // 시간 리셋 체크
        if (keyStats.lastHourReset !== currentHour) {
            keyStats.hourlyRequests = 0;
            keyStats.lastHourReset = currentHour;
        }

        keyStats.totalRequests++;
        keyStats.weeklyRequests++;
        keyStats.hourlyRequests++;
    }

    /**
     * 🆕 개별 키 할당량 상태 조회
     */
    getKeyQuotaStatus(keyId: string, isActive: boolean): KeyQuotaStatus {
        const limits = getQuotaLimits();
        const keyStats = this.data.perKey?.[keyId];

        const hourlyUsed = keyStats?.hourlyRequests || 0;
        const weeklyUsed = keyStats?.weeklyRequests || 0;

        return {
            keyId,
            isActive,
            hourly: {
                used: hourlyUsed,
                limit: limits.hourlyLimit,
                percentage: Math.round((hourlyUsed / limits.hourlyLimit) * 100),
                remaining: Math.max(0, limits.hourlyLimit - hourlyUsed)
            },
            weekly: {
                used: weeklyUsed,
                limit: limits.weeklyLimit,
                percentage: Math.round((weeklyUsed / limits.weeklyLimit) * 100),
                remaining: Math.max(0, limits.weeklyLimit - weeklyUsed)
            },
            isExhausted: weeklyUsed >= limits.weeklyLimit || hourlyUsed >= limits.hourlyLimit
        };
    }

    /**
     * 오늘 통계 조회
     */
    getTodayStats(): DailyStats {
        const today = this.getToday();
        const record = this.data.daily[today] || {
            date: today,
            requests: 0,
            tokens: 0,
            errors: 0,
            avgResponseTime: 0,
            models: {}
        };

        return {
            date: today,
            totalRequests: record.requests,
            totalTokens: record.tokens,
            totalErrors: record.errors,
            avgResponseTime: record.avgResponseTime,
            hourlyBreakdown: this.todayHourly,
            modelUsage: record.models
        };
    }

    /**
     * 일간 통계 조회 (최근 N일)
     */
    getDailyStats(days: number = 7): UsageRecord[] {
        const result: UsageRecord[] = [];
        const today = new Date();

        for (let i = 0; i < days; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];

            if (this.data.daily[dateStr]) {
                result.push(this.data.daily[dateStr]);
            } else {
                result.push({
                    date: dateStr,
                    requests: 0,
                    tokens: 0,
                    errors: 0,
                    avgResponseTime: 0,
                    models: {}
                });
            }
        }

        return result.reverse();  // 오래된 순서로 정렬
    }

    /**
     * 주간 통계 조회
     */
    getWeeklyStats(): WeeklyStats {
        const dailyStats = this.getDailyStats(7);
        const weekStart = dailyStats[0]?.date || this.getToday();
        const weekEnd = dailyStats[dailyStats.length - 1]?.date || this.getToday();

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
     * 전체 통계 요약
     */
    getSummary(): {
        today: DailyStats;
        weekly: WeeklyStats;
        allTime: { totalRequests: number; totalTokens: number; totalErrors: number };
        quota: QuotaStatus;
    } {
        const allRecords = Object.values(this.data.daily);
        const allTime = allRecords.reduce((acc, day) => ({
            totalRequests: acc.totalRequests + day.requests,
            totalTokens: acc.totalTokens + day.tokens,
            totalErrors: acc.totalErrors + day.errors
        }), { totalRequests: 0, totalTokens: 0, totalErrors: 0 });

        return {
            today: this.getTodayStats(),
            weekly: this.getWeeklyStats(),
            allTime,
            quota: this.getQuotaStatus()
        };
    }

    /**
     * 🆕 현재 시간 사용량 조회
     */
    getCurrentHourUsage(): number {
        const hour = new Date().getHours();
        return this.todayHourly[hour]?.requests || 0;
    }

    /**
     * 🆕 할당량(쿼터) 상태 조회
     */
    getQuotaStatus(): QuotaStatus {
        const limits = getQuotaLimits();
        const todayStats = this.getTodayStats();

        // 🆕 개별 키 상태 먼저 계산
        const keysStatus = this.getKeysQuotaStatus();

        // 🆕 두 키의 사용량 합산 (각 키는 개별 2500 한도)
        const primaryHourly = keysStatus.primary.hourly.used;
        const secondaryHourly = keysStatus.secondary.hourly.used;
        const primaryWeekly = keysStatus.primary.weekly.used;
        const secondaryWeekly = keysStatus.secondary.weekly.used;

        // 🆕 총 한도 = 키 개수 * 개별 한도
        const totalHourlyLimit = limits.hourlyLimit * 2;  // 150 * 2 = 300
        const totalWeeklyLimit = limits.weeklyLimit * 2;  // 2500 * 2 = 5000

        const totalHourlyUsed = primaryHourly + secondaryHourly;
        const totalWeeklyUsed = primaryWeekly + secondaryWeekly;

        return {
            hourly: {
                used: totalHourlyUsed,
                limit: totalHourlyLimit,
                percentage: totalHourlyLimit > 0
                    ? Math.round((totalHourlyUsed / totalHourlyLimit) * 100)
                    : 0,
                remaining: Math.max(0, totalHourlyLimit - totalHourlyUsed)
            },
            weekly: {
                used: totalWeeklyUsed,
                limit: totalWeeklyLimit,
                percentage: totalWeeklyLimit > 0
                    ? Math.round((totalWeeklyUsed / totalWeeklyLimit) * 100)
                    : 0,
                remaining: Math.max(0, totalWeeklyLimit - totalWeeklyUsed)
            },
            daily: {
                used: todayStats.totalRequests,
                limit: Math.round(totalWeeklyLimit / 7), // 일일 추정 한계 (714)
                percentage: totalWeeklyLimit > 0
                    ? Math.round((todayStats.totalRequests / (totalWeeklyLimit / 7)) * 100)
                    : 0,
                remaining: Math.max(0, Math.round(totalWeeklyLimit / 7) - todayStats.totalRequests)
            },
            isOverLimit: totalWeeklyUsed >= totalWeeklyLimit,
            warningLevel: this.calculateWarningLevelCombined(totalHourlyUsed, totalWeeklyUsed, totalHourlyLimit, totalWeeklyLimit),
            // 🆕 개별 키 상태 추가
            keys: keysStatus,
            activeKey: this.getActiveKeyId()
        };
    }

    /**
     * 🆕 통합 경고 레벨 계산
     */
    private calculateWarningLevelCombined(hourlyUsed: number, weeklyUsed: number, hourlyLimit: number, weeklyLimit: number): 'safe' | 'warning' | 'critical' {
        const hourlyPercentage = (hourlyUsed / hourlyLimit) * 100;
        const weeklyPercentage = (weeklyUsed / weeklyLimit) * 100;
        const maxPercentage = Math.max(hourlyPercentage, weeklyPercentage);

        if (maxPercentage >= 90) return 'critical';
        if (maxPercentage >= 70) return 'warning';
        return 'safe';
    }

    /**
     * 🆕 모든 키의 할당량 상태 조회 (4개 키 지원)
     */
    private getKeysQuotaStatus(): { primary: KeyQuotaStatus; secondary: KeyQuotaStatus } {
        const cfg = getConfig();
        const key1 = process.env.OLLAMA_API_KEY_1 || cfg.ollamaApiKeyPrimary;
        const key2 = process.env.OLLAMA_API_KEY_2 || cfg.ollamaApiKeySecondary;

        // ApiKeyManager에서 현재 활성 키 인덱스 확인
        let activeIndex = 0;
        try {
            activeIndex = getApiKeyManager().getStatus().activeKeyIndex;
        } catch (e) {
            // ignore
        }

        return {
            primary: this.getKeyQuotaStatus(getKeyId(key1), activeIndex === 0),
            secondary: this.getKeyQuotaStatus(getKeyId(key2), activeIndex === 1)
        };
    }

    /**
     * 🆕 현재 활성 키 ID 조회 (4개 키 지원)
     */
    private getActiveKeyId(): string {
        try {
            const manager = getApiKeyManager();
            return getKeyId(manager.getCurrentKey());
        } catch (e) {
            return 'unknown';
        }
    }

    /**
     * 경고 레벨 계산
     */
    private calculateWarningLevel(hourlyUsage: number, weeklyUsage: number, limits: QuotaLimits): 'safe' | 'warning' | 'critical' {
        const hourlyPercentage = (hourlyUsage / limits.hourlyLimit) * 100;
        const weeklyPercentage = (weeklyUsage / limits.weeklyLimit) * 100;
        const maxPercentage = Math.max(hourlyPercentage, weeklyPercentage);

        if (maxPercentage >= 90) return 'critical';
        if (maxPercentage >= 70) return 'warning';
        return 'safe';
    }

    /**
     * 오래된 데이터 정리 (90일 이상)
     */
    cleanup(retentionDays: number = 90): void {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
        const cutoff = cutoffDate.toISOString().split('T')[0];

        let cleaned = 0;
        for (const date of Object.keys(this.data.daily)) {
            if (date < cutoff) {
                delete this.data.daily[date];
                cleaned++;
            }
        }

        if (cleaned > 0) {
            console.log(`[ApiUsageTracker] ${cleaned}일치 오래된 데이터 정리됨`);
            this.saveData();
        }
    }
}

// 싱글톤 인스턴스
let tracker: ApiUsageTracker | null = null;

export function getApiUsageTracker(): ApiUsageTracker {
    if (!tracker) {
        tracker = new ApiUsageTracker();
    }
    return tracker;
}

export { ApiUsageTracker, UsageRecord, DailyStats, WeeklyStats, HourlyRecord, QuotaStatus };
