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
    /** 웹 스크래퍼 결과 콘텐츠 최대 길이 */
    SCRAPER_CONTENT_MAX: 1000,
    /** 웹 스크래퍼 URL 목록 최대 수 */
    SCRAPER_MAX_URLS: 50,
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
    /** 메모리 소프트 리밋 (기본 상한, 티어별 분기는 routes에서 처리) */
    MEMORY_SOFT_LIMIT: 500,
    /** 토큰→문자 변환 비율 (한국어 기준 보수적 추정) */
    TOKEN_TO_CHAR_RATIO: 3,
} as const;

// ============================================
// 메모리 감쇠 설정
// ============================================

/**
 * 메모리 중요도 감쇠에 사용하는 상수
 */
export const MEMORY_DECAY = {
    /** 감쇠 계수 (매 주기마다 importance에 곱함) */
    DECAY_FACTOR: 0.95,
    /** 감쇠 최저값 (importance가 이 값 이하로 내려가지 않음) */
    DECAY_FLOOR: 0.1,
} as const;

// ============================================
// Deep Research 기본 파라미터
// ============================================

/**
 * Deep Research 기본 검색/소스 파라미터
 */
export const RESEARCH_DEFAULTS = {
    /** 최대 검색 결과 수 */
    MAX_SEARCH_RESULTS: 200,
    /** 최대 전체 소스 수 */
    MAX_TOTAL_SOURCES: 50,
    /** 루프당 최대 스크래핑 수 */
    MAX_SCRAPE_PER_LOOP: 10,
    /** 스크래핑 동시 배치 크기 (jsdom CPU 부하 제어) */
    SCRAPE_BATCH_SIZE: 3,
    /** 청크 크기 (소스 개수 기준) */
    CHUNK_SIZE: 6,
    /** 합성 병렬 동시실행 수 */
    SYNTHESIS_CONCURRENCY: 5,
    /** 전체 합성을 실행하기 위한 최소 콘텐츠 길이 (문자). 이 미만이면 경량 합성 */
    MIN_CONTENT_FOR_FULL_SYNTHESIS: 1000,
    /** 검색 쿼리 최대 단어 수 (초과 시 잘림) */
    SEARCH_QUERY_MAX_WORDS: 10,
    /** 계층적 병합 전환 임계값 (청크 요약 수가 이 값 초과 시 재귀 병합) */
    MAP_REDUCE_THRESHOLD: 8,
    /** 계층적 병합 최대 깊이 (비용/지연 제어) */
    MAX_HIERARCHY_DEPTH: 2,
} as const;

// ============================================
// Deep Research Strategy 파라미터 (Chat 파이프라인 전용)
// ============================================

/**
 * DeepResearchStrategy에서 사용하는 파라미터 (chat-strategies/deep-research-strategy.ts)
 * RESEARCH_DEFAULTS보다 공격적인 설정 (WebSocket 스트리밍 기반 deep 모드)
 */
export const RESEARCH_STRATEGY_PARAMS = {
    /** 최대 반복 루프 수 */
    MAX_LOOPS: 5,
    /** 검색 API 종류 */
    SEARCH_API: 'all' as const,
    /** 최대 검색 결과 수 */
    MAX_SEARCH_RESULTS: 360,
    /** 최대 전체 소스 수 */
    MAX_TOTAL_SOURCES: 80,
    /** 전체 콘텐츠 스크래핑 활성화 */
    SCRAPE_FULL_CONTENT: true,
    /** 루프당 최대 스크래핑 수 */
    MAX_SCRAPE_PER_LOOP: 15,
    /** 청크 크기 (소스 개수 기준) */
    CHUNK_SIZE: 10,
} as const;

// ============================================
// Deep Research 깊이별 루프 설정
// ============================================

/**
 * Deep Research depth별 반복 루프 횟수
 */
export const RESEARCH_DEPTH_LOOPS: Record<string, number> = {
    quick: 1,
    standard: 2,
    deep: 4,
};

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
// 신뢰도/중요도 기본값
// ============================================

