/**
 * ============================================================
 * LLM 파라미터 중앙 관리
 * ============================================================
 * temperature, confidence 제수(divisor) 등 LLM 호출 시
 * 사용하는 수치 파라미터를 정의합니다.
 * 환경변수로 오버라이드할 수 있습니다.
 *
 * 2026-09-18 정리: 소비처가 0이던 Gemini/GPT-OSS 모델 프리셋(MODEL_PRESETS·
 * PROMPT_TYPE_PRESETS)과 temperature 상수 17개를 제거했다. 두 provider 는 이미
 * 폐기됐고, 역할별 샘플링은 llm/sampling-preset.ts 가 thinking 상태로 채운다.
 *
 * @module config/llm-parameters
 */

// ============================================
// Temperature 프리셋
// ============================================

/**
 * 용도별 LLM temperature 값
 * 각 서비스/라우트에서 참조
 */
export const LLM_TEMPERATURES = {
    /** 웹 검색 사실 검증 (web-search.routes) */
    WEB_SEARCH: Number(process.env.LLM_TEMP_WEB_SEARCH) || 0.3,
    /** Semantic Compactor — 도구 결과 요약 시 결정론적 응답 강제 */
    SEMANTIC_COMPACTION: Number(process.env.LLM_TEMP_SEMANTIC_COMPACTION) || 0,
    /** 히스토리 요약 */
    HISTORY_SUMMARY: Number(process.env.LLM_TEMP_HISTORY_SUMMARY) || 0.3,
} as const;

/**
 * 로컬 모델 샘플링 프리셋 — thinking ON/OFF 별 공식 권장값 (Qwen3.8 모델 카드 기준, 2026-09-03).
 * llm/sampling-preset.ts 가 "호출자가 샘플링을 지정하지 않은 로컬 요청"에만 채운다.
 *   THINKING : T 1.0 · top_p 0.95 · top_k 20 · presence 0.0 · repetition 1.0
 *   INSTRUCT : T 0.7 · top_p 0.80 · top_k 20 · presence 1.5 · repetition 1.0
 * repetition 1.0 은 서버 `--override-generation-config` 의 1.05 를 요청 단위로 되돌린다 —
 * 비추론 모드의 반복 억제는 공식 권장대로 presence_penalty 가 맡는다.
 * env: LLM_LOCAL_SAMPLING_PRESET_ENABLED(기본 true), LLM_SAMPLING_{THINKING,INSTRUCT}_{TEMP,TOP_P,TOP_K,PRESENCE,REPETITION}
 */
const samplingNum = (key: string, fallback: number): number => {
    const v = Number(process.env[key]);
    return Number.isFinite(v) && process.env[key] !== undefined && process.env[key] !== '' ? v : fallback;
};
/**
 * 로컬 도구 루프에서 assistant 의 reasoning(thinking) 을 다음 턴 프롬프트에 되돌려 보낸다 (2026-09-03).
 * Qwen3.8 chat template 은 `preserve_thinking` 이 기본 true 라 assistant 메시지의 `reasoning_content` 를
 * 재주입한다 — 없으면 도구 호출 5턴 동안 매 라운드 직전 추론을 잃고 다시 생각한다(공식 권고 이탈).
 * 로컬(LLMClient) wire 에만 적용 — 외부 provider 는 별도 변환(OpenAICompatProvider)이라 무영향
 * (DeepSeek 등은 입력 reasoning_content 를 400 으로 거절한다).
 */
export const LOCAL_PRESERVE_THINKING_ENABLED = process.env.LLM_PRESERVE_THINKING !== 'false';

/**
 * 로컬 도구 정의에 `strict: true` 를 채운다 (2026-09-07).
 * vLLM 0.27.1 은 strict 도구가 하나라도 있으면 `tool_choice:auto` 에서도 xgrammar 구조화 태그로
 * 도구 호출 문법 + 인자 JSON 스키마(enum·타입·배열·required)를 디코딩 단계에서 강제한다
 * (`tool_parsers/structural_tag_registry.py` `_any_tool_strict`, 파서 qwen3_coder → `qwen_3_coder` 태그,
 * `VLLM_ENFORCE_STRICT_TOOL_CALLING` 기본 True). 라이브 실측(LiteLLM 경유): 위반 지시(enum 밖 값·문자열
 * 정수·문자열 배열·미선언 키)가 strict 없으면 그대로 통과, strict 면 스키마대로 교정. 병리적 스키마
 * 21종($ref·anyOf·format·pattern·긴 enum 등)·도구 60개 모두 200, TTFC 변화 없음. 자유 텍스트 답변도 그대로 가능.
 * 로컬(LLMClient, quotaExempt 아닌) wire 에만 적용 — 외부 OpenAI 호환 provider 는 strict 에 "전 속성 required +
 * additionalProperties:false" 를 요구해(OpenAI 규격) 선택 인자가 있는 도구가 400 이 되므로 보내지 않는다.
 * env: LLM_LOCAL_TOOL_STRICT(기본 true). 'false' 로 끄면 종전처럼 strict 미전송.
 */
