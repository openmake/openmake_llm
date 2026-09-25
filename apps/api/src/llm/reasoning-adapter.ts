/**
 * ============================================================
 * Reasoning Adapter — think 옵션 ↔ vLLM reasoning_effort 매핑
 * ============================================================
 *
 * LLMClient 의 `think: true | 'low' | 'medium' | 'high'` 옵션을
 * vLLM/OpenAI `extra_body.reasoning_effort` 로 변환합니다.
 *
 * 주의: vLLM 서버가 `--reasoning-parser` 없이 가동되면 reasoning_effort
 * 미지원 — 환경변수 LLM_ENABLE_REASONING_EFFORT=false 로 비활성 가능.
 *
 * @module llm/reasoning-adapter
 */
import { normalizeEffort, type ReasoningEffort } from '../config/reasoning-effort';
import { REASONING_EFFORT_LADDER, resolveModelProfile } from '../config/model-profiles';
import type { ThinkOption } from './types';

/**
 * think 옵션 → reasoning_effort 값.
 * `true`(단계 미지정)는 '높음' 의도로 보고 'high' 로 해석하되, 최종값은 호출부가
 * modelId 로 정규화한다 — 모델마다 받는 값이 다르다(qwen3.8 은 high 를 400 거절).
 */
function thinkToReasoningEffort(t: ThinkOption | undefined): ReasoningEffort | undefined {
    if (t === undefined || t === false) return undefined;
    if (t === true) return 'high';
    return t;
}

/**
 * 이 요청에서 모델의 thinking 이 실제로 켜지는지 — buildExtraBody 의 enable_thinking 결정 규칙과 동일.
 * `undefined` 는 env `LLM_DISABLE_THINKING_BY_DEFAULT` 가 true 면 OFF, 아니면 서버 기본(reasoning 모델은 ON).
 * 샘플링 프리셋(llm/sampling-preset.ts) 선택에 쓴다.
 */
export function isThinkingEnabled(t: ThinkOption | undefined): boolean {
    if (t === false) return false;
    if (t !== undefined) return true;
    return (process.env.LLM_DISABLE_THINKING_BY_DEFAULT ?? 'false').toLowerCase() !== 'true';
}

/**
 * think 옵션을 OpenAI SDK extra_body 로 변환.
 *
 * 두 가지 extra_body 키를 지원:
 *   1. `reasoning_effort` — OpenAI 표준. `LLM_ENABLE_REASONING_EFFORT=true` 시 활성.
 *   2. `chat_template_kwargs.enable_thinking` — vLLM/Qwen3 reasoning 모델용.
 *
 * `enable_thinking` 결정 규칙 (우선순위 순):
 *   a) `think === false`  → enable_thinking=false 를 *항상* 명시 전송. 메타 LLM 호출
 *      (분류기/라우터/요약기/검증기) 에서 reasoning 토큰이 max_tokens 를 소진하여
 *      본 응답이 비어버리는 사고를 차단. env 와 무관하게 우선 적용.
 *   b) `think === true|'low'|'medium'|'high'`  → enable_thinking=true.
 *   c) `think === undefined`  → env `LLM_DISABLE_THINKING_BY_DEFAULT=true` 일 때만
 *      enable_thinking=false 를 보냄 (서버 기본값 오버라이드). 그렇지 않으면 미전송
 *      (서버/모델 chat_template 의 기본값 — 일부 reasoning 모델은 기본 ON).
 *
 * 측정: reasoning 모델 기준 TTFB 8.2s → 3.1s (reasoning OFF, 62% 단축).
 * vLLM 0.21+ 에서 chat_template 이 `enable_thinking` 변수를 인식해야 작동.
 */
export function buildExtraBody(
    t: ThinkOption | undefined,
    modelId?: string,
    externalProviderId?: string,
): Record<string, unknown> | undefined {
    if (externalProviderId) return buildExternalExtraBody(t, modelId, externalProviderId);
    const result: Record<string, unknown> = {};

    const reasoningEnabled = (process.env.LLM_ENABLE_REASONING_EFFORT ?? 'false').toLowerCase() === 'true';
    if (reasoningEnabled) {
        const effort = thinkToReasoningEffort(t);
        // 대상 모델이 받지 않는 값은 인접 지원값으로 강등/승격 — 미정규화 전송은 400 이다.
        if (effort) {
            result.reasoning_effort = normalizeEffort(modelId, effort);
            // LiteLLM 게이트웨이는 provider('openai') 기준으로 파라미터를 검증해 reasoning_effort 를
            // **업스트림에 닿기 전에** 400 으로 거절한다(라이브 실측 2026-08-23:
            //   litellm.UnsupportedParamsError: openai does not support parameters: ['reasoning_effort']).
            // 이 힌트를 함께 보내면 LiteLLM 이 허용 목록에 더해 그대로 전달한다(utils.py allowed_openai_params).
            // LiteLLM 이 소비하는 필드라 업스트림엔 실리지 않으며, 게이트웨이 없이 vLLM 에 직결된
            // 배포에서도 알 수 없는 필드로 무시된다(vLLM 0.27 직접 호출 200 확인).
            result.allowed_openai_params = ['reasoning_effort'];
        }
    }

    const disableThinkingByDefault = (process.env.LLM_DISABLE_THINKING_BY_DEFAULT ?? 'false').toLowerCase() === 'true';
    if (t === false) {
        // 명시적 비활성 — env 와 무관하게 강제 OFF.
        result.chat_template_kwargs = { enable_thinking: false };
    } else if (t === true || t === 'low' || t === 'medium' || t === 'high' || t === 'xhigh') {
        // 명시적 활성 — disableThinkingByDefault 가 true 여도 호출자 요청 우선.
        result.chat_template_kwargs = { enable_thinking: true };
    } else if (disableThinkingByDefault) {
        // think 미지정 + env 기본 OFF 정책.
        result.chat_template_kwargs = { enable_thinking: false };
    }

    return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * 외부 provider 직결 요청의 추론 파라미터 (2026-09-26).
 * `chat_template_kwargs.enable_thinking` 은 vLLM/Qwen 채팅 템플릿 변수라 외부로는 보내지 않는다 — hasa gpt-oss-120b 는 이 값과
 * JSON 스키마(response_format)를 함께 받으면 content:null 빈 답을 낸다(Planner 8/8 실패, 직결 재현). 추론을 끌 수 없는 모델
 * (프로필에 reasoningEfforts 가 선언된 모델)은 think:false 를 지원 강도 중 가장 낮은 값으로 보낸다(같은 조건 재현에서 정상 JSON).
 * 강도 지정(think:true·레벨)은 종전과 같다 — LLM_ENABLE_REASONING_EFFORT 가 켜져 있을 때 provider 기준으로 정규화해 보낸다.
 */
function buildExternalExtraBody(t: ThinkOption | undefined, modelId: string | undefined, providerId: string): Record<string, unknown> | undefined {
    const declared = resolveModelProfile(modelId, providerId).reasoningEfforts;
    let effort: ReasoningEffort | undefined;
    if (t === false) {
        effort = declared?.length
            ? [...declared].sort((a, b) => REASONING_EFFORT_LADDER.indexOf(a) - REASONING_EFFORT_LADDER.indexOf(b))[0]
            : undefined;
    } else if ((process.env.LLM_ENABLE_REASONING_EFFORT ?? 'false').toLowerCase() === 'true') {
        const requested = thinkToReasoningEffort(t);
        effort = requested ? normalizeEffort(modelId, requested, providerId) : undefined;
    }
    return effort ? { reasoning_effort: effort } : undefined;
}