/**
 * 피드백 중요도 기본값
 * routes/chat-feedback.routes.ts에서 참조
 */
export const FEEDBACK_IMPORTANCE = {
    /** 부정 피드백 중요도 */
    NEGATIVE: 0.4,
    /** 긍정 피드백 중요도 */
    POSITIVE: 0.3,
    /** 재생성 요청 중요도 */
    REGENERATE: 0.35,
    /** 메모리 저장 기본 중요도 */
    MEMORY_DEFAULT: 0.5,
} as const;

/**
 * Discussion 응답 신뢰도 계산 파라미터
 * agents/discussion-engine.ts에서 참조
 */
export const DISCUSSION_CONFIDENCE = {
    /** 기본 신뢰도 */
    BASE: 0.6,
    /** 각 요소별 증가값 */
    INCREMENT: 0.1,
    /** 짧은 응답 길이 임계값 */
    SHORT_RESPONSE_LENGTH: 300,
    /** 긴 응답 길이 임계값 */
    LONG_RESPONSE_LENGTH: 600,
} as const;

/**
 * Self-Consistency Score 측정 설정
 * Anthropic 하네스 원칙: Load-bearing Verification — 에이전트 간 합의도 측정
 *
 * agents/discussion-engine.ts에서 참조
 */
export const DISCUSSION_CONSISTENCY = {
    /** Self-Consistency 측정 활성화 여부 */
    ENABLED: process.env.ENABLE_CONSISTENCY_SCORE !== 'false',
    /** 측정 최소 에이전트 수 (미만이면 스킵) */
    MIN_AGENTS: 3,
    /** Evaluator LLM 최대 토큰 */
    EVALUATOR_MAX_TOKENS: 300,
    /** 최소 일관성 점수 (미달 시 경고 플래그) */
    MIN_REQUIRED_SCORE: 0.6,
} as const;

/**
 * LLM 라우터 신뢰도 기본값
 * agents/llm-router.ts에서 참조
 */
export const ROUTER_CONFIDENCE_FALLBACK = 0.85;

/**
 * 메모리 카테고리별 중요도
 * services/MemoryService.ts에서 참조
 */
export const MEMORY_IMPORTANCE_BY_CATEGORY: Record<string, number> = {
    name: 0.9,
    job: 0.8,
    preference: 0.6,
    project: 0.7,
    technology: 0.7,
    location: 0.6,
    goal: 0.6,
    schedule: 0.7,
    language: 0.8,
    organization: 0.7,
};

/**
 * 언어 감지 임계값
 * chat/language-policy.ts에서 참조
 */
export const LANGUAGE_THRESHOLDS = {
    /** 비라틴 알파벳 비율 임계값 */
    NON_LATIN_RATIO: 0.3,
    /** 한국어 비율 상한 임계값 */
    KOREAN_HIGH: 0.7,
    /** 한국어 비율 하한 임계값 */
    KOREAN_LOW: 0.1,
    /** 영어 감지 신뢰도 */
    LATIN_EN_CONFIDENCE: 0.8,
    /** 기타 라틴 알파벳 언어 신뢰도 */
    LATIN_OTHER_CONFIDENCE: 0.75,
    /** 언어 감지 최소 신뢰도 */
    MIN_CONFIDENCE: 0.7,
    /** 짧은 텍스트 판별 임계값 (language-policy 기본값) */
    SHORT_TEXT_LENGTH: 10,
    /** 짧은 텍스트 판별 임계값 (request-handler, language-resolver, context-engineering) */
    SHORT_TEXT_LENGTH_EXTENDED: 20,
} as const;

// ============================================
// 캐시 설정
// ============================================

/**
 * 인메모리 캐시 TTL 및 용량 설정
 * SemanticClassificationCache, CacheSystem, MemoryService에서 참조
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
    /** 메모리 서비스 컨텍스트 캐시 TTL (ms) — 기본 5분 */
    MEMORY_CACHE_TTL_MS: 5 * 60 * 1000,
    /** 메모리 서비스 컨텍스트 캐시 최대 항목 수 */
    MEMORY_CACHE_MAX_SIZE: 200,
} as const;

