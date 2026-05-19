/**
 * ============================================================
 * Reasoning Adapter — think 옵션 ↔ vLLM reasoning_effort 매핑
 * ============================================================
 *
 * Ollama 의 `think: true | 'low' | 'medium' | 'high'` 를
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
 *   2. `chat_template_kwargs.enable_thinking` — vLLM/EXAONE/Qwen3 reasoning 모델용.
 *      `LLM_DISABLE_THINKING_BY_DEFAULT=true` 시 think=false/undefined 요청에
 *      `enable_thinking: false` 를 명시 전송하여 reasoning 토큰 생성을 차단.
 *      (측정 결과: EXAONE 4.5 기준 TTFB 8.2s → 3.1s, 62% 단축)
 *
 * Opt-in 설계 — 모델/서버가 해당 옵션을 지원할 때만 .env 에서 활성화.
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
    if (disableThinkingByDefault) {
        const thinkingOn = t === true || t === 'low' || t === 'medium' || t === 'high';
        result.chat_template_kwargs = { enable_thinking: thinkingOn };
    }

    return Object.keys(result).length > 0 ? result : undefined;
}
