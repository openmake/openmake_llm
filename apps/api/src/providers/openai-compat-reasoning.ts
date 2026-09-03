/**
 * OpenAI 호환 외부 provider 의 추론 강도 파라미터 조립 (2026-09-03).
 *
 * 배경: `OpenAICompatProvider.chatStream` 은 `opts.thinking` 을 Gemini 추론 끄기에만 썼고 레벨을
 * 전송하지 않아, UI 의 낮음·보통·높음이 외부 모델(hasa·B.AI·nvidia·ollama-cloud·openrouter)에서는
 * 무시되고 모델 기본 강도로 돌았다(B.AI glm 이 항상 최대 추론으로 5분을 쓴 원인의 한 축).
 *
 * 라이브 프로브(2026-09-03, user 3 BYOK):
 *   - B.AI 직결: `reasoning_effort` low/medium/high 모두 200
 *   - LiteLLM 게이트웨이 경유(hasa·nvidia·ollama-cloud·openrouter): `reasoning_effort` 만 보내면 LiteLLM 이
 *     provider 파라미터 검증에서 400(UnsupportedParamsError) — `allowed_openai_params:['reasoning_effort']`
 *     힌트를 함께 보내면 통과하고 추론 토큰이 실제로 준다(gpt-oss 264→61, 204→19, 223→20; ling 58→14).
 *     로컬 경로(llm/reasoning-adapter)와 같은 계약이다.
 *
 * 순수 함수 — provider 인스턴스 없이 테스트 가능.
 * @module providers/openai-compat-reasoning
 */
import { normalizeEffort, type ReasoningEffort } from '../config/reasoning-effort';

/** 외부 provider 로 보낼 추론 강도 파라미터 (없으면 빈 객체 — 기존 요청과 동일) */
/** IProvider ChatOptions.thinking 과 동일 형태 */
export type ProviderThinkingOption = boolean | ReasoningEffort | { budget: number };

export function buildReasoningEffortParams(
    thinking: ProviderThinkingOption | undefined,
    modelId: string,
    providerId: string,
    viaGateway: boolean,
): { reasoning_effort?: ReasoningEffort; allowed_openai_params?: string[] } {
    if (thinking === undefined || thinking === false) return {};
    // 레벨 미지정(true / budget 객체)은 로컬과 같은 해석 — 보통(medium). 외부는 xhigh 가 표준이 아니다.
    const requested: ReasoningEffort = typeof thinking === 'string' ? thinking : 'medium';
    const effort = normalizeEffort(modelId, requested, providerId);
    return {
        reasoning_effort: effort,
        // LiteLLM 이 소비하는 힌트 — 직결 provider 엔 보내지 않는다(모르는 필드로 거절할 수 있음).
        ...(viaGateway ? { allowed_openai_params: ['reasoning_effort'] } : {}),
    };
}