// ============================================
// DB 재시도 정책
// ============================================

/**
 * DB 재시도 래퍼 기본 파라미터
 * data/retry-wrapper.ts에서 참조
 */
export const RETRY_DEFAULTS = {
    /** 최대 재시도 횟수 */
    MAX_RETRIES: 3,
    /** 기본 딜레이 (ms) */
    BASE_DELAY_MS: 500,
    /** 최대 딜레이 (ms) */
    MAX_DELAY_MS: 5000,
} as const;

// ============================================
// OAuth 상태 관리
// ============================================

/**
 * OAuth 상태 만료 및 정리 주기
 * auth/oauth-provider.ts에서 참조
 */
export const OAUTH_STATE = {
    /** 상태 만료 시간 (ms) — 10분 */
    EXPIRY_MS: 10 * 60 * 1000,
    /** 만료 상태 정리 주기 (ms) — 5분 */
    CLEANUP_INTERVAL_MS: 5 * 60 * 1000,
} as const;

// ============================================
// IDF 정규화 파라미터
// ============================================

/**
 * 키워드 IDF 가중치 정규화 범위
 * agents/enhanced-keywords.ts에서 참조
 */
export const IDF_NORMALIZATION = {
    /** IDF 하한값 */
    FLOOR: 0.1,
    /** IDF 상한값 */
    CEILING: 1.0,
} as const;

// ============================================
// 도메인 카테고리 분류 (Discussion 보완 에이전트)
// ============================================

/**
 * 토론 도메인 카테고리 분류
 * agents/discussion-recommender.ts에서 참조
 */
export const DISCUSSION_DOMAIN_CATEGORIES = {
    TECH: ['프로그래밍/개발', '데이터/AI'] as readonly string[],
    BUSINESS: ['비즈니스/창업', '금융/투자'] as readonly string[],
    SOCIAL: ['사회/복지', '공공/정부'] as readonly string[],
};

/**
 * 도메인별 보완 에이전트 목록
 * agents/discussion-recommender.ts에서 참조
 */
export const DISCUSSION_COMPLEMENTARY_AGENTS = {
    TECH: ['software-engineer', 'devops-engineer', 'ai-ml-engineer', 'data-analyst'],
    BUSINESS: ['business-strategist', 'financial-analyst', 'risk-manager', 'project-manager'],
    SOCIAL: ['sociologist', 'social-policy-researcher', 'demographer', 'labor-economist', 'policy-analyst'],
    DIVERSE: ['policy-analyst', 'business-strategist', 'data-analyst', 'educator', 'psychologist'],
};

// ============================================
// 키워드 라우터 페이즈 감지
// ============================================

/**
 * 작업 페이즈 감지 키워드 목록
 * agents/keyword-router.ts의 detectPhase()에서 참조
 */
export const PHASE_KEYWORDS = {
    PLANNING: ['설계', '계획', '기획', '분석', '조사', '검토', '평가', '전략', 'plan', 'design', 'analyze', '어떻게', '방법', '뭐가', '무엇'],
    BUILD: ['구현', '개발', '코딩', '만들', '작성', '생성', 'implement', 'build', 'create', 'develop', '해줘', '해 줘'],
    OPTIMIZATION: ['최적화', '개선', '리팩토링', '성능', '효율', 'optimize', 'improve', 'refactor', '더 좋', '더좋'],
};

// ============================================
// 인사말 감지 패턴
// ============================================

/**
 * 간단한 인사말 감지 설정
 * services/chat-service/context-builder.ts에서 참조
 */
export const GREETING_DETECTION = {
    /** 인사말로 판단할 최대 메시지 길이 */
    MAX_LENGTH: 15,
    /** 인사말 패턴 (정규식) */
    PATTERN: /^(안녕|하이|헬로|hello|hi|hey|good\s*(morning|afternoon|evening)|잘\s*지내|반가|감사합니다|고마워|ㅎㅇ|ㅎㅎ)/i,
};

