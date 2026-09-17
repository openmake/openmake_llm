/**
 * 로컬 LLM 기본 단가 (L1 env 폴백, F25 PR-1). DB cost_rates 에 행이 없을 때만 쓰인다.
 * 기본 0 = 현행(로컬 무비용) 유지. 값은 USD per 1M tokens → micros/token 으로 환산(1 USD/1M = 1 micro/token).
 * @module config/cost-defaults
 */
export const LOCAL_LLM_COST = {
    /** 로컬 입력 토큰 단가 (USD per 1M). env LOCAL_LLM_COST_INPUT_USD_PER_1M */
    INPUT_USD_PER_1M: parseFloat(process.env.LOCAL_LLM_COST_INPUT_USD_PER_1M || '0'),
    /** 로컬 출력 토큰 단가 (USD per 1M). env LOCAL_LLM_COST_OUTPUT_USD_PER_1M */
    OUTPUT_USD_PER_1M: parseFloat(process.env.LOCAL_LLM_COST_OUTPUT_USD_PER_1M || '0'),
    /** 단가 캐시 TTL(ms). env COST_RATE_CACHE_TTL_MS */
    RATE_CACHE_TTL_MS: parseInt(process.env.COST_RATE_CACHE_TTL_MS || '60000', 10),
} as const;

/** storage.generated(F25 후속, /generated 보관) 기본 단가 — DB cost_rates 에 행이 없을 때만 쓰인다. 기본 0. */
export const STORAGE_GENERATED_COST = {
    /** GB·일당 단가(USD). env STORAGE_GENERATED_USD_PER_GB_DAY */
    USD_PER_GB_DAY: parseFloat(process.env.STORAGE_GENERATED_USD_PER_GB_DAY || '0'),
} as const;
