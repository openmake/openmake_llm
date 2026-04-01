/**
 * ============================================================
 * Usage Tracker 타입 정의
 * ============================================================
 *
 * API 사용량 추적에 필요한 모든 인터페이스/타입을 정의합니다.
 *
 * @module ollama/usage-tracker-types
 */

/**
 * 일간 사용량 기록
 * @interface UsageRecord
 */
export interface UsageRecord {
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
export interface HourlyRecord {
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
export interface DailyStats {
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
export interface WeeklyStats {
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
export interface UsageData {
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
export interface KeyUsageStats {
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
export interface QuotaLimits {
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
export interface QuotaUsage {
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
export interface KeyQuotaStatus {
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
export interface QuotaStatus {
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
    /** 개별 키 할당량 상태 */
    keys?: {
        primary: KeyQuotaStatus;
        secondary: KeyQuotaStatus;
    };
    /** 현재 활성 키 ID */
    activeKey?: string;
}

/**
 * API 요청 기록 파라미터
 * @interface RecordRequestParams
 */
export interface RecordRequestParams {
    tokens?: number;
    responseTime?: number;
    model?: string;
    error?: boolean;
    apiKeyId?: string;
    profileId?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalDuration?: number;
    loadDuration?: number;
    evalDuration?: number;
    promptEvalDuration?: number;
}
