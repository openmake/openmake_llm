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
    /** Brand Model thinking='high' temperature */
    THINKING_HIGH: Number(process.env.LLM_TEMP_THINKING_HIGH) || 0.3,
    /** Brand Model thinking='off' temperature */
    THINKING_OFF: Number(process.env.LLM_TEMP_THINKING_OFF) || 0.7,
    /** Brand Model thinking 기본값 temperature */
    THINKING_DEFAULT: Number(process.env.LLM_TEMP_THINKING_DEFAULT) || 0.5,
} as const;

// ============================================
// Top-p / 기타 샘플링 파라미터
// ============================================

/**
 * 용도별 top_p 값
 * temperature와 함께 LLM 샘플링 제어에 사용
 */
export const LLM_TOP_P = {
    /** Gemini 기본/비추론/한국어/코드 */
    GEMINI_DEFAULT: 0.9,
    /** Gemini 추론 */
    GEMINI_REASONING: 0.95,
    /** 안티 디제너레이션 */
    ANTI_DEGENERATION_PRESENCE_PENALTY: 1.5,
} as const;

// ============================================
// Predict 제한 (num_predict)
// ============================================

/**
 * 용도별 최대 토큰 생성 수 제한
 */
export const LLM_PREDICT_LIMITS = {
    /** 메모리 추출 시 최대 토큰 */
    MEMORY_EXTRACTION: Number(process.env.LLM_PREDICT_MEMORY_EXTRACTION) || 512,
} as const;

/**
 * 복잡도 기반 토큰 예산 (num_predict 동적 제어)
 *
 * assessComplexity()의 복잡도 점수와 QueryType을 기반으로
 * 권장 num_predict 값을 결정할 때 사용합니다.
 *
 * UNLIMITED(0)은 Ollama에서 제한 없음을 의미합니다.
 */
export const TOKEN_BUDGETS = {
    /** 최소 토큰 보장 (응답 잘림 방지) */
    MIN_TOKENS: Number(process.env.OMK_TOKEN_BUDGET_MIN) || 128,
    /** 저복잡도 (score < 0.3) 기본 예산 */
    LOW: Number(process.env.OMK_TOKEN_BUDGET_LOW) || 256,
    /** 중복잡도 (0.3 <= score < 0.6) 기본 예산 */
    MEDIUM: Number(process.env.OMK_TOKEN_BUDGET_MEDIUM) || 1024,
    /** 고복잡도 (0.6 <= score < 0.8) 기본 예산 */
    HIGH: Number(process.env.OMK_TOKEN_BUDGET_HIGH) || 2048,
    /** 최고복잡도 (score >= 0.8) — 0은 제한 없음 (Ollama 기본값 사용) */
    UNLIMITED: 0,
    /** QueryType별 오버라이드 — 복잡도 점수와 독립적으로 최소 보장 예산 */
    BY_TYPE: {
        'chat': Number(process.env.OMK_TOKEN_BUDGET_CHAT) || 512,
        'korean': Number(process.env.OMK_TOKEN_BUDGET_KOREAN) || 512,
        'translation': Number(process.env.OMK_TOKEN_BUDGET_TRANSLATION) || 1024,
        'vision': Number(process.env.OMK_TOKEN_BUDGET_VISION) || 1024,
        'math-applied': Number(process.env.OMK_TOKEN_BUDGET_MATH_APPLIED) || 1024,
        'creative': Number(process.env.OMK_TOKEN_BUDGET_CREATIVE) || 2048,
        'analysis': Number(process.env.OMK_TOKEN_BUDGET_ANALYSIS) || 2048,
        'document': Number(process.env.OMK_TOKEN_BUDGET_DOCUMENT) || 2048,
        'code-gen': Number(process.env.OMK_TOKEN_BUDGET_CODE_GEN) || 2048,
        'code-agent': Number(process.env.OMK_TOKEN_BUDGET_CODE_AGENT) || 2048,
        'reasoning': Number(process.env.OMK_TOKEN_BUDGET_REASONING) || 4096,
        'math-hard': Number(process.env.OMK_TOKEN_BUDGET_MATH_HARD) || 4096,
    } as Record<string, number>,
} as const;

/**
 * 저복잡도 쿼리 프롬프트 지시어
 * complexity score < GV_SKIP_THRESHOLD 일 때 시스템 프롬프트 끝에 주입하여
 * LLM이 간결한 응답을 생성하도록 유도합니다.
 */
export const CONCISE_RESPONSE_DIRECTIVE =
    process.env.OMK_CONCISE_DIRECTIVE ??
    'Provide a concise, focused answer. Avoid unnecessary repetition or lengthy explanations.';

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
// QueryType별 모델 파라미터 조정값
// ============================================

/**
 * model-selector.ts의 adjustOptionsForModel()에서 사용하는
 * QueryType별 LLM 파라미터 오버라이드 값
 */
export const QUERY_TYPE_PARAMS = {
    /** Qwen Coder 모델 temperature 상한 */
    QWEN_CODER_TEMP_CAP: 0.3,
    /** Vision 모델 temperature */
    VISION_TEMP: 0.6,
    /** 코드 관련 QueryType temperature 상한 */
    CODE_TEMP_CAP: 0.3,
    /** 창작 QueryType temperature 하한 */
    CREATIVE_TEMP_FLOOR: 0.85,
    /** 창작 QueryType top_p */
    CREATIVE_TOP_P: 0.95,
    /** 수학 QueryType temperature */
    MATH_TEMP: 0.1,
    /** 수학 QueryType top_p */
    MATH_TOP_P: 0.8,
    /** 추론 QueryType temperature */
    REASONING_TEMP: 0.2,
    /** 추론 QueryType top_p */
    REASONING_TOP_P: 0.85,
    /** 번역 QueryType temperature */
    TRANSLATION_TEMP: 0.3,
    /** 번역 QueryType repeat_penalty */
    TRANSLATION_REPEAT_PENALTY: 1.2,
    /** 기본 fallback temperature */
    DEFAULT_TEMP_FALLBACK: 0.7,
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
export const MODEL_PRESETS = {
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

// ============================================
// GPT-OSS 프리셋 매핑 (Record 룩업)
// ============================================

/**
 * ReasoningLevel → GPT-OSS ModelOptions 매핑
 * ollama/types.ts의 getGptOssPreset()에서 참조
 */
export const GPT_OSS_LEVEL_PRESETS: Record<string, typeof MODEL_PRESETS[keyof typeof MODEL_PRESETS]> = {
    low: MODEL_PRESETS.GPT_OSS_LOW_REASONING,
    medium: MODEL_PRESETS.GPT_OSS_MEDIUM_REASONING,
    high: MODEL_PRESETS.GPT_OSS_HIGH_REASONING,
};

/**
 * TaskType → GPT-OSS ModelOptions 매핑
 * ollama/types.ts의 getGptOssTaskPreset()에서 참조
 */
export const GPT_OSS_TASK_PRESETS: Record<string, typeof MODEL_PRESETS[keyof typeof MODEL_PRESETS]> = {
    code: MODEL_PRESETS.GPT_OSS_CODE,
    document: MODEL_PRESETS.GPT_OSS_DOCUMENT,
    json: MODEL_PRESETS.GPT_OSS_JSON,
};

// ============================================
// 역할 → 도구 등급 매핑 (Record 룩업)
// ============================================

/**
 * 사용자 역할 → 기본 도구 등급 매핑
 * mcp/tool-tiers.ts의 getDefaultTierForRole()에서 참조
 */
export const ROLE_TIER_MAP: Record<string, string> = {
    admin: 'enterprise',
    user: 'free',
    guest: 'free',
};
