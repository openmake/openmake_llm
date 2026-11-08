/**
 * 런타임 제한값 — 컨텍스트·토큰 예산, 절단, 외부 provider 스로틀, 라우팅·언어 판정, 캐시·재시도·비밀번호 정책.
 * 첨부·문서 처리는 runtime-limits-attach, 웹검색 주입은 runtime-limits-search 에 있다.
 * 공개 진입점은 config/runtime-limits(이 파일을 re-export) — 소비처는 그쪽에서 import 한다.
 *
 * @module config/runtime-limits-context
 */

// ============================================
// Deep Research 스크랩 안전마진
// ============================================

/** Deep Research 스크랩 abort 안전마진 (scrapeTimeoutMs 에 더함, ms) */
export const SCRAPE_ABORT_BUFFER_MS = parseInt(process.env.SCRAPE_ABORT_BUFFER_MS || '1000', 10);

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
    /**
     * 메시지 수가 적어도 누적 토큰이 이 값을 넘으면 요약 트리거 (거대 메시지 소수 대응).
     * 개수 기준만으로는 긴 코드/문서 붙여넣기 2~3개를 놓침 — 토큰 기준 OR 조건.
     */
    MIN_TOKENS_TO_SUMMARIZE: Number(process.env.HISTORY_SUMMARIZE_MIN_TOKENS) || 24000,
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
// 콘텐츠 절단 (Truncation)
// ============================================

/**
 * API 응답, 로깅, 요약 시 텍스트를 자르는 최대 길이
 */
export const TRUNCATION = {
    /** choices 없는 LLM 응답 본문을 오류 메시지에 싣는 최대 길이 */
    MALFORMED_LLM_RESPONSE_DETAIL_MAX: 300,
    /** 웹 페이지 콘텐츠 추출 최대 길이 */
    WEB_CONTENT_MAX: 3000,
    /** 웹 검색 결과 스니펫 길이 */
    WEB_SNIPPET_MAX: 200,
    /** Deep Research 중간 요약 최대 길이 */
    RESEARCH_SUMMARY_MAX: 4000,
    /** 웹 스크래퍼 결과 콘텐츠 최대 길이 */
    SCRAPER_CONTENT_MAX: 1000,
    /** 웹 스크래퍼 URL 목록 최대 수 */
    SCRAPER_MAX_URLS: 50,
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
    /** 웹 검색 num_ctx 설정 (에이전트용 최소 64K 토큰) */
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
    /** Deep Research 서브토픽 최대 수 (분해 결과 상위 N개 — 구 RESEARCH_MAX_TOTAL_SOURCES 는 이름과 달리 이 용도였다, 2026-09-05 정정) */
    RESEARCH_MAX_SUBTOPICS: 15,
    /** 검색 결과 응답 미리보기 최대 항목 */
    SEARCH_RESULT_MAX_DISPLAY: 10,
    /** Admin 대화 내보내기 SQL LIMIT */
    ADMIN_EXPORT_LIMIT: 10000,
    /** 토큰→문자 변환 비율 (한국어 기준 보수적 추정) */
    TOKEN_TO_CHAR_RATIO: 3,
} as const;

// ============================================
// 모델 컨텍스트 윈도우 기본값
// ============================================

/**
 * 모델별 num_ctx, num_predict 기본값 (토큰 수)
 * config/model-presets.ts · discussion-strategy · orchestration-dispatch 에서 참조.
 *
 * 2026-09-18 정리: 참조가 0이던 EXTENDED_NUM_CTX(Kimi 시절)·LOW_NUM_CTX·LOW_NUM_PREDICT
 * (구 GPT-OSS 저사양 프리셋)를 제거했다.
 */
export const MODEL_CONTEXT_DEFAULTS = {
    /** 기본 num_ctx (일반 모델) */
    DEFAULT_NUM_CTX: 32768,
    /** 기본 num_predict (출력 최대 토큰) */
    DEFAULT_NUM_PREDICT: 8192,
} as const;

