/**
 * ============================================================
 * 비용/과금 상수 중앙 관리
 * ============================================================
 * 토큰 비용 추정, 모델별 입출력 단가를 정의합니다.
 *
 * @module config/pricing
 */

/**
 * 토큰 비용 추정 단가
 *
 * analytics.ts에서 비용 대시보드 계산에 사용합니다.
 * 실제 과금이 아닌 추정치(예시 값)입니다.
 */
export const TOKEN_COST = {
    /** 기본 토큰당 비용 (USD) */
    DEFAULT_COST_PER_TOKEN: 0.000001,
    /** 주간 추정 비용 계수 (per-token, 대략적 추정용) */
    WEEKLY_ESTIMATE_COST_PER_TOKEN: 0.00001,
} as const;

/**
 * 모델별 입출력 토큰 단가 (USD per token)
 *
 * token-monitoring.routes.ts에서 비용 산정에 사용합니다.
 */
export const MODEL_PRICING: Readonly<Record<string, { input: number; output: number }>> = {
    'gemini-3-flash-preview:cloud': { input: 0.00001, output: 0.00002 },
    'gemini-3-pro-preview:cloud': { input: 0.00005, output: 0.0001 },
    'gpt-oss:120b': { input: 0.0001, output: 0.0002 },
    'default': { input: 0.00001, output: 0.00002 },
} as const;
