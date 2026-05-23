/**
 * 모델 기본값 — 단일 로컬 모델 (gemma4:e4b)
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
    /**
     * EXAONE 4.5 (LG AI Research).
     *
     * 실측 결과 (2026-05-18 → 19, LiteLLM:8002 직접 호출, 다회 반복):
     *
     * - thinking: ✅ 모델이 reasoning 토큰을 emit. chat_template prefix 로 `<think>` 자동 prepend
     *   → 모델 출력은 `reasoning...</think>final answer` 형태 (DeepSeek R1 패턴). vLLM 8001 에
     *   `--reasoning-parser deepseek_r1` 활성화 시 `delta.reasoning` 으로 분리 (stream-parser.ts:142
     *   가 이미 thinking 채널 처리). flag 없으면 reasoning 토큰이 `delta.content` 로 누출.
     *
     * - toolCalling: 🟡 capability 는 있으나 *현재 vLLM 8001 설정에선 production-unreliable*.
     *   모델 native format 이 `<tool_call>NAME\n<arg_key>K</arg_key><arg_value>V</arg_value></tool_call>`
     *   XML 스키마인데, vLLM 0.13 의 24개 표준 parser 중 *어떤 것도* 이 format 처리 불가
     *   (hermes/qwen3_xml 은 JSON-in-XML 기대, pythonic 은 Python 문법 기대).
     *
     *   캡처된 실패 모드 2가지:
     *     (1) Format mismatch drop — 모델이 native XML emit → vLLM default parser 미인식 →
     *         `tool_calls: null` + content 에 raw `<tool_call>` 누출
     *     (2) Intent absence — 모델이 호출 의도만 진술 후 자연어로 마감 → 도구 호출 marker 없음
     *
     *   현재 toolCalling: true 로 두는 이유 — 모델의 *의도* 자체는 정상 (reasoning 에 호출 명시).
     *   인프라 측에서 vLLM 전용 plugin (scripts/vllm-plugins/exaone_tool_parser.py) 배포 후
     *   `--tool-call-parser exaone_xml` 활성화하면 표준 emit 으로 정상화. 그 전까지 production
     *   에이전트 워크플로우는 drop rate 측정 후 (scripts/llm-droprate-probe.sh) 의사결정 필요.
     */
    'exaone4.5': {
        toolCalling: true,
        thinking: true,
        vision: false,
        streaming: true,
    },
    'gemma4': {
        toolCalling: true,
        thinking: true,
        vision: true,
        streaming: true,
    },
    /**
     * Gemma 4 (Google DeepMind) — 31B.
     * - vision: ✅, toolCalling: ✅, thinking: ✅, context: 32K
     * 서버 PC 의 vLLM 8005 백엔드. proxy (LLM_BASE_URL) 가 model 명으로 라우팅.
     */
    'gemma-4': {
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
    /**
     * BGE-M3 (BAAI) — multilingual embedding (1024-dim).
     * embedding 전용 — chat 호출 대상 아님 (selector 에서 분리).
     * 서버 PC 의 vLLM 8003 백엔드.
     */
    'bge-m3': {
        toolCalling: false,
        thinking: false,
        vision: false,
        streaming: false,
    },
} as const;