// ============================================
// 이벤트 루프 양보 지연 (workflow)
// ============================================

/**
 * 워크플로우 그래프 엔진에서 이벤트 루프 양보 시 사용하는 지연 시간(ms)
 * workflow/graph-engine.ts에서 참조
 */
export const EVENT_LOOP_YIELD_MS = 10;

// ============================================
// SQL 안전 가드 제한
// ============================================

/**
 * 쿼리 결과 행 수 제한 (대량 조회 방지용 안전 가드)
 * data/repositories/external-repository.ts에서 참조
 */
export const QUERY_ROW_LIMITS = {
    /** MCP 서버 목록 최대 행 수 */
    MCP_SERVERS_MAX: 1000,
} as const;

// ============================================
// 비밀번호 복잡도 정책
// ============================================

/**
 * 비밀번호 복잡도 검증 규칙
 * services/AuthService.ts에서 참조
 */
export const PASSWORD_POLICY = {
    /** 최소 길이 */
    MIN_LENGTH: 8,
    /** 대문자 필수 패턴 */
    UPPERCASE: /[A-Z]/,
    /** 소문자 필수 패턴 */
    LOWERCASE: /[a-z]/,
    /** 숫자 필수 패턴 */
    DIGIT: /[0-9]/,
    /** 특수문자 필수 패턴 */
    SPECIAL: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/,
};

// ============================================
// 도구 결과 컴팩션 (Agent Loop)
// ============================================

/**
 * Agent Loop에서 오래된 도구 결과를 컴팩션하는 설정
 * services/chat-strategies/agent-loop-strategy.ts에서 참조
 *
 * Anthropic 하네스 설계 원칙: "오래된 도구 결과를 요약/정리하여
 * 컨텍스트 윈도우의 신호 대 잡음 비율을 유지"
 */
/**
 * JIT 메모리 필터링 최소 중요도
 * MemoryService.buildMemoryContext()에서 저품질 메모리 제외 시 사용
 */
export const JIT_MEMORY_MIN_IMPORTANCE = 0.2;

export const TOOL_RESULT_COMPACTION = {
    /** 원문을 유지할 최근 도구 결과 수 (이전 결과는 컴팩션) */
    KEEP_RECENT: 2,
    /** 컴팩션 시 도구 결과 최대 길이 (이상이면 잘라냄) */
    COMPACTED_MAX_CHARS: 200,
    /** 의미론적 요약 활성화 여부 (소형 모델로 요약, 기본 비활성) */
    USE_SEMANTIC: process.env.ENABLE_SEMANTIC_COMPACTION === 'true',
    /** 의미론적 요약 사용 소형 모델 */
    COMPACTOR_MODEL: process.env.COMPACTOR_MODEL || 'phi3:mini',
    /** 의미론적 요약 시 결과 최대 토큰 수 */
    SEMANTIC_MAX_TOKENS: 150,
    /** 의미론적 요약 대상 최소 길이 (이보다 짧으면 단순 절단) */
    SEMANTIC_THRESHOLD_CHARS: 500,
} as const;

// ============================================
// GV 품질 측정
// ============================================

/**
 * Generate-Verify 품질 측정 설정
 * services/chat-strategies/generate-verify-strategy.ts에서 참조
 */
// ============================================
// 동적 토큰 예산 프롬프트
// ============================================

/**
 * 잔여 토큰 예산이 부족할 때 시스템 프롬프트에 간결 응답 지시를 주입
 * Anthropic 하네스 원칙: "토큰 예산 인식 프롬프트 제어"
 */
