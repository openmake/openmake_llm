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
/** env 로 **명시**됐는지 — 명시값은 프로브 실측보다 우선한다(운영자 의도 존중). */
const ctxExplicit = process.env.LLM_POOL_DEFAULT_CTX !== undefined && process.env.LLM_POOL_DEFAULT_CTX !== '';
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
    /** @deprecated 모델 무관 고정값 — 안전망은 resolveEffectiveContext(modelId) 를 쓴다. 진단·표시용으로만 잔존. */
    effectiveDefault: Math.floor(defaultCtx * (1 - defaultMarginPct / 100)),
} as const;

/**
 * 대상 모델의 **유효 컨텍스트**(마진 적용 후) 해석 — 안전망 임계값의 SoT.
 *
 * 해석 순서:
 *   ① env `LLM_POOL_DEFAULT_CTX` 명시 — 운영자 override (최우선)
 *   ② 부팅 프로브 실측 (`LocalModelEntry.contextLength`, contextLengthProbed=true)
 *   ③ 카탈로그 선언값 → ④ 코드 기본값(262144)
 *
 * 배경: ②가 없던 시절엔 262144 고정이라 컨텍스트가 더 짧은 모델로 교체하면 임계에 영영
 * 못 닿아 그대로 전송 → upstream 400, 더 긴 모델이면 불필요하게 잘라냈다.
 */
export function resolveEffectiveContext(modelId?: string): number {
    const nominal = resolveNominalContext(modelId);
    return Math.floor(nominal * (1 - defaultMarginPct / 100));
}

/** 마진 적용 전 컨텍스트(진단·로그용). */
export function resolveNominalContext(modelId?: string): number {
    if (ctxExplicit) return defaultCtx;
    if (modelId) {
        // 순환 import 방지를 위해 지연 로드 (local-models 는 config 계층 내부 모듈).
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { findLocalModel } = require('./local-models') as typeof import('./local-models');
        const entry = findLocalModel(modelId);
        if (entry?.contextLength && entry.contextLength > 0) return entry.contextLength;
    }
    return defaultCtx;
}

