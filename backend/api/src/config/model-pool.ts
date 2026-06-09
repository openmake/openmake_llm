/**
 * Model Pool Config — env-driven 상수 (No-Hardcoding L1).
 *
 * 모든 임계값은 env 로 운영 조정 가능. effective capacity 는 derived
 * (nominal * (1 - margin/100)) — 운영자가 margin 만 조정해도 자동 반영.
 *
 *
 * @module config/model-pool
 */

function parseIntEnv(key: string, defaultValue: number): number {
    const v = process.env[key];
    if (v === undefined) return defaultValue;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : defaultValue;
}

function parseBoolEnv(key: string, defaultValue: boolean): boolean {
    const v = process.env[key];
    if (v === undefined) return defaultValue;
    return v.toLowerCase() === 'true';
}

const enabled = parseBoolEnv('LLM_POOL_ENABLED', true);
const defaultModel = process.env.LLM_POOL_DEFAULT_MODEL ?? 'qwen3.6-35b-a3b';
const largeModel = process.env.LLM_POOL_LARGE_MODEL ?? 'qwen3.6-35b-a3b-1m';
const defaultCtx = parseIntEnv('LLM_POOL_DEFAULT_CTX', 262144);
const largeCtx = parseIntEnv('LLM_POOL_LARGE_CTX', 1048576);
const defaultMarginPct = parseIntEnv('LLM_POOL_DEFAULT_MARGIN_PCT', 10);
const largeMarginPct = parseIntEnv('LLM_POOL_LARGE_MARGIN_PCT', 5);
const routingMaxTokensDefault = parseIntEnv('LLM_POOL_ROUTING_MAX_TOKENS_DEFAULT', 16384);
const minOutputTokens = parseIntEnv('LLM_POOL_MIN_OUTPUT_TOKENS', 4096);

export const MODEL_POOL_CONFIG = {
    enabled,
    defaultModel,
    largeModel,
    defaultCtx,
    largeCtx,
    defaultMarginPct,
    largeMarginPct,
    routingMaxTokensDefault,
    minOutputTokens,
    // derived effective capacity (nominal * (1 - margin/100))
    effectiveDefault: Math.floor(defaultCtx * (1 - defaultMarginPct / 100)),
    effectiveLarge: Math.floor(largeCtx * (1 - largeMarginPct / 100)),
} as const;