export const BUDGET_HINTS = {
    /** 간결 지시 주입 임계값 (잔여 비율, 0.0~1.0) */
    LOW_BUDGET_THRESHOLD: 0.2,
    /** 한국어 간결 지시 */
    HINT_KO: '주의: 토큰 예산이 부족합니다. 핵심만 간결하게 답변하세요. 불필요한 설명을 생략하세요.',
    /** 영어 간결 지시 */
    HINT_EN: 'Notice: Token budget is low. Be extremely concise and focus only on core answers.',
} as const;

// ============================================
// Thinking 모드 Sprint Contract
// ============================================

/**
 * Thinking 모드의 단계별 사고 제어 파라미터
 * Anthropic 하네스 원칙: Sprint Contract — 코드 레벨 토큰/단계 예산 제어
 *
 * services/chat-strategies/thinking-strategy.ts에서 참조
 */
// ============================================
// 웹 검색 결과 신뢰도 스코어링
// ============================================

/**
 * 검색 결과 신선도/신뢰도 수치화 설정
 * Anthropic 하네스 원칙: Load-bearing Verification — 검색 결과 품질 측정
 *
 * mcp/web-search/search-orchestrator.ts에서 참조
 */
export const SEARCH_RELIABILITY = {
    /** 공식 도메인 가산점 */
    OFFICIAL_DOMAIN_BOOST: 0.3,
    /** 공식 도메인 패턴 */
    OFFICIAL_DOMAINS: ['.gov', '.edu', '.org', '.ac.kr', '.go.kr', '.or.kr'] as readonly string[],
    /** 신선도 가산 기간 (일, 이내면 가산) */
    RECENCY_BONUS_DAYS: 365,
    /** 신선도 감산 기간 (일, 초과하면 감산) */
    RECENCY_PENALTY_DAYS: 1095,
    /** 관련도 가중치 (정렬 시) */
    RELEVANCE_WEIGHT: 0.6,
    /** 신뢰도 가중치 (정렬 시) */
    RELIABILITY_WEIGHT: 0.4,
} as const;

// ============================================
// Context GC (컨텍스트 윈도우 가비지 컬렉션)
// ============================================

/**
 * 에이전트 루프 실행 중 컨텍스트 윈도우 압력을 모니터링하고,
 * 불필요한 중간 메시지를 정리하는 가비지 컬렉션 설정
 *
 * Harness Engineering 원칙: Constrain — 컨텍스트 윈도우의 신호 대 잡음 비율을
 * 유지하기 위해 오래된/불필요한 메시지를 적응형으로 정리합니다.
 *
 * services/chat-strategies/context-gc.ts에서 참조
 */
export const CONTEXT_GC = {
    /** Context GC 활성화 여부 */
    ENABLED: process.env.CONTEXT_GC_ENABLED !== 'false',
    /** 컨텍스트 압력 측정 기준: 최대 허용 문자 수 */
    MAX_CONTEXT_CHARS: Number(process.env.CONTEXT_GC_MAX_CHARS) || 30000,
    /** 경고 압력 임계값 (0.0~1.0, 사용률이 이 비율 초과 시 warning) */
    WARNING_THRESHOLD: parseFloat(process.env.CONTEXT_GC_WARNING || '0.6'),
    /** 위기 압력 임계값 (0.0~1.0, 사용률이 이 비율 초과 시 critical) */
    CRITICAL_THRESHOLD: parseFloat(process.env.CONTEXT_GC_CRITICAL || '0.8'),
    /** 보호할 최근 메시지 수 (system + 최근 N개는 정리 대상에서 제외) */
    PROTECTED_RECENT_COUNT: Number(process.env.CONTEXT_GC_PROTECTED) || 4,
    /** assistant 중간 메시지 컴팩션 시 최대 길이 */
    ASSISTANT_COMPACT_MAX_CHARS: Number(process.env.CONTEXT_GC_ASSIST_MAX) || 300,
    /** critical 수준에서 tool 결과 압축 최소 문자 수 */
    TOOL_COMPACT_MIN_CHARS: Number(process.env.CONTEXT_GC_TOOL_COMPACT_MIN) || 100,
    /** GC 결과를 metrics에 포함할지 여부 */
    INCLUDE_IN_METRICS: process.env.CONTEXT_GC_INCLUDE_METRICS !== 'false',
} as const;

