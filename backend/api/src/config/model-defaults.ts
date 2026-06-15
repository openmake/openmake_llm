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
     * - context: 262K
     * 서버 PC 의 vLLM 8002 백엔드.
     */
    'qwen3.6': {
        toolCalling: true,
        thinking: true,
        vision: false,
        streaming: true,
    },
    // ⚠️ getCapabilities 는 `modelId.split(':')[0]` 로 매칭하므로 위 'qwen3.6' 키는
    //   실제 modelId('qwen3.6-35b-a3b')와 안 맞아 FALLBACK 이 쓰여 왔다(죽은 키).
    //   2026-06-12: toolCalling 의도 복원 — 서버 vLLM 은 `--tool-call-parser qwen3_coder` 로
    //   구동 중이고 AgentTaskService 의 도구 루프가 동일 모델에서 검증됨. false 로 남아
    //   있으면 채팅 경로(external dispatch)가 모든 MCP 도구를 caps 게이트에서 제거해
    //   채팅 도구 호출이 전면 불능이 된다 (tools=0).
    'qwen3.6-35b-a3b': {
        toolCalling: true,
        thinking: true,
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

/**
 * 보수적 기본 capabilities — 프리셋 미매칭 모델의 게이팅/표시 기본값 (SoT).
 */
export const FALLBACK_CAPABILITIES: ModelCapabilities = {
    toolCalling: false,
    thinking: false,
    vision: false,
    streaming: true,
};

/**
 * modelId → MODEL_CAPABILITY_PRESETS 매칭 (lowercase + startsWith-longest).
 * 매칭 없으면 null — 기본값은 호출자가 결정한다.
 *
 * `exact-우선 → prefix-longest` 는 `pure prefix-longest` 와 동치이므로 단일 규칙으로 통일.
 * `startsWith` 는 `includes` 와 달리 중간-substring 오매칭(게이팅 over-grant)을 배제하면서
 * suffixed variant(예: ':cloud', '-instruct')는 동일하게 커버한다.
 */
export function matchCapabilityPreset(modelId: string): ModelCapabilities | null {
    const lower = modelId.toLowerCase();
    let best: ModelCapabilities | null = null;
    let bestLen = -1;
    for (const [prefix, caps] of Object.entries(MODEL_CAPABILITY_PRESETS)) {
        if (lower.startsWith(prefix) && prefix.length > bestLen) {
            best = caps;
            bestLen = prefix.length;
        }
    }
    return best;
}
