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