// ============================================
// Eval Pipeline (응답 품질 평가)
// ============================================

/**
 * 에이전트 응답 품질을 체계적으로 평가하는 파이프라인 설정
 *
 * Harness Engineering 원칙: Verify — 에이전트 응답의 품질을 다차원으로 측정하여
 * 개선 포인트를 식별하고 시스템 최적화에 활용합니다.
 *
 * services/chat-strategies/eval-pipeline.ts에서 참조
 */
export const EVAL_PIPELINE = {
    /** Eval Pipeline 활성화 여부 */
    ENABLED: process.env.EVAL_PIPELINE_ENABLED !== 'false',
    /** 평가 결과를 metrics에 포함할지 여부 */
    INCLUDE_IN_METRICS: process.env.EVAL_INCLUDE_METRICS !== 'false',
    /** 평가를 스킵할 최소 응답 길이 (짧은 인사/단답은 스킵) */
    MIN_RESPONSE_LENGTH: Number(process.env.EVAL_MIN_RESPONSE_LENGTH) || 50,
    /** 응답 완전성 평가: 이상적 최소 길이 */
    COMPLETENESS_IDEAL_MIN: Number(process.env.EVAL_COMPLETENESS_IDEAL_MIN) || 100,
    /** 응답 완전성 평가: 경고 최대 길이 (초과 시 감점) */
    COMPLETENESS_WARN_MAX: Number(process.env.EVAL_COMPLETENESS_WARN_MAX) || 10000,
    /** 안전성 검사: 금지 패턴 목록 */
    SAFETY_BANNED_PATTERNS: [
        /\b\d{3}-\d{3,4}-\d{4}\b/,       // 전화번호
        /\b\d{6}-\d{7}\b/,                // 주민등록번호
        /\bpassword\s*[:=]\s*\S+/i,       // 비밀번호 노출
    ] as readonly RegExp[],
    /** 인용 감지 패턴 */
    CITATION_PATTERNS: [
        /\[\d+\]/,                         // [1], [2] 형식
        /출처\s*:/,                         // 한국어 출처
        /Source\s*:/i,                      // 영어 Source
    ] as readonly RegExp[],
    /** 코드 도메인 감지 패턴 (코드 관련 평가 활성화 여부) */
    CODE_DOMAIN_PATTERN: /```[\s\S]*?```/,
} as const;

// ============================================
// Trace Analyzer (에이전트 루프 실행 추적)
// ============================================

/**
 * AgentLoop 실행 트레이스 수집 및 분석 설정
 *
 * Harness Engineering 원칙: Inform — 에이전트 실행 과정을 구조화하여 추적하고,
 * 병목 구간과 실패 패턴을 분석하여 시스템 최적화에 활용합니다.
 *
 * services/chat-strategies/trace-analyzer.ts에서 참조
 */
export const TRACE_ANALYZER = {
    /** Trace Analyzer 활성화 여부 */
    ENABLED: process.env.TRACE_ANALYZER_ENABLED !== 'false',
    /** 병목으로 간주할 평균 도구 실행 시간 임계값 (ms) */
    BOTTLENECK_THRESHOLD_MS: Number(process.env.TRACE_BOTTLENECK_MS) || 1500,
    /** 도구 인자 요약 최대 길이 */
    ARGS_SUMMARY_MAX_LENGTH: Number(process.env.TRACE_ARGS_SUMMARY_MAX) || 256,
    /** 높은 에러율 경고 임계값 (0.0~1.0) */
    HIGH_ERROR_RATE_THRESHOLD: parseFloat(process.env.TRACE_HIGH_ERROR_RATE || '0.5'),
    /** 트레이스 분석 결과를 metrics에 포함할지 여부 */
    INCLUDE_IN_METRICS: process.env.TRACE_INCLUDE_METRICS !== 'false',
} as const;

