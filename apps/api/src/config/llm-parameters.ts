/**
 * ============================================================
 * LLM 파라미터 중앙 관리
 * ============================================================
 * temperature, confidence 제수(divisor) 등 LLM 호출 시
 * 사용하는 수치 파라미터를 정의합니다.
 * 환경변수로 오버라이드할 수 있습니다.
 *
 * MODEL_PRESETS: Gemini/GPT-OSS 모델별 LLM 파라미터 프리셋도
 * 이 모듈에서 중앙 관리합니다.
 *
 * @module config/llm-parameters
 */

import { MODEL_CONTEXT_DEFAULTS } from './runtime-limits';

// ============================================
// Temperature 프리셋
// ============================================

/**
 * 용도별 LLM temperature 값
 * 각 서비스/라우트에서 참조
 */
export const LLM_TEMPERATURES = {
    /** 메모리 추출 (ChatService) */
    MEMORY_EXTRACTION: Number(process.env.LLM_TEMP_MEMORY_EXTRACTION) || 0.1,
    /** 문서 요약 (documents.routes) */
    DOCUMENT_SUMMARY: Number(process.env.LLM_TEMP_DOCUMENT_SUMMARY) || 0.1,
    /** 문서 Q&A (documents.routes) */
    DOCUMENT_QA: Number(process.env.LLM_TEMP_DOCUMENT_QA) || 0.1,
    /** 웹 검색 사실 검증 (web-search.routes) */
    WEB_SEARCH: Number(process.env.LLM_TEMP_WEB_SEARCH) || 0.3,
    /** 리서치 주제 분해 (DeepResearchService) */
    RESEARCH_PLAN: Number(process.env.LLM_TEMP_RESEARCH_PLAN) || 0.3,
    /** 리서치 청크 합성 (DeepResearchService) */
    RESEARCH_SYNTHESIS: Number(process.env.LLM_TEMP_RESEARCH_SYNTHESIS) || 0.35,
    /** 리서치 최종 보고서 / 병합 (DeepResearchService) */
    RESEARCH_REPORT: Number(process.env.LLM_TEMP_RESEARCH_REPORT) || 0.4,
    /** 리서치 사실 확인 (DeepResearchService) */
    RESEARCH_FACT_CHECK: Number(process.env.LLM_TEMP_RESEARCH_FACT_CHECK) || 0.1,
    /** Discussion 이미지 분석 (discussion-strategy) */
    DISCUSSION: Number(process.env.LLM_TEMP_DISCUSSION) || 0.2,
    /** 에이전트 도구 호출 OCR (agent-loop-strategy) */
    AGENT_TOOL_CALL: Number(process.env.LLM_TEMP_AGENT_TOOL_CALL) || 0.1,
    /** 에이전트 이미지 분석 응답 (agent-loop-strategy) */
    AGENT_RESPONSE: Number(process.env.LLM_TEMP_AGENT_RESPONSE) || 0.3,
    /** format 지정 시 strict 모드 temperature */
    FORMAT_STRICT: 0,
    /** Semantic Compactor — 도구 결과 요약 시 결정론적 응답 강제 */
    SEMANTIC_COMPACTION: Number(process.env.LLM_TEMP_SEMANTIC_COMPACTION) || 0,
    /** Generate-Verify Verifier 응답 — 낮은 값으로 정확한 검증 수행 */
    GV_VERIFIER: Number(process.env.LLM_TEMP_GV_VERIFIER) || 0.1,
    /** Gemini 비추론 모드 */
    GEMINI_NON_REASONING: 0.5,
    /** Gemini 추론 모드 */
    GEMINI_REASONING: 0.6,
    /** Gemini 한국어 모드 */
    GEMINI_KOREAN: 0.1,
    /** Gemini 코드 모드 */
    GEMINI_CODE: 0.3,
    /** 리뷰어/보안 모드 */
    REVIEWER: 0.4,
    /** 설명/작문/번역 모드 */
    EXPLAINER: 0.5,
    /** CLI 코드 리뷰 */
    CLI_REVIEW: Number(process.env.LLM_TEMP_CLI_REVIEW) || 0.3,
    /** CLI 코드 설명 */
    CLI_EXPLAIN: Number(process.env.LLM_TEMP_CLI_EXPLAIN) || 0.3,
    /** CLI 코드 생성 */
    CLI_GENERATE: Number(process.env.LLM_TEMP_CLI_GENERATE) || 0.5,
    /** 히스토리 요약 */
    HISTORY_SUMMARY: Number(process.env.LLM_TEMP_HISTORY_SUMMARY) || 0.3,
    /** thinking='high' temperature */
    THINKING_HIGH: Number(process.env.LLM_TEMP_THINKING_HIGH) || 0.3,
    /** thinking='off' temperature */
    THINKING_OFF: Number(process.env.LLM_TEMP_THINKING_OFF) || 0.7,
    /** thinking 기본값 temperature */
    THINKING_DEFAULT: Number(process.env.LLM_TEMP_THINKING_DEFAULT) || 0.5,
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

// ============================================
// 모델 프리셋 (MODEL_PRESETS)
// ============================================

/**
 * 모델별 LLM 파라미터 프리셋
 *
 * temperature, top_p, top_k, 컨텍스트 크기 등의 값을 포함합니다.
 *
 * - `GEMINI_*`: Gemini 모델용 프리셋
 * - `GPT_OSS_*`: GPT-OSS 모델용 프리셋
 *
 * @constant MODEL_PRESETS
 */
const MODEL_PRESETS = {
    // Gemini 3 Flash Preview 프리셋
    GEMINI_DEFAULT: {
        temperature: 0.7,
        top_p: 0.9,
        top_k: 40,
        num_ctx: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
        repeat_penalty: 1.1,
    },
    GEMINI_REASONING: {
        temperature: 0.3,
        top_p: 0.85,
        top_k: 20,
        num_ctx: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
        repeat_penalty: 1.05,
    },
    GEMINI_CREATIVE: {
        temperature: 0.9,
        top_p: 0.95,
        top_k: 50,
        num_ctx: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
        repeat_penalty: 1.2,
    },
    GEMINI_CODE: {
        temperature: 0.2,
        top_p: 0.8,
        top_k: 10,
        num_ctx: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
        repeat_penalty: 1.0,
    },
    GPT_OSS_LOW_REASONING: {
        temperature: 0.3,
        top_p: 0.85,
        top_k: 30,
        repeat_penalty: 1.1,
        num_ctx: MODEL_CONTEXT_DEFAULTS.LOW_NUM_CTX,
        num_predict: MODEL_CONTEXT_DEFAULTS.LOW_NUM_PREDICT
    },

    GPT_OSS_MEDIUM_REASONING: {
        temperature: 0.5,
        top_p: 0.9,
        top_k: 40,
        repeat_penalty: 1.1,
        num_ctx: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
        num_predict: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_PREDICT
    },

    GPT_OSS_HIGH_REASONING: {
        temperature: 0.7,
        top_p: 0.95,
        top_k: 50,
        repeat_penalty: 1.15,
        num_ctx: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
        num_predict: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_PREDICT
    },

    GPT_OSS_CODE: {
        temperature: 0.1,
        top_p: 0.8,
        top_k: 20,
        repeat_penalty: 1.2,
        num_ctx: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
        num_predict: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_PREDICT
    },

    GPT_OSS_DOCUMENT: {
        temperature: 0.2,
        top_p: 0.85,
        top_k: 25,
        repeat_penalty: 1.15,
        num_ctx: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
        num_predict: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_PREDICT
    },

    GPT_OSS_JSON: {
        temperature: 0.05,
        top_p: 0.75,
        top_k: 15,
        repeat_penalty: 1.15,
        num_ctx: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_CTX,
        num_predict: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_PREDICT,
        mirostat: 1,
        mirostat_tau: 2.5,
        mirostat_eta: 0.05
    },
};

// ============================================
// 프롬프트 역할별 프리셋 매핑 (Record 룩업)
// ============================================

/**
 * PromptType → ModelOptions 매핑
 * chat/prompt.ts의 getPresetForPromptType()에서 참조
 */
export const PROMPT_TYPE_PRESETS: Record<string, typeof MODEL_PRESETS[keyof typeof MODEL_PRESETS]> = {
    reasoning: MODEL_PRESETS.GEMINI_REASONING,
    researcher: MODEL_PRESETS.GEMINI_REASONING,
    consultant: MODEL_PRESETS.GEMINI_REASONING,
    coder: MODEL_PRESETS.GEMINI_CODE,
    generator: MODEL_PRESETS.GEMINI_CODE,
    reviewer: { ...MODEL_PRESETS.GEMINI_CODE, temperature: LLM_TEMPERATURES.REVIEWER, repeat_penalty: 1.15 },
    security: { ...MODEL_PRESETS.GEMINI_CODE, temperature: LLM_TEMPERATURES.REVIEWER, repeat_penalty: 1.15 },
    explainer: { ...MODEL_PRESETS.GEMINI_DEFAULT, temperature: LLM_TEMPERATURES.EXPLAINER },
    writer: { ...MODEL_PRESETS.GEMINI_DEFAULT, temperature: LLM_TEMPERATURES.EXPLAINER },
    translator: { ...MODEL_PRESETS.GEMINI_DEFAULT, temperature: LLM_TEMPERATURES.EXPLAINER },
    agent: MODEL_PRESETS.GEMINI_REASONING,
    assistant: MODEL_PRESETS.GEMINI_REASONING,
};
