/**
 * @module config/external-pricing
 * @description 외부 LLM provider × 모델 단가표 (1M 토큰당 USD)
 *
 * 정책:
 * - 단가는 외부 provider 변동 사항 — config 파일로 분리하여 갱신 부담 최소화
 * - 미등록 provider/model 조합은 cost=0 (best-effort, 사용자 비용은 underestimate)
 * - micros 단위(1 USD = 1,000,000 micros) 로 계산하여 BIGINT 누적 오차 방지
 *
 * 단가 정확성:
 * - 본 단가는 2026-05 시점 공개 정보 기반 — 정확한 청구는 각 provider 콘솔에서 확인
 * - OpenRouter / Together AI 는 모델별 동적 가격 — 카탈로그 fallback 만 제공
 *
 * @see services/database/migrations/016_external_provider_integration.sql
 */

/**
 * 1M 토큰당 USD 단가 — 입력 / 출력 분리
 */
export interface ModelPricing {
    /** 1M input tokens 당 USD */
    input: number;
    /** 1M output tokens 당 USD */
    output: number;
    /** 1M thinking tokens 당 USD (Anthropic extended thinking 등 별도 단가) — 미지정 시 output 단가 사용 */
    thinking?: number;
}

/**
 * 'provider:model' fullId → 단가 매핑.
 * 모델별 정확 매칭이 우선, 미발견 시 provider 기본값 fallback.
 */
const MODEL_PRICING: Record<string, ModelPricing> = {
    // ── Anthropic ──────────────────────────────────────────────────
    'anthropic:claude-opus-4-5':       { input: 15.00, output: 75.00 },
    'anthropic:claude-opus-4-7':       { input: 15.00, output: 75.00 },
    'anthropic:claude-sonnet-4-5':     { input:  3.00, output: 15.00 },
    'anthropic:claude-sonnet-4-6':     { input:  3.00, output: 15.00 },
    'anthropic:claude-sonnet-4-7':     { input:  3.00, output: 15.00 },
    'anthropic:claude-haiku-4-5':      { input:  1.00, output:  5.00 },

    // ── Google Gemini (OpenAI 호환 endpoint) ───────────────────────
    'gemini:gemini-2.5-pro':           { input:  1.25, output: 10.00 },
    'gemini:gemini-2.5-flash':         { input:  0.30, output:  2.50 },
    'gemini:gemini-2.0-flash-exp':     { input:  0.00, output:  0.00 }, // 무료 (실험)

    // ── Groq (LPU) — 대부분 모델 무료 또는 매우 저렴 ───────────────
    'groq:llama-3.3-70b-versatile':    { input:  0.59, output:  0.79 },
    'groq:llama-3.1-8b-instant':       { input:  0.05, output:  0.08 },
    'groq:mixtral-8x7b-32768':         { input:  0.24, output:  0.24 },

    // ── Mistral La Plateforme ─────────────────────────────────────
    'mistral:mistral-large-latest':    { input:  2.00, output:  6.00 },
    'mistral:mistral-medium-latest':   { input:  0.40, output:  2.00 },
    'mistral:mistral-small-latest':    { input:  0.10, output:  0.30 },
    'mistral:codestral-latest':        { input:  0.20, output:  0.60 },

    // ── Cohere ─────────────────────────────────────────────────────
    'cohere:command-r-plus':           { input:  2.50, output: 10.00 },
    'cohere:command-r':                { input:  0.15, output:  0.60 },
    'cohere:command-r7b':              { input:  0.0375, output: 0.15 },

    // ── OpenRouter (인기 라우팅 모델 — 작은 마크업 포함, 정확값은 대시보드 참조) ──
    'openrouter:openai/gpt-5':                     { input:  2.50, output: 10.00 },
    'openrouter:openai/gpt-4o':                    { input:  2.50, output: 10.00 },
    'openrouter:openai/gpt-4o-mini':               { input:  0.15, output:  0.60 },
    'openrouter:anthropic/claude-opus-4.5':        { input: 15.00, output: 75.00 },
    'openrouter:anthropic/claude-sonnet-4.6':      { input:  3.00, output: 15.00 },
    'openrouter:anthropic/claude-haiku-4.5':       { input:  1.00, output:  5.00 },
    'openrouter:google/gemini-2.5-pro':            { input:  1.25, output: 10.00 },
    'openrouter:google/gemini-2.5-flash':          { input:  0.30, output:  2.50 },
    'openrouter:meta-llama/llama-3.3-70b-instruct': { input: 0.59, output:  0.79 },
    'openrouter:deepseek/deepseek-r1':             { input:  0.55, output:  2.19 },
    'openrouter:deepseek/deepseek-v3':             { input:  0.27, output:  1.10 },

    // ── Together AI (오픈소스 호스팅) ──────────────────────────────
    'together:meta-llama/Llama-3.3-70B-Instruct-Turbo':  { input: 0.88, output: 0.88 },
    'together:meta-llama/Llama-3.1-405B-Instruct-Turbo': { input: 3.50, output: 3.50 },
    'together:Qwen/Qwen2.5-72B-Instruct-Turbo':           { input: 1.20, output: 1.20 },
    'together:deepseek-ai/DeepSeek-V3':                   { input: 1.25, output: 1.25 },
};

/**
 * provider 별 fallback 단가 (모델별 정확 매칭 미발견 시 사용)
 */
const PROVIDER_FALLBACK_PRICING: Record<string, ModelPricing> = {
    anthropic:   { input:  3.00, output: 15.00 }, // Sonnet 기준
    gemini:      { input:  1.25, output: 10.00 }, // Pro 기준
    groq:        { input:  0.59, output:  0.79 }, // 70B Llama 기준
    mistral:     { input:  0.40, output:  2.00 }, // Medium 기준
    cohere:      { input:  0.15, output:  0.60 }, // Command R 기준
    openrouter:  { input:  3.00, output: 15.00 }, // Sonnet 기준 보수적
    together:    { input:  0.88, output:  0.88 }, // 70B Llama 기준
    // ollama-remote / openai-compatible 은 base_url 임의 — fallback 없음 (cost=0 underestimate)
};

/**
 * USD micros 단위로 호출당 비용 계산.
 *
 * @returns cost_usd_micros BIGINT 호환 정수 (1 USD = 1,000,000 micros)
 */
export function computeCostMicros(
    providerId: string,
    modelId: string,
    inputTokens: number,
    outputTokens: number,
    thinkingTokens?: number,
): number {
    const fullId = `${providerId}:${modelId}`;
    const pricing =
        MODEL_PRICING[fullId] ??
        PROVIDER_FALLBACK_PRICING[providerId];

    if (!pricing) return 0;

    // 1M 토큰당 USD → 토큰당 micros: usd_per_1m * 1_000_000 micros / 1_000_000 tokens = usd_per_1m micros/token
    // 즉 단가(USD/1M) × 토큰 수 = 비용(micros)
    const inputCost = pricing.input * inputTokens;
    const outputCost = pricing.output * outputTokens;
    const thinkingCost = thinkingTokens
        ? (pricing.thinking ?? pricing.output) * thinkingTokens
        : 0;

    return Math.round(inputCost + outputCost + thinkingCost);
}

/**
 * 디버깅용 — 등록된 모델 단가 조회
 */
export function getModelPricing(providerId: string, modelId: string): ModelPricing | null {
    const fullId = `${providerId}:${modelId}`;
    return MODEL_PRICING[fullId] ?? PROVIDER_FALLBACK_PRICING[providerId] ?? null;
}
