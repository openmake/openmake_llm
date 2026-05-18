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
 * Opt-in 기본 — LLM_ENABLE_REASONING_EFFORT=true 가 명시되지 않으면 undefined 반환.
 * vLLM 서버가 `--reasoning-parser` 없이 운영 중일 때 unknown body param 거절을 방지하기 위함.
 * 모델/서버가 reasoning 을 지원할 때만 .env 에서 활성화하도록 설계.
 */
export function buildExtraBody(t: ThinkOption | undefined): Record<string, unknown> | undefined {
    const enabled = (process.env.LLM_ENABLE_REASONING_EFFORT ?? 'false').toLowerCase() === 'true';
    if (!enabled) return undefined;
    const effort = thinkToReasoningEffort(t);
    if (!effort) return undefined;
    return { reasoning_effort: effort };
}
