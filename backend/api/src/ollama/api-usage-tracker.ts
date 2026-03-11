/**
 * ============================================================
 * ApiUsageTracker - API 사용량 추적 및 쿼터 관리
 * ============================================================
 *
 * 일간/주간 API 사용량을 파일 기반으로 추적하고,
 * 할당량(쿼터) 상태를 실시간으로 모니터링합니다.
 *
 * @module ollama/api-usage-tracker
 * @description
 * - 일간/주간/전체 기간 사용량 통계 (요청 수, 토큰 수, 에러 수, 평균 응답 시간)
 * - 시간별(hourly) 사용량 세분화 추적
 * - 모델별/프로파일(brand alias)별 사용량 분류
 * - 개별 API 키별 사용량 추적 (시간/주간 리셋)
 * - 할당량 상태 조회 및 경고 레벨 계산 (safe/warning/critical)
 * - 디바운스 기반 파일 저장 (1초 간격)
 * - 90일 이상 오래된 데이터 자동 정리
 */

import * as fs from 'fs';
import * as path from 'path';
import { getApiKeyManager } from './api-key-manager';
import { getConfig } from '../config/env';
import { createLogger } from '../utils/logger';

/**
 * 일간 사용량 기록
 * @interface UsageRecord
 */
interface UsageRecord {
    /** 기록 날짜 (YYYY-MM-DD 형식) */
    date: string;
    /** 총 요청 횟수 */
    requests: number;
    /** 총 사용 토큰 수 */
    tokens: number;
    /** 에러 발생 횟수 */
    errors: number;
    /** 평균 응답 시간 (밀리초) */
    avgResponseTime: number;
    /** 모델별 요청 횟수 (모델명 -> 횟수) */
    models: Record<string, number>;
    /** Pipeline Profile(brand alias)별 요청 횟수 */
    profiles?: Record<string, number>;
    /** 총 처리 시간 누적 (나노초) — Ollama total_duration */
    totalDuration?: number;
    /** 모델 로딩 시간 누적 (나노초) — Ollama load_duration */
    loadDuration?: number;
    /** 토큰 생성 시간 누적 (나노초) — Ollama eval_duration */
    evalDuration?: number;
    /** 프롬프트 평가 시간 누적 (나노초) — Ollama prompt_eval_duration */
    promptEvalDuration?: number;
    /** 프롬프트 토큰 수 누적 */
    promptTokens?: number;
    /** 완료 토큰 수 누적 */
    completionTokens?: number;
}

/**
 * 시간별 사용량 기록
 * @interface HourlyRecord
 */
interface HourlyRecord {
    /** 시간 (0-23) */
    hour: number;
    /** 해당 시간 요청 횟수 */
    requests: number;
    /** 해당 시간 토큰 수 */
    tokens: number;
}

/**
 * 일간 통계 요약
 * @interface DailyStats
 */
interface DailyStats {
    /** 날짜 (YYYY-MM-DD) */
    date: string;
    /** 총 요청 횟수 */
    totalRequests: number;
    /** 총 토큰 수 */
    totalTokens: number;
    /** 총 에러 수 */
    totalErrors: number;
    /** 평균 응답 시간 (밀리초) */
    avgResponseTime: number;
    /** 시간별 세분화 데이터 (24개 항목) */
    hourlyBreakdown: HourlyRecord[];
    /** 모델별 사용량 */
    modelUsage: Record<string, number>;
}

/**
 * 주간 통계 요약
 * @interface WeeklyStats
 */
interface WeeklyStats {
    /** 주간 시작일 (YYYY-MM-DD) */
    weekStart: string;
    /** 주간 종료일 (YYYY-MM-DD) */
    weekEnd: string;
    /** 총 요청 횟수 */
    totalRequests: number;
    /** 총 토큰 수 */
    totalTokens: number;
    /** 총 에러 수 */
    totalErrors: number;
    /** 평균 응답 시간 (밀리초) */
    avgResponseTime: number;
    /** 일별 세분화 데이터 */
    dailyBreakdown: UsageRecord[];
}

/**
 * 파일에 저장되는 사용량 데이터 구조
 * @interface UsageData
 */
interface UsageData {
    /** 일별 사용량 기록 (날짜 -> UsageRecord) */
    daily: Record<string, UsageRecord>;
    /** 마지막 데이터 갱신 시각 (ISO 8601) */
    lastUpdated: string;
    /** 개별 API 키별 사용량 통계 (키ID -> KeyUsageStats) */
    perKey?: Record<string, KeyUsageStats>;
}

/**
 * 개별 API 키 사용량 통계
 * @interface KeyUsageStats
 */
interface KeyUsageStats {
    /** 키 식별자 (앞 8자리) */
    keyId: string;
    /** 전체 기간 총 요청 수 */
    totalRequests: number;
    /** 주간 요청 수 (7일마다 리셋) */
    weeklyRequests: number;
    /** 시간별 요청 수 (매 시간 리셋) */
    hourlyRequests: number;
    /** 마지막 주간 리셋 날짜 (ISO 날짜) */
    lastReset: string;
    /** 마지막 시간 리셋 시각 (0-23) */
    lastHourReset: number;
}

