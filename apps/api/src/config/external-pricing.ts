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
 * - 본 단가는 2026-05 시점 공개 정보 기반 — 정확한 청구는 OpenRouter 대시보드에서 확인
 * - OpenRouter 는 모델별 동적 가격 — listOpenRouterModels()가 /v1/models 에서 실시간 단가를
 *   ProviderModel.pricing 으로 전달. 본 카탈로그는 그 경로 실패 시 fallback.
 *   provider 직접 cost (OpenRouter usage.cost) 는 streamChat 에서 우선 채택 (Stage 4f).
 *
 * @see db/migrations/016_external_provider_integration.sql
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
    // ── OpenRouter (인기 라우팅 모델 — 카탈로그 fallback 단가) ──
    // OpenRouter 는 모델별 동적 가격. listOpenRouterModels() 가 /v1/models 응답에서
    // 모델별 실시간 가격을 ProviderModel.pricing 으로 전달함. 본 테이블은 그 경로가
    // 실패했거나 OpenRouter 가 새 모델을 추가했지만 아직 사전 등록되지 않은 경우의 fallback.
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
};

/**
 * provider 별 fallback 단가 (모델별 정확 매칭 미발견 시 사용)
 */
const PROVIDER_FALLBACK_PRICING: Record<string, ModelPricing> = {
    openrouter: { input: 3.00, output: 15.00 }, // Sonnet 기준 보수적
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
