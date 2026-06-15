/**
 * Model Context-Fit Config — env-driven 상수 (No-Hardcoding L1).
 *
 * 단일 chat 모델(262K)의 context overflow 안전망 설정. effective capacity 는
 * derived (nominal * (1 - margin/100)) — 운영자가 margin 만 조정해도 자동 반영.
 *
 * (2026-06-15: 1M 노드 제거 — 262K↔1M proactive routing 폐기. large* 설정 삭제.)
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
const defaultCtx = parseIntEnv('LLM_POOL_DEFAULT_CTX', 262144);
const defaultMarginPct = parseIntEnv('LLM_POOL_DEFAULT_MARGIN_PCT', 10);
const routingMaxTokensDefault = parseIntEnv('LLM_POOL_ROUTING_MAX_TOKENS_DEFAULT', 16384);
const minOutputTokens = parseIntEnv('LLM_POOL_MIN_OUTPUT_TOKENS', 4096);
// Vision 입력 이미지 1장당 보수적 토큰 추정치 — context 추정 시 누락 방지.
// (실제 vision 토큰은 해상도/타일링에 따라 가변이나, 과소추정으로 인한 overflow
//  방지를 위해 보수적 고정값 사용. base64 텍스트 길이가 아닌 디코딩 후 토큰 기준.)
const tokensPerImage = parseIntEnv('LLM_POOL_TOKENS_PER_IMAGE', 1500);

export const MODEL_POOL_CONFIG = {
    enabled,
    defaultModel,
    defaultCtx,
    defaultMarginPct,
    routingMaxTokensDefault,
    minOutputTokens,
    tokensPerImage,
    // derived effective capacity (nominal * (1 - margin/100))
    effectiveDefault: Math.floor(defaultCtx * (1 - defaultMarginPct / 100)),
} as const;