/**
 * API 사용량 한계 설정
 * @interface QuotaLimits
 */
interface QuotaLimits {
    /** 시간당 최대 요청 수 */
    hourlyLimit: number;
    /** 주간 최대 요청 수 */
    weeklyLimit: number;
    /** 프리미엄 월간 최대 요청 수 */
    monthlyPremiumLimit: number;
}

/**
 * 할당량 사용 현황 (개별 기간)
 * @interface QuotaUsage
 */
interface QuotaUsage {
    /** 사용량 */
    used: number;
    /** 한계값 */
    limit: number;
    /** 사용률 (%) */
    percentage: number;
    /** 남은 횟수 */
    remaining: number;
}

/**
 * 개별 API 키의 할당량 상태
 * @interface KeyQuotaStatus
 */
interface KeyQuotaStatus {
    /** 키 식별자 (앞 8자리) */
    keyId: string;
    /** 현재 활성 키 여부 */
    isActive: boolean;
    /** 시간별 할당량 상태 */
    hourly: QuotaUsage;
    /** 주간 할당량 상태 */
    weekly: QuotaUsage;
    /** 할당량 소진 여부 */
    isExhausted: boolean;
}

/**
 * 전체 할당량(쿼터) 상태 — 시간별/주간/일간 + 개별 키 상태
 * @interface QuotaStatus
 */
interface QuotaStatus {
    /** 시간별 할당량 상태 (모든 키 합산) */
    hourly: QuotaUsage;
    /** 주간 할당량 상태 (모든 키 합산) */
    weekly: QuotaUsage;
    /** 일간 추정 할당량 상태 */
    daily: QuotaUsage;
    /** 한계 초과 여부 */
    isOverLimit: boolean;
    /** 경고 레벨 (safe: <70%, warning: 70-90%, critical: >90%) */
    warningLevel: 'safe' | 'warning' | 'critical';
    /** 개별 키 할당량 상태 (동적 키 개수 지원) */
    keys?: KeyQuotaStatus[];
    /** 현재 활성 키 ID */
    activeKey?: string;
}

/**
 * 환경변수에서 API 할당량 한계 설정을 로드합니다.
 *
 * @returns 시간별/주간/월간 프리미엄 한계값
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
 * API 키의 앞 8자리로 식별자를 생성합니다.
 *
 * @param key - API 키 전체 문자열
 * @returns 키 식별자 (앞 8자리) 또는 'unknown'
 */
function getKeyId(key: string): string {
    return key ? key.substring(0, 8) : 'unknown';
}

/**
 * API 사용량 추적기 클래스
 *
 * 파일 기반(JSON)으로 일간/주간/시간별 사용량을 기록하고,
 * 할당량 상태를 실시간으로 모니터링합니다.
 * 디바운스(1초)로 빈번한 파일 저장을 최적화합니다.
 *
 * @class ApiUsageTracker
 */
class ApiUsageTracker {
     /** 사용량 데이터 JSON 파일 경로 */
     private dataPath: string;
     /** 메모리 내 사용량 데이터 */
     private data: UsageData;
     /** 오늘의 시간별 사용량 기록 (24개 슬롯) */
     private todayHourly: HourlyRecord[] = [];
     /** 파일 저장 디바운스 타이머 */
     private saveDebounceTimer: NodeJS.Timeout | null = null;
     /** 로거 인스턴스 */
     private logger = createLogger('ApiUsageTracker');

    /**
     * ApiUsageTracker 인스턴스를 생성합니다.
     *
     * 기존 데이터 파일을 로드하고 시간별 기록을 초기화합니다.
     *
     * @param dataDir - 데이터 파일 저장 디렉토리 경로 (기본값: './data')
     */
     constructor(dataDir: string = './data') {
         this.dataPath = path.join(dataDir, 'api-usage.json');
         this.data = this.loadData();
         this.initHourlyRecords();
         this.logger.info('초기화됨');
     }

    /**
     * 파일에서 사용량 데이터를 로드합니다.
     * 파일이 없거나 파싱 실패 시 빈 데이터를 반환합니다.
     *
     * @returns 로드된 UsageData 또는 초기 빈 데이터
     * @private
     */
     private loadData(): UsageData {
         try {
             if (fs.existsSync(this.dataPath)) {
                 const content = fs.readFileSync(this.dataPath, 'utf-8');
                 return JSON.parse(content);
             }
         } catch (error) {
             this.logger.error('데이터 로드 실패:', error);
         }
         return { daily: {}, lastUpdated: new Date().toISOString() };
     }