// ============================================
// 외부 provider 실행 스로틀
// ============================================

/**
 * 외부 provider 실행 클라이언트 스로틀 (llm/external-throttle) — 토론·딥리서치·역할 클라이언트가
 * 외부 BYOK 모델을 병렬 호출할 때 provider 별 동시 요청 수를 제한하고 429 를 지수 백오프로 재시도.
 * provider 별 동시성은 카탈로그 maxConcurrentRequests 가 우선, 없으면 DEFAULT_CONCURRENCY.
 */
export const EXTERNAL_PROVIDER_THROTTLE = {
    DEFAULT_CONCURRENCY: parseInt(process.env.EXTERNAL_PROVIDER_DEFAULT_CONCURRENCY || '3', 10),
    /** 429 재시도 횟수 (OpenAI SDK 자체 재시도와 별개 — SDK 는 짧은 백오프라 무료 키 분당 한도를 못 넘김) */
    RETRY_429_MAX: parseInt(process.env.EXTERNAL_PROVIDER_RETRY_429_MAX || '3', 10),
    /** 첫 백오프 ms (2^n 지수 + 지터, Retry-After 헤더가 있으면 그 값 우선) */
    RETRY_429_BASE_MS: parseInt(process.env.EXTERNAL_PROVIDER_RETRY_429_BASE_MS || '2000', 10),
    RETRY_429_MAX_MS: parseInt(process.env.EXTERNAL_PROVIDER_RETRY_429_MAX_MS || '20000', 10),
    /** 서버 Retry-After 헤더를 존중할 때의 별도 상한(폭주 방지) — 지수 상한(RETRY_429_MAX_MS)보다 크게 */
    RETRY_AFTER_HEADER_MAX_MS: parseInt(process.env.EXTERNAL_PROVIDER_RETRY_AFTER_HEADER_MAX_MS || '90000', 10),
    /**
     * 스로틀된 외부 클라이언트의 호출별 타임아웃 배수 — 딥리서치 chatWithAbortTimeout 이 적용.
     * 무료/개발 키 모델(glm-5.3-flash 등)은 추론이 길어 로컬 기준 120s 청크 타임아웃을 넘긴다
     * (2026-09-03 실측: 청크 6/6 전부 abort → 합성 중단).
     */
    TIMEOUT_MULTIPLIER: parseFloat(process.env.EXTERNAL_PROVIDER_TIMEOUT_MULTIPLIER || '3'),
    /** 배수를 곱할 기준 타임아웃 — 호출측이 넘긴 값이 유효하지 않을 때의 폴백 (LLM_TIMEOUT 과 동일 기본) */
    BASE_TIMEOUT_FALLBACK_MS: parseInt(process.env.LLM_TIMEOUT || '120000', 10),
    /**
     * 로컬 LLM(local-llm) 동시 요청 상한 — 0 이면 무제한(종전). 양수면 같은 세마포어로 슬롯만 잡는다(429 재시도 없음).
     * 적용 범위: 오케스트레이터 capability 호출(withProviderSlot)과 createClient 가 만드는 로컬 LLMClient(derive() 파생 포함 — 채팅 본 루프,
     * 에이전트 작업·서브에이전트 턴, 보조 호출)의 chat·generate 한 번 — 도구 실행·서브에이전트 동안은 슬롯을 놓는다(#1656).
     * `new LLMClient` 직접 생성은 거치지 않는다. 낮게 잡으면 채팅 스트림 중의 생각 요약·model-wait probe 도 슬롯을 기다린다.
     * 슬롯 대기 시간은 에이전트 턴의 무응답 감시·호출 상한에 넣지 않는다(대기를 모델 장애로 보지 않게).
     */
    LOCAL_CONCURRENCY: parseInt(process.env.LOCAL_LLM_MAX_CONCURRENT || '0', 10),
} as const;

