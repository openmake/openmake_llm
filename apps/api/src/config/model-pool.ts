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

function parseFloatEnv(key: string, defaultValue: number): number {
    const v = process.env[key];
    if (v === undefined) return defaultValue;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : defaultValue;
}

function parseBoolEnv(key: string, defaultValue: boolean): boolean {
    const v = process.env[key];
    if (v === undefined) return defaultValue;
    return v.toLowerCase() === 'true';
}

const enabled = parseBoolEnv('LLM_POOL_ENABLED', true);
const defaultModel = process.env.LLM_POOL_DEFAULT_MODEL ?? 'qwen3.8-27b';
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

// --- 정확 토큰 재계산 (exact tokenize) ---
// 문자 기반 추정은 BPE 병합률을 모른다 — 2026-08-31 실측(qwen3.6, vLLM /tokenize):
// 산문 101~123%(보수적)인 반면 JSON 로그 61%, 바이너리 as-text 40~50%,
// base64 36%, hex 30% 로 **과소추정**한다(고엔트로피·구두점 밀집 텍스트에서 BPE 가
// 병합하지 못해 문자당 실제 비용이 0.25 가 아니라 0.4~0.97 토큰). 문자 클래스 가중치로는
// 덮이지 않는다(제어문자 필요 가중치가 구간별 1.22~3.99 로 흔들리고, base64/hex 는
// 제어문자가 0개인데도 30%대). 그래서 **임계 근처에서만** 모델 자신의 토크나이저로
// 정확히 재계산한다 — 평상시 산문 요청은 임계에 못 닿아 추가 호출이 없다.
/** vLLM `/tokenize` endpoint (예: http://<vllm-host>:8002/tokenize). 미설정 시 기능 off. */
const tokenizeUrl = process.env.LLM_TOKENIZE_URL ?? '';
/** tokenize endpoint 인증 키 (미설정 시 LLM_API_KEY 재사용). */
const tokenizeApiKey = process.env.LLM_TOKENIZE_API_KEY ?? process.env.LLM_API_KEY ?? '';
/** 문자 추정이 유효 컨텍스트의 이 비율을 넘을 때만 정확 재계산 (0~1). */
const tokenizeExactRatio = parseFloatEnv('LLM_POOL_TOKENIZE_EXACT_RATIO', 0.5);
/** tokenize 호출 타임아웃 — 초과 시 fail-open(문자 추정 유지). */
const tokenizeTimeoutMs = parseIntEnv('LLM_POOL_TOKENIZE_TIMEOUT_MS', 3000);

export const MODEL_POOL_CONFIG = {
    enabled,
    defaultModel,
    defaultCtx,
    defaultMarginPct,
    routingMaxTokensDefault,
    minOutputTokens,
    tokensPerImage,
    tokenizeUrl,
    tokenizeApiKey,
    tokenizeExactRatio,
    tokenizeTimeoutMs,
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