    /**
     * 사용량 데이터를 파일에 저장합니다 (디바운스 적용).
     *
     * 1초 내에 여러 번 호출되면 마지막 호출만 실제로 저장합니다.
     * 디렉토리가 없으면 자동 생성합니다.
     *
     * @private
     */
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
                 this.logger.error('데이터 저장 실패:', error);
             }
         }, 1000);
     }

    /**
     * 시간별 기록 배열을 24개 슬롯(0~23시)으로 초기화합니다.
     * @private
     */
    private initHourlyRecords(): void {
        this.todayHourly = Array.from({ length: 24 }, (_, hour) => ({
            hour,
            requests: 0,
            tokens: 0
        }));
    }

    /**
     * 오늘 날짜를 YYYY-MM-DD 형식 문자열로 반환합니다.
     * @returns 오늘 날짜 문자열
     * @private
     */
    private getToday(): string {
        return new Date().toISOString().split('T')[0];
    }

    /**
     * 오늘 날짜의 UsageRecord가 존재하는지 확인하고, 없으면 생성합니다.
     *
     * @returns 오늘의 UsageRecord 참조
     * @private
     */
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

        // Ollama duration 메트릭 누적 저장
        if (params.totalDuration) {
            record.totalDuration = (record.totalDuration || 0) + params.totalDuration;
        }
        if (params.loadDuration) {
            record.loadDuration = (record.loadDuration || 0) + params.loadDuration;
        }
        if (params.evalDuration) {
            record.evalDuration = (record.evalDuration || 0) + params.evalDuration;
        }
        if (params.promptEvalDuration) {
            record.promptEvalDuration = (record.promptEvalDuration || 0) + params.promptEvalDuration;
        }
        if (params.promptTokens) {
            record.promptTokens = (record.promptTokens || 0) + params.promptTokens;
        }
        if (params.completionTokens) {
            record.completionTokens = (record.completionTokens || 0) + params.completionTokens;
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
     * 개별 API 키의 사용량을 기록합니다.
     *
     * 시간 리셋: 현재 시각이 마지막 기록 시각과 다르면 hourlyRequests 초기화
     * 주간 리셋: 마지막 리셋일로부터 7일 이상 경과 시 weeklyRequests 초기화
     *
     * @param keyId - API 키 식별자 (앞 8자리)
     * @param currentHour - 현재 시각 (0-23)
     * @private
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
     * 개별 API 키의 할당량 상태를 조회합니다.
     *
     * @param keyId - API 키 식별자 (앞 8자리)
     * @param isActive - 현재 활성 키 여부
     * @returns 키별 시간/주간 할당량 상태 및 소진 여부
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
     * 최근 N일간의 일간 통계를 조회합니다.
     *
     * 데이터가 없는 날짜는 0으로 채워진 빈 레코드로 반환합니다.
     * 결과는 오래된 순서(오름차순)로 정렬됩니다.
     *
     * @param days - 조회할 일수 (기본값: 7)
     * @returns 일간 사용량 기록 배열 (오래된 순)
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

        // 개별 키 상태 계산 (동적 키 개수)
        const keysStatus = this.getKeysQuotaStatus();
        const keyCount = keysStatus.length || 1;

        // 모든 키의 사용량 합산
        const totalHourlyUsed = keysStatus.reduce((sum, k) => sum + k.hourly.used, 0);
        const totalWeeklyUsed = keysStatus.reduce((sum, k) => sum + k.weekly.used, 0);

        // 총 한도 = 키 개수 * 개별 한도
        const totalHourlyLimit = limits.hourlyLimit * keyCount;
        const totalWeeklyLimit = limits.weeklyLimit * keyCount;

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
            // 개별 키 상태 추가 (동적 배열)
            keys: keysStatus.length > 0 ? keysStatus : undefined,
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
     * 모든 키의 할당량 상태 조회 (동적 키 개수 지원)
     */
    private getKeysQuotaStatus(): KeyQuotaStatus[] {
        let manager: ReturnType<typeof getApiKeyManager>;
        try {
            manager = getApiKeyManager();
        } catch (e) {
            return [];
        }

        const status = manager.getStatus();
        const totalKeys = status.totalKeys;
        const activeIndex = status.activeKeyIndex;

        const result: KeyQuotaStatus[] = [];
        for (let i = 0; i < totalKeys; i++) {
            const key = manager.getKeyByIndex(i);
            result.push(this.getKeyQuotaStatus(getKeyId(key), i === activeIndex));
        }
        return result;
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
    /**
     * 보관 기간이 지난 오래된 데이터를 정리합니다.
     *
     * @param retentionDays - 데이터 보관 일수 (기본값: 90일)
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
             this.logger.info(`${cleaned}일치 오래된 데이터 정리됨`);
             this.saveData();
         }
    }
}

// ============================================
// 싱글톤 인스턴스 관리
// ============================================

/** ApiUsageTracker 싱글톤 인스턴스 */
let tracker: ApiUsageTracker | null = null;

/**
 * ApiUsageTracker 싱글톤 인스턴스를 반환합니다.
 * 최초 호출 시 인스턴스를 생성하고 기존 데이터를 로드합니다.
 *
 * @returns ApiUsageTracker 싱글톤 인스턴스
 */
export function getApiUsageTracker(): ApiUsageTracker {
    if (!tracker) {
        tracker = new ApiUsageTracker();
    }
    return tracker;
}

export { ApiUsageTracker, UsageRecord, DailyStats, WeeklyStats, HourlyRecord, QuotaStatus };
