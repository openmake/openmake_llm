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
import { createLogger } from '../utils/logger';

// 타입 re-export (하위 호환성 유지)
import type {
    UsageRecord,
    UsageData,
    HourlyRecord,
    DailyStats,
    WeeklyStats,
    QuotaStatus,
    KeyQuotaStatus,
    RecordRequestParams
} from './usage-tracker-types';

// 할당량/통계 계산 함수
import { getKeyId, calculateKeyQuotaStatus, calculateQuotaStatus } from './usage-quota';
import {
    createEmptyRecord,
    calculateTodayStats,
    calculateDailyStats,
    calculateWeeklyStats,
    calculateSummary
} from './usage-statistics';

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
            this.data.daily[today] = createEmptyRecord(today);
        }
        return this.data.daily[today];
    }

    /**
     * API 요청 기록
     */
    recordRequest(params: RecordRequestParams): void {
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

        // 프로파일(brand alias)별 사용량
        if (params.profileId) {
            if (!record.profiles) record.profiles = {};
            record.profiles[params.profileId] = (record.profiles[params.profileId] || 0) + 1;
        }

        // 시간별 기록
        this.todayHourly[hour].requests++;
        this.todayHourly[hour].tokens += params.tokens || 0;

        // 키별 사용량 기록
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
        return calculateKeyQuotaStatus(this.data, keyId, isActive);
    }

    /** 오늘 통계 조회 */
    getTodayStats(): DailyStats {
        return calculateTodayStats(this.data, this.getToday(), this.todayHourly);
    }

    /** 최근 N일간 일간 통계 조회 */
    getDailyStats(days: number = 7): UsageRecord[] {
        return calculateDailyStats(this.data, days);
    }

    /** 주간 통계 조회 */
    getWeeklyStats(): WeeklyStats {
        return calculateWeeklyStats(this.data);
    }

    /** 전체 통계 요약 */
    getSummary(): {
        today: DailyStats;
        weekly: WeeklyStats;
        allTime: { totalRequests: number; totalTokens: number; totalErrors: number };
        quota: QuotaStatus;
    } {
        return calculateSummary(this.data, this.getTodayStats());
    }

    /** 현재 시간 사용량 조회 */
    getCurrentHourUsage(): number {
        const hour = new Date().getHours();
        return this.todayHourly[hour]?.requests || 0;
    }

    /** 할당량(쿼터) 상태 조회 */
    getQuotaStatus(): QuotaStatus {
        return calculateQuotaStatus(this.data, this.getTodayStats());
    }

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

// 하위 호환성을 위한 re-export
export { ApiUsageTracker };
export type { UsageRecord, DailyStats, WeeklyStats, HourlyRecord, QuotaStatus } from './usage-tracker-types';