// ============================================
// LLM 라우터·judge 증거·언어 감지 기본값
// ============================================

/**
 * LLM 라우터 신뢰도 기본값
 * agents/llm-router.ts에서 참조
 */
export const ROUTER_CONFIDENCE_FALLBACK = 0.85;

/**
 * goal judge 증거 창에서 제외할 도구 — 결과가 ANSWER(terminate) 나 계획 스냅샷(plan_*) 과 중복이라
 * 마지막 N개 창을 차지하면 실제 수행 증거가 밀려난다. (goal-judge.ts buildJudgeToolEvidence)
 */
export const JUDGE_EVIDENCE_EXCLUDED_TOOLS: ReadonlySet<string> = new Set(['terminate', 'plan_create', 'plan_update', 'plan_view']);

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
    /** 한국어-라틴 혼합 텍스트에서 한국어 우선 판정 임계값 */
    KOREAN_MID: 0.4,
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
 * CacheSystem 에서 참조 (2026-05-26 Phase B Phase 2-A: 분류 캐시 필드 제거)
 */
export const CACHE_CONFIG = {
    /**
     * 라우팅 캐시 TTL (ms) — 기본 24시간 (env: OMK_ROUTING_CACHE_TTL_MS).
     *
     * 응답 캐시(10분)와 달리 길게 잡는다: 캐시 대상이 "질문 → 담당 에이전트"
     * 매핑이라 시간이 지나도 상하지 않는다(에이전트 목록은 industry-agents.json
     * 정적 데이터). 반면 미스 1건의 비용은 LLM 라우팅 왕복(~2-3s + ~2.7k 토큰)이라
     * 비대칭적으로 비싸다.
     *
     * 실측 근거(2026-08-02): 60일 사용자 질문 779건의 정규화 후 중복률 27.2% 인데
     * 캐시 적중은 4% 였다 — 반복 질문이 종전 TTL(20분) 안에 다시 오지 않았을 뿐이다.
     * (같은 실측에서 구두점 제거 정규화는 중복률을 +0.7%p 만 올려 기각.)
     */
    ROUTING_CACHE_TTL_MS: parseInt(process.env.OMK_ROUTING_CACHE_TTL_MS || String(24 * 60 * 60 * 1000), 10),
    /** 라우팅 캐시 최대 항목 수 (env: OMK_ROUTING_CACHE_MAX_SIZE) — 엔트리가 작아(agentId·confidence·ts) 넉넉히 잡는다 */
    ROUTING_CACHE_MAX_SIZE: parseInt(process.env.OMK_ROUTING_CACHE_MAX_SIZE || '500', 10),
    /** 메모리 서비스 컨텍스트 캐시 TTL (ms) — 기본 5분 */
    MEMORY_CACHE_TTL_MS: 5 * 60 * 1000,
    /** 메모리 서비스 컨텍스트 캐시 최대 항목 수 */
    MEMORY_CACHE_MAX_SIZE: 200,
    /** 히스토리 요약 캐시 최대 항목 수 */
    HISTORY_SUMMARY_MAX_ENTRIES: parseInt(process.env.HISTORY_SUMMARY_MAX_ENTRIES || '500', 10),
    /** 히스토리 요약 캐시 TTL (ms) — 기본 30분 */
    HISTORY_SUMMARY_TTL_MS: parseInt(process.env.HISTORY_SUMMARY_TTL_MS || String(30 * 60_000), 10),
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
    /** 느린 쿼리 경고 임계값 (ms) — 초과 시 [Performance] warn 로그 */
    SLOW_QUERY_WARN_MS: parseInt(process.env.DB_SLOW_QUERY_WARN_MS || '1000', 10),
    /** 백오프 jitter 최대값 (ms) — thundering herd 완화 */
    JITTER_MAX_MS: parseInt(process.env.DB_RETRY_JITTER_MAX_MS || '100', 10),
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

