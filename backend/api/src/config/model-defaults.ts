/**
 * 모델 기본값 — 로컬 모델 capability 프리셋 (기본 채팅 qwen3.6-35b-a3b)
 *
 * @module config/model-defaults
 */

/**
 * 모델 능력 인터페이스
 */
export interface ModelCapabilities {
    toolCalling: boolean;
    thinking: boolean;
    vision: boolean;
    streaming: boolean;
}

/**
 * 모델 이름 프리픽스별 기능 프리셋
 * gemma4:e4b가 지원하는 능력만 정의한다.
 */
export const MODEL_CAPABILITY_PRESETS: Readonly<Record<string, ModelCapabilities>> = {
    'gemma4': {
        toolCalling: true,
        thinking: true,
        vision: true,
        streaming: true,
    },
    /**
     * Qwen 3.6 (Alibaba) — 35B-A3B MoE.
     * - toolCalling: ✅ (vLLM `--tool-call-parser hermes` 호환)
     * - thinking: ✅ (DeepSeek R1 style reasoning)
     * - vision: ❌
     * - context: 262K (기본), 1M (`qwen3.6-35b-a3b-1m` variant)
     * 서버 PC 의 vLLM 8002 (기본) / 8004 (1m, 선택적) 백엔드.
     */
    'qwen3.6': {
        toolCalling: true,
        thinking: true,
        vision: false,
        streaming: true,
    },
    /**
     * OpenAI 호환 alias — proxy 가 qwen3.6-35b-a3b 으로 라우팅.
     * 외부 도구 / OpenAI SDK 호환 클라이언트가 표준 model ID 로 호출 가능.
     */
    'gpt-3.5-turbo': {
        toolCalling: true,
        thinking: true,
        vision: false,
        streaming: true,
    },
} as const;
