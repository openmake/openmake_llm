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
 * token-monitoring.routes.ts 에서 비용 산정에 사용합니다.
 *
 * 단일 로컬 모델 환경 (2026-05-06 전환 후):
 *   - 로컬 모델은 직접 비용이 없으므로 0
 *   - 'default' 항목은 미등록 모델 fallback 으로 유지
 *
 * 향후 cloud 모델 재도입 시 여기에 항목 추가 (env 외부화도 검토 가능).
 */
export const MODEL_PRICING: Readonly<Record<string, { input: number; output: number }>> = {
    'gemma4:e4b': { input: 0, output: 0 },
    'default': { input: 0, output: 0 },
} as const;

/**
 * 가상 비용 환산 참조 단가 — "상용 API 로 지불했다면" 얼마인지 보여주는 용도(실제 과금 아님).
 *
 * usage 대시보드의 일/월/년 비용 환산에 사용. 저장된 토큰이 입력/출력 미구분(총합)이라
 * OUTPUT_RATIO 가정으로 혼합 단가를 만든다. 기본값은 실제 Qwen 요금표(Alibaba Cloud
 * Model Studio, Qwen3-30B-A3B 급 — qwen3.6-35b-a3b 와 동급 A3B MoE) 공시가.
 * 배포별 조정은 env 로 (No-Hardcoding L1).
 */
export const REFERENCE_COST = {
    /** 입력 토큰 단가 (USD per 1M tokens) */
    INPUT_USD_PER_1M: parseFloat(process.env.TOKEN_COST_INPUT_USD_PER_1M || '0.20'),
    /** 출력 토큰 단가 (USD per 1M tokens) */
    OUTPUT_USD_PER_1M: parseFloat(process.env.TOKEN_COST_OUTPUT_USD_PER_1M || '0.80'),
    /** 총 토큰 중 출력 비중 가정 (입출력 분리 데이터 부재 보정) */
    OUTPUT_RATIO: parseFloat(process.env.TOKEN_COST_OUTPUT_RATIO || '0.25'),
    /** 원화 환산 환율 */
    USD_KRW: parseFloat(process.env.TOKEN_COST_USD_KRW || '1400'),
} as const;
