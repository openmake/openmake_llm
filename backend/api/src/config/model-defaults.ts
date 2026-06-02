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
    // ⚠️ getCapabilities 는 `modelId.split(':')[0]` 로 매칭하므로 위 'qwen3.6' 키는
    //   실제 modelId('qwen3.6-35b-a3b')와 안 맞아 FALLBACK 이 쓰여 왔다(죽은 키).
    //   서버 vLLM vision 활성화(--language-model-only 제거)에 맞춰 실 modelId 키로 vision 만 켠다.
    //   toolCalling/thinking 은 기존 FALLBACK 동작 그대로 유지(회귀 0) — 'qwen3.6' 죽은 키의
    //   toolCalling/thinking 의도 복원은 별도 이슈.
    'qwen3.6-35b-a3b': {
        toolCalling: false,
        thinking: false,
        vision: true,
        streaming: true,
    },
    'qwen3.6-35b-a3b-1m': {
        toolCalling: false,
        thinking: false,
        vision: true,
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
