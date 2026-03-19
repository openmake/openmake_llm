/**
 * ============================================================
 * 런타임 제한값 중앙 관리
 * ============================================================
 * 컨텍스트 윈도우, 토큰 예산, 문서 처리 길이, 콘텐츠 절단(truncation)
 * 등 런타임에서 사용하는 크기/용량 관련 상수를 정의합니다.
 *
 * @module config/runtime-limits
 */

// ============================================
// 컨텍스트 윈도우 (문자 수)
// ============================================

/**
 * LLM 모델별 최대 컨텍스트 길이 (문자 수 기준)
 *
 * Gemini 계열은 100K 토큰 이상의 대형 컨텍스트를 지원하고,
 * 일반 모델은 약 30K 문자 수준에서 안정적으로 동작합니다.
 */
export const CONTEXT_LIMITS = {
    /** Gemini 모델 최대 컨텍스트 길이 (문자) */
    GEMINI_MAX_CONTEXT_CHARS: 100000,
    /** 일반 모델 최대 컨텍스트 길이 (문자) */
    DEFAULT_MAX_CONTEXT_CHARS: 30000,
} as const;

// ============================================
// 토큰 예산 (Discussion/Context Engineering)
// ============================================

/**
 * Discussion 전략에서 사용하는 토큰 예산
 * discussion-strategy.ts, discussion-context.ts에서 참조
 */
export const DISCUSSION_TOKEN_BUDGET = {
    /** Discussion 모드 기본 토큰 예산 */
    DEFAULT: {
        maxTotalTokens: 10000,
        maxDocumentTokens: 4000,
        maxHistoryTokens: 2000,
        maxWebSearchTokens: 2000,
        maxMemoryTokens: 1500,
    },
    /** 요약/보조 Discussion 컨텍스트 토큰 예산 */
    COMPACT: {
        maxTotalTokens: 8000,
        maxDocumentTokens: 3000,
        maxHistoryTokens: 2000,
        maxWebSearchTokens: 1500,
        maxMemoryTokens: 1000,
    },
} as const;

// ============================================
// 대화 히스토리 요약 설정
// ============================================

/**
 * 대화 히스토리가 길어질 때 자동 요약을 적용하는 설정.
 * ChatService에서 히스토리 조립 전에 참조합니다.
 */
export const HISTORY_SUMMARIZER = {
    /** 요약을 트리거하는 최소 히스토리 메시지 수 */
    MIN_MESSAGES_TO_SUMMARIZE: 10,
    /** 요약 없이 그대로 유지할 최근 메시지 수 */
    RECENT_MESSAGES_TO_KEEP: 6,
    /** 요약 대상(오래된 메시지)의 최대 글자 수 (초과 시 잘라서 요약) */
    MAX_CHARS_FOR_SUMMARY_INPUT: 12000,
    /** 요약 결과의 최대 토큰 수 (LLM 응답 제한) */
    MAX_SUMMARY_TOKENS: 500,
    /** 요약 LLM 호출 타임아웃 (ms) */
    SUMMARY_TIMEOUT_MS: 15000,
} as const;

// ============================================
// 문서 처리 크기
// ============================================

/**
 * 문서 분석/처리 시 사용하는 크기 제한
 */
export const DOCUMENT_PROCESSING = {
    /** 문서 텍스트 최대 처리 길이 (일반) */
    MAX_TEXT_LENGTH: 30000,
    /** 문서 텍스트 최대 처리 길이 (요약용) */
    MAX_SUMMARY_TEXT_LENGTH: 28000,
    /** 문서 미리보기 길이 (문자) */
    PREVIEW_LENGTH: 500,
    /** 이미지 리사이즈 최대 해상도 */
    IMAGE_RESAMPLE_MAX: 3000,
} as const;

// ============================================
// 콘텐츠 절단 (Truncation)
// ============================================

/**
 * API 응답, 로깅, 요약 시 텍스트를 자르는 최대 길이
 */
export const TRUNCATION = {
    /** 웹 페이지 콘텐츠 추출 최대 길이 */
    WEB_CONTENT_MAX: 3000,
    /** 웹 검색 결과 스니펫 길이 */
    WEB_SNIPPET_MAX: 200,
    /** Deep Research 중간 요약 최대 길이 */
    RESEARCH_SUMMARY_MAX: 4000,
    /** Deep Research 소스 콘텐츠 최대 길이 */
    RESEARCH_CONTENT_MAX: 5000,
    /** Firecrawl 결과 콘텐츠 최대 길이 */
    FIRECRAWL_CONTENT_MAX: 1000,
    /** Firecrawl URL 목록 최대 수 */
    FIRECRAWL_MAX_URLS: 50,
    /** Discussion 이미지 분석 응답 최대 길이 */
    DISCUSSION_IMAGE_ANALYSIS_MAX: 500,
    /** Discussion 히스토리 항목 최대 길이 */
    DISCUSSION_HISTORY_ITEM_MAX: 300,
    /** Discussion 최대 이미지 수 */
    DISCUSSION_MAX_IMAGES: 3,
    /** 메모리 키 최대 길이 */
    MEMORY_KEY_MAX: 100,
    /** 메모리 값 최대 길이 */
    MEMORY_VALUE_MAX: 1000,
    /** 메모리 태그 최대 수 */
    MEMORY_MAX_TAGS: 5,
    /** 로그 메시지 미리보기 길이 */
    LOG_PREVIEW_MAX: 100,
    /** 캐시 키 미리보기 길이 */
    CACHE_KEY_PREVIEW_MAX: 50,
    /** API Key 마스킹 길이 (앞 8자) */
    API_KEY_MASK_PREFIX: 8,
    /** 검색 결과 매칭 패턴 미리보기 */
    PATTERN_MATCH_PREVIEW_MAX: 30,
} as const;