// ============================================
// Reasoning Sandwich (단계별 추론 레벨 최적화)
// ============================================

/**
 * Reasoning Sandwich 패턴: 계획/실행/검증 단계별 추론 레벨 분리
 *
 * Harness Engineering 원칙: Inform — 단계별로 적절한 추론 깊이를 할당하여
 * 토큰 비용을 절감하면서 성능을 향상시킵니다.
 *
 * LangChain 사례: 전체 xhigh(53.9%) vs Sandwich(63.6%)
 * https://blog.langchain.com/improving-deep-agents-with-harness-engineering/
 *
 * services/chat-strategies/thinking-strategy.ts에서 참조
 */
export const REASONING_SANDWICH = {
    /** Reasoning Sandwich 활성화 여부 */
    ENABLED: process.env.REASONING_SANDWICH_ENABLED !== 'false',
    /** 계획 단계 추론 레벨 (높은 추론으로 정확한 계획 수립) */
    PLAN_LEVEL: (process.env.REASONING_PLAN_LEVEL || 'high') as 'low' | 'medium' | 'high',
    /** 실행 단계 추론 레벨 (중간 추론으로 비용 절감) */
    EXEC_LEVEL: (process.env.REASONING_EXEC_LEVEL || 'medium') as 'low' | 'medium' | 'high',
    /** 검증 단계 추론 레벨 (높은 추론으로 정확한 검증) */
    VERIFY_LEVEL: (process.env.REASONING_VERIFY_LEVEL || 'high') as 'low' | 'medium' | 'high',
    /** 전체 단계 중 계획 단계 비율 (0.0~1.0, 처음 N% 단계) */
    PLAN_STEPS_RATIO: parseFloat(process.env.REASONING_PLAN_RATIO || '0.2'),
    /** 전체 단계 중 검증 단계 비율 (0.0~1.0, 마지막 N% 단계) */
    VERIFY_STEPS_RATIO: parseFloat(process.env.REASONING_VERIFY_RATIO || '0.1'),
} as const;

export const THINKING_LIMITS = {
    /** 최대 사고 단계 수 (초과 시 결론 강제) */
    MAX_STEPS: parseInt(process.env.THINKING_MAX_STEPS || '10', 10),
    /** 전체 사고 토큰 예산 (문자 수 기준, TOKEN_TO_CHAR_RATIO 적용) */
    MAX_THINK_CHARS: parseInt(process.env.THINKING_MAX_CHARS || '12000', 10),
    /** 단계별 최소 콘텐츠 길이 (미달 시 조기 종료) */
    MIN_STEP_CONTENT_CHARS: 50,
    /** 예산 소진율 임계값 — 이 비율 초과 시 결론 강제 (0.0~1.0) */
    FORCE_CONCLUSION_AT: 0.8,
    /** 결론-과정 일관성 검증 활성화 (소형 모델 사용, opt-in) */
    VERIFY_CONCLUSION: process.env.THINKING_VERIFY_CONCLUSION === 'true',
    /** 검증용 소형 모델 */
    VERIFIER_MODEL: process.env.THINKING_VERIFIER_MODEL || 'phi3:mini',
    /** 검증 최대 토큰 */
    VERIFIER_MAX_TOKENS: 200,
    /** 예산 경고 임계값 — 잔여 비율이 이 값 미만이면 "핵심 집중" 안내 (0.0~1.0) */
    WARNING_THRESHOLD: parseFloat(process.env.THINKING_WARNING_THRESHOLD || '0.5'),
    /** 예산 위기 임계값 — 잔여 비율이 이 값 미만이면 "결론 강제" 안내 (0.0~1.0) */
    CRITICAL_THRESHOLD: parseFloat(process.env.THINKING_CRITICAL_THRESHOLD || '0.2'),
    /** 폴백 시 최소 보장 턴 수 (ThinkingStrategy 실패 → AgentLoop 폴백 시 최소 이만큼 보장) */
    FALLBACK_MIN_TURNS: parseInt(process.env.THINKING_FALLBACK_MIN_TURNS || '2', 10),
} as const;

