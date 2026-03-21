/**
 * ============================================================
 * Usage Quota - 할당량 계산 로직
 * ============================================================
 *
 * API 키별 할당량 상태 조회, 경고 레벨 계산,
 * 통합 쿼터 상태 산출 등 할당량 관련 순수 함수를 제공합니다.
 *
 * @module ollama/usage-quota
 */

import { getApiKeyManager } from './api-key-manager';
import { getConfig } from '../config/env';
import type {
    UsageData,
    QuotaLimits,
    QuotaUsage,
    KeyQuotaStatus,
    QuotaStatus,
    DailyStats
} from './usage-tracker-types';

/**
 * 환경변수에서 API 할당량 한계 설정을 로드합니다.
 *
 * @returns 시간별/주간/월간 프리미엄 한계값
 */
export function getQuotaLimits(): QuotaLimits {
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
export function getKeyId(key: string): string {
    return key ? key.substring(0, 8) : 'unknown';
}

/**
 * 개별 API 키의 할당량 상태를 계산합니다.
 *
 * @param data - 사용량 데이터
 * @param keyId - API 키 식별자 (앞 8자리)
 * @param isActive - 현재 활성 키 여부
 * @returns 키별 시간/주간 할당량 상태 및 소진 여부
 */
export function calculateKeyQuotaStatus(data: UsageData, keyId: string, isActive: boolean): KeyQuotaStatus {
    const limits = getQuotaLimits();
    const keyStats = data.perKey?.[keyId];

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
 * 통합 경고 레벨을 계산합니다.
 *
 * @param hourlyUsed - 시간별 사용량
 * @param weeklyUsed - 주간 사용량
 * @param hourlyLimit - 시간별 한계
 * @param weeklyLimit - 주간 한계
 * @returns 경고 레벨 (safe/warning/critical)
 */
export function calculateWarningLevel(
    hourlyUsed: number,
    weeklyUsed: number,
    hourlyLimit: number,
    weeklyLimit: number
): 'safe' | 'warning' | 'critical' {
    const hourlyPercentage = (hourlyUsed / hourlyLimit) * 100;
    const weeklyPercentage = (weeklyUsed / weeklyLimit) * 100;
    const maxPercentage = Math.max(hourlyPercentage, weeklyPercentage);

    if (maxPercentage >= 90) return 'critical';
    if (maxPercentage >= 70) return 'warning';
    return 'safe';
}

/**
 * 모든 키의 할당량 상태를 조회합니다.
 *
 * @param data - 사용량 데이터
 * @returns primary/secondary 키 할당량 상태
 */
export function getKeysQuotaStatus(data: UsageData): { primary: KeyQuotaStatus; secondary: KeyQuotaStatus } {
    const cfg = getConfig();
    const key1 = process.env.OLLAMA_API_KEY_1 || cfg.ollamaApiKeyPrimary;
    const key2 = process.env.OLLAMA_API_KEY_2 || cfg.ollamaApiKeySecondary;

    let activeIndex = 0;
    try {
        activeIndex = getApiKeyManager().getStatus().activeKeyIndex;
    } catch (e) {
        // ignore
    }

    return {
        primary: calculateKeyQuotaStatus(data, getKeyId(key1), activeIndex === 0),
        secondary: calculateKeyQuotaStatus(data, getKeyId(key2), activeIndex === 1)
    };
}

/**
 * 현재 활성 키 ID를 조회합니다.
 *
 * @returns 키 식별자 (앞 8자리) 또는 'unknown'
 */
export function getActiveKeyId(): string {
    try {
        const manager = getApiKeyManager();
        return getKeyId(manager.getCurrentKey());
    } catch (e) {
        return 'unknown';
    }
}

/**
 * 전체 할당량(쿼터) 상태를 계산합니다.
 *
 * @param data - 사용량 데이터
 * @param todayStats - 오늘 통계
 * @returns 전체 할당량 상태
 */
export function calculateQuotaStatus(data: UsageData, todayStats: DailyStats): QuotaStatus {
    const limits = getQuotaLimits();
    const keysStatus = getKeysQuotaStatus(data);

    const primaryHourly = keysStatus.primary.hourly.used;
    const secondaryHourly = keysStatus.secondary.hourly.used;
    const primaryWeekly = keysStatus.primary.weekly.used;
    const secondaryWeekly = keysStatus.secondary.weekly.used;

    const totalHourlyLimit = limits.hourlyLimit * 2;
    const totalWeeklyLimit = limits.weeklyLimit * 2;

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
            limit: Math.round(totalWeeklyLimit / 7),
            percentage: totalWeeklyLimit > 0
                ? Math.round((todayStats.totalRequests / (totalWeeklyLimit / 7)) * 100)
                : 0,
            remaining: Math.max(0, Math.round(totalWeeklyLimit / 7) - todayStats.totalRequests)
        },
        isOverLimit: totalWeeklyUsed >= totalWeeklyLimit,
        warningLevel: calculateWarningLevel(totalHourlyUsed, totalWeeklyUsed, totalHourlyLimit, totalWeeklyLimit),
        keys: keysStatus,
        activeKey: getActiveKeyId()
    };
}