// ============================================
// 용량 제한 (Capacity)
// ============================================

/**
 * 시스템 각 모듈의 항목 수/크기 제한
 */
export const CAPACITY = {
    /** LLM 라우터 입력 최대 문자 수 */
    ROUTING_INPUT_MAX_CHARS: 10000,
    /** Analytics 쿼리 로그 최대 항목 수 */
    ANALYTICS_MAX_QUERY_LOG: 10000,
    /** Analytics 세션 로그 최대 항목 수 */
    ANALYTICS_MAX_SESSION_LOG: 5000,
    /** Metrics 슬라이딩 윈도우 최대 샘플 수 */
    METRICS_WINDOW_SIZE: 1000,
    /** 웹 검색 Ollama num_ctx 설정 (에이전트용 최소 64K 토큰) */
    WEB_SEARCH_NUM_CTX: 65536,
    /** MCP 파일 스캔 최대 파일 수 */
    MCP_MAX_SEARCH_FILES: 1000,
    /** 정규식 입력 최대 길이 (MemoryService) */
    REGEX_SAFE_INPUT_MAX_LENGTH: 10000,
    /** DuckDuckGo 관련 토픽 최대 수 */
    DDG_MAX_RELATED_TOPICS: 5,
    /** Deep Research 검색 쿼리 최대 수 */
    RESEARCH_MAX_SEARCH_QUERIES: 3,
    /** Deep Research 쿼리당 소스 최대 수 */
    RESEARCH_MAX_SOURCES_PER_QUERY: 10,
    /** Deep Research 전체 소스 최대 수 */
    RESEARCH_MAX_TOTAL_SOURCES: 15,
    /** Deep Research 결과 상위 N개 (유틸) */
    RESEARCH_TOP_RESULTS: 20,
    /** 검색 결과 응답 미리보기 최대 항목 */
    SEARCH_RESULT_MAX_DISPLAY: 10,
    /** Admin 대화 내보내기 SQL LIMIT */
    ADMIN_EXPORT_LIMIT: 10000,
} as const;

// ============================================
// 모델 컨텍스트 윈도우 기본값
// ============================================

/**
 * 모델별 num_ctx, num_predict 기본값 (토큰 수)
 * model-selector.ts, ollama/types.ts MODEL_PRESETS에서 참조
 */
export const MODEL_CONTEXT_DEFAULTS = {
    /** 기본 num_ctx (일반 모델) */
    DEFAULT_NUM_CTX: 32768,
    /** 확장 num_ctx (Kimi 등 긴 컨텍스트 모델) */
    EXTENDED_NUM_CTX: 65536,
    /** 저사양 모델 num_ctx */
    LOW_NUM_CTX: 16384,
    /** 기본 num_predict (출력 최대 토큰) */
    DEFAULT_NUM_PREDICT: 8192,
    /** 저사양 모델 num_predict */
    LOW_NUM_PREDICT: 4096,
} as const;

// ============================================
// RAG (Retrieval-Augmented Generation) 설정
// ============================================

/**
 * RAG 파이프라인에서 사용하는 청킹/검색 설정
 */
// ============================================
// 캐시 설정
// ============================================

/**
 * 인메모리 캐시 TTL 및 용량 설정
 * SemanticClassificationCache, CacheSystem에서 참조
 */
export const CACHE_CONFIG = {
    /** L1 분류 캐시 TTL (ms) — 기본 30분 */
    CLASSIFICATION_CACHE_TTL_MS: 30 * 60 * 1000,
    /** L1 분류 캐시 최대 항목 수 */
    CLASSIFICATION_CACHE_MAX_SIZE: 500,
    /** 쿼리 응답 캐시 TTL (ms) — 기본 10분 */
    QUERY_CACHE_TTL_MS: 10 * 60 * 1000,
    /** 쿼리 응답 캐시 최대 항목 수 */
    QUERY_CACHE_MAX_SIZE: 200,
    /** 라우팅 캐시 TTL (ms) — 기본 5분 */
    ROUTING_CACHE_TTL_MS: 5 * 60 * 1000,
    /** 라우팅 캐시 최대 항목 수 */
    ROUTING_CACHE_MAX_SIZE: 100,
} as const;

export const RAG_CONFIG = {
    /** 문서 청크 크기 (문자 수) */
    CHUNK_SIZE: 1000,
    /** 청크 간 오버랩 (문자 수) */
    CHUNK_OVERLAP: 200,
    /** 검색 시 반환할 최대 청크 수 */
    TOP_K: 5,
    /** 관련도 임계값 (0.0~1.0, 이 값 이상만 반환, 0.45→0.6 상향: 무관 문서 혼입 방지) */
    RELEVANCE_THRESHOLD: 0.6,
    /** RAG 컨텍스트에 주입할 최대 문자 수 */
    MAX_CONTEXT_CHARS: 4000,
} as const;