// ============================================
// Loop Detection (Doom Loop 방지)
// ============================================

/**
 * AgentLoop에서 동일 도구 반복 호출(Doom Loop) 감지 설정
 *
 * Harness Engineering 원칙: Correct — 에이전트가 같은 실수를 반복할 때
 * 접근법 변경을 유도하고, 최종적으로 루프를 강제 종료합니다.
 *
 * LangChain LoopDetectionMiddleware 참고:
 * https://blog.langchain.com/improving-deep-agents-with-harness-engineering/
 *
 * services/chat-strategies/agent-loop-strategy.ts에서 참조
 */
export const LOOP_DETECTION = {
    /** 동일 도구+인자 반복 감지 임계값 (이 횟수 도달 시 경고 메시지 주입) */
    SAME_CALL_WARN_AT: Number(process.env.LOOP_SAME_CALL_WARN) || 3,
    /** 동일 도구+인자 반복 시 루프 강제 종료 임계값 */
    SAME_CALL_BREAK_AT: Number(process.env.LOOP_SAME_CALL_BREAK) || 5,
    /** 동일 에러 메시지 반복 감지 임계값 (이 횟수 도달 시 경고 메시지 주입) */
    SAME_ERROR_WARN_AT: Number(process.env.LOOP_SAME_ERROR_WARN) || 3,
    /** 동일 에러 반복 시 루프 강제 종료 임계값 */
    SAME_ERROR_BREAK_AT: Number(process.env.LOOP_SAME_ERROR_BREAK) || 5,
    /** 루프 추적 윈도우 크기 (최근 N개의 호출만 추적) */
    TRACKING_WINDOW: 10,
    /** 도구 인자 해시 시 사용할 최대 문자열 길이 (성능 보호) */
    ARGS_HASH_MAX_LENGTH: 500,
} as const;

// ============================================
// PreCompletion Checklist (종료 전 검증)
// ============================================

/**
 * AgentLoop 종료 직전 셀프 검증 체크리스트 설정
 *
 * Harness Engineering 원칙: Verify — 에이전트가 응답을 완료하기 전에
 * 스스로 체크리스트를 수행하여 1차 해결률을 극대화합니다.
 *
 * LangChain PreCompletionChecklistMiddleware 참고:
 * https://blog.langchain.com/improving-deep-agents-with-harness-engineering/
 *
 * services/chat-strategies/agent-loop-strategy.ts에서 참조
 */
export const PRE_COMPLETION_CHECKLIST = {
    /** 체크리스트 활성화 여부 (환경변수로 제어) */
    ENABLED: process.env.ENABLE_PRE_COMPLETION_CHECKLIST !== 'false',
    /** 체크리스트 실패 시 수정 재시도 최대 횟수 */
    MAX_RETRY: 1,
    /** 체크리스트를 스킵할 최소 응답 길이 (짧은 인사/단답은 스킵) */
    MIN_RESPONSE_LENGTH: parseInt(process.env.CHECKLIST_MIN_LENGTH || '100', 10),
    /** 체크리스트 검증 LLM 최대 토큰 */
    MAX_TOKENS: 500,
    /** 체크리스트를 적용할 queryType 목록 (빈 배열이면 모든 타입에 적용) */
    APPLICABLE_QUERY_TYPES: [] as readonly string[],
    /** 코드 도메인 감지용 정규식 패턴 */
    CODE_DOMAIN_PATTERN: /```|코드|code|function\s|class\s|import\s|const\s|let\s|var\s|def\s|async\s/i,
} as const;

export const GV_METRICS = {
    /** 품질 측정 활성화 여부 (환경변수로 제어) */
    ENABLED: process.env.OMK_GV_METRICS_ENABLED !== 'false',
    /** 유의미한 수정으로 판단할 최소 변경 비율 (0.0~1.0) */
    SIGNIFICANT_CHANGE_RATIO: 0.1,
} as const;