export const LOCAL_TOOL_STRICT_ENABLED = process.env.LLM_LOCAL_TOOL_STRICT !== 'false';

export const LOCAL_SAMPLING_PRESETS = {
    ENABLED: process.env.LLM_LOCAL_SAMPLING_PRESET_ENABLED !== 'false',
    THINKING: {
        temperature: samplingNum('LLM_SAMPLING_THINKING_TEMP', 1.0),
        top_p: samplingNum('LLM_SAMPLING_THINKING_TOP_P', 0.95),
        top_k: samplingNum('LLM_SAMPLING_THINKING_TOP_K', 20),
        presence_penalty: samplingNum('LLM_SAMPLING_THINKING_PRESENCE', 0.0),
        repeat_penalty: samplingNum('LLM_SAMPLING_THINKING_REPETITION', 1.0),
    },
    INSTRUCT: {
        temperature: samplingNum('LLM_SAMPLING_INSTRUCT_TEMP', 0.7),
        top_p: samplingNum('LLM_SAMPLING_INSTRUCT_TOP_P', 0.8),
        top_k: samplingNum('LLM_SAMPLING_INSTRUCT_TOP_K', 20),
        presence_penalty: samplingNum('LLM_SAMPLING_INSTRUCT_PRESENCE', 1.5),
        repeat_penalty: samplingNum('LLM_SAMPLING_INSTRUCT_REPETITION', 1.0),
    },
} as const;

// ============================================
// Top-p / 기타 샘플링 파라미터
// ============================================

/**
 * 로컬 모델 반복(degeneration) 방지 frequency_penalty 기본값.
 *
 * 근거(라이브 UI 재현): qwen 등 로컬 모델이 동일 토큰을 무한 반복("오오오오…")하며
 * 응답이 붕괴하는 결함이 관측됐다. 채팅 경로가 penalty 를 전혀 설정하지 않아
 * vLLM 기본(0=억제 없음)으로 호출되던 것이 원인.
 *
 * 2026-07-09: vLLM 서빙 계층에 서버 기본값 repetition_penalty=1.05 가 적용됨
 * (start_vllm.sh --override-generation-config). 반복 억제 안전망은 이제 서버가
 * 모든 콜러(penalty 미설정 클라이언트 포함)에 대해 보유하므로, 앱은 이중 억제(품질
 * 저하 위험)를 피하기 위해 기본 0(서버에 위임)으로 둔다. 서버 값만으로 부족하면
 * env LLM_FREQUENCY_PENALTY 로 앱 측 추가 억제를 켤 수 있다(단일 소스 원칙상 서버 조정 우선).
 * 외부 provider(Claude/GPT 등)에는 어차피 미적용(자체 디코딩 안전장치 보유).
 */
export const LLM_ANTI_DEGENERATION_FREQUENCY_PENALTY = Number(process.env.LLM_FREQUENCY_PENALTY ?? 0);

// ============================================
// 신뢰도 제수(Divisor)
// ============================================

/**
 * 신뢰도 계산 시 정규화에 사용하는 제수
 * confidence = min(score / divisor, 1.0)
 */
export const CONFIDENCE_DIVISORS = {
    /** 쿼리 분류기 (query-classifier.ts) */
    QUERY_CLASSIFIER: Number(process.env.CONFIDENCE_DIV_QUERY) || 4,
    /** 키워드 라우터 (keyword-router.ts) */
    KEYWORD_ROUTER: Number(process.env.CONFIDENCE_DIV_KEYWORD) || 10,
    /** 토픽 분석기 (topic-analyzer.ts) */
    TOPIC_ANALYZER: Number(process.env.CONFIDENCE_DIV_TOPIC) || 3,
} as const;
