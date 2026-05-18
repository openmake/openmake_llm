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
} as const;
