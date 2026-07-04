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
import type { ThinkOption } from './types';

export function thinkToReasoningEffort(t: ThinkOption | undefined): 'low' | 'medium' | 'high' | undefined {
    if (t === undefined || t === false) return undefined;
    if (t === true) return 'high';
    return t;
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
export function buildExtraBody(t: ThinkOption | undefined): Record<string, unknown> | undefined {
    const result: Record<string, unknown> = {};

    const reasoningEnabled = (process.env.LLM_ENABLE_REASONING_EFFORT ?? 'false').toLowerCase() === 'true';
    if (reasoningEnabled) {
        const effort = thinkToReasoningEffort(t);
        if (effort) result.reasoning_effort = effort;
    }

    const disableThinkingByDefault = (process.env.LLM_DISABLE_THINKING_BY_DEFAULT ?? 'false').toLowerCase() === 'true';
    if (t === false) {
        // 명시적 비활성 — env 와 무관하게 강제 OFF.
        result.chat_template_kwargs = { enable_thinking: false };
    } else if (t === true || t === 'low' || t === 'medium' || t === 'high') {
        // 명시적 활성 — disableThinkingByDefault 가 true 여도 호출자 요청 우선.
        result.chat_template_kwargs = { enable_thinking: true };
    } else if (disableThinkingByDefault) {
        // think 미지정 + env 기본 OFF 정책.
        result.chat_template_kwargs = { enable_thinking: false };
    }

    return Object.keys(result).length > 0 ? result : undefined;
}
