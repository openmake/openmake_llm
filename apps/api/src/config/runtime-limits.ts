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
        maxImageDescriptionTokens: parseInt(process.env.DISCUSSION_MAX_IMAGE_DESC_TOKENS || '500', 10),
    },
    /** 요약/보조 Discussion 컨텍스트 토큰 예산 */
    COMPACT: {
        maxTotalTokens: 8000,
        maxDocumentTokens: 3000,
        maxHistoryTokens: 2000,
        maxWebSearchTokens: 1500,
        maxMemoryTokens: 1000,
        maxImageDescriptionTokens: parseInt(process.env.DISCUSSION_MAX_IMAGE_DESC_TOKENS || '500', 10),
    },
} as const;

/** Discussion 결과 스트리밍 시 abort 체크 간격 (문자 N개마다) */
export const DISCUSSION_STREAM_ABORT_CHECK_INTERVAL = parseInt(process.env.DISCUSSION_ABORT_CHECK_INTERVAL || '100', 10);

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
    /** Deep Research 전체 소스 최대 수 */
    RESEARCH_MAX_TOTAL_SOURCES: 15,
    /** Deep Research 결과 상위 N개 (유틸) */
    RESEARCH_TOP_RESULTS: 20,
    /** 검색 결과 응답 미리보기 최대 항목 */
    SEARCH_RESULT_MAX_DISPLAY: 10,
    /** Admin 대화 내보내기 SQL LIMIT */
    ADMIN_EXPORT_LIMIT: 10000,
    /** 토큰→문자 변환 비율 (한국어 기준 보수적 추정) */
    TOKEN_TO_CHAR_RATIO: 3,
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
    /** 루프당 최대 스크래핑 수 (env: DEEP_RESEARCH_MAX_SCRAPE_PER_LOOP) */
    MAX_SCRAPE_PER_LOOP: parseInt(process.env.DEEP_RESEARCH_MAX_SCRAPE_PER_LOOP || '15', 10),
    /** 스크래핑 동시 배치 크기 (jsdom CPU 부하 제어) */
    SCRAPE_BATCH_SIZE: 3,
    /** 청크 크기 (소스 개수 기준) */
    CHUNK_SIZE: 6,
    /** 검색 fan-out 동시실행 수 (env: RESEARCH_SEARCH_CONCURRENCY) */
    SEARCH_CONCURRENCY: parseInt(process.env.RESEARCH_SEARCH_CONCURRENCY || '5', 10),
    /** 합성 병렬 동시실행 수 */
    SYNTHESIS_CONCURRENCY: 5,
    /** 전체 합성을 실행하기 위한 최소 콘텐츠 길이 (문자). 이 미만이면 경량 합성 */
    MIN_CONTENT_FOR_FULL_SYNTHESIS: 1000,
    /** 보고서 생성 진행률 추정용 예상 출력 글자 수 (라이브 관측 ~20K자 기준, progress 표시 전용) */
    REPORT_EXPECTED_CHARS: 20000,
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
    /** 최대 전체 소스 수 — 합성·보고서 입력 규모를 좌우(과다 시 보고서 생성 지연). env override 가능. */
    MAX_TOTAL_SOURCES: Number(process.env.DEEP_RESEARCH_MAX_TOTAL_SOURCES) || 50,
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

/**
 * Deep Research 인용 검증 (A3)
 *
 * 보고서 본문의 각 주장 문장이 유효한 소스 인덱스를 가리키는 인용 마커
 * (`[출처 N]` / `[Source N]` / `[N]`)를 동반하는지 **결정적(LLM 비용 0)**으로 측정.
 *
 * 측정 범위 = "인용 마커의 존재 + 소스 범위 유효성"뿐.
 * 인용된 소스가 실제로 주장을 뒷받침하는지(groundedness)는 **측정하지 않는다** (LLM-as-judge 영역, A3 범위 밖).
 *
 * services/deep-research/citation-verifier.ts 및 evaluation/citation-evaluator.ts 에서 공유.
 */
export const DEEP_RESEARCH_CITATION = {
    /** 목표 인용 커버리지 (0.0~1.0). 미달 시 경고/플래그 */
    TARGET_COVERAGE: parseFloat(process.env.DEEP_RESEARCH_CITATION_TARGET || '0.95'),
    /** 주장 문장으로 인정할 최소 길이 (헤더/불릿 스캐폴딩 잔여 제거용) */
    MIN_CLAIM_CHARS: 15,
    /** 보고서 step 에 기록할 미인용 문장 샘플 최대 개수 */
    MAX_UNCITED_SAMPLES: 10,
    /** enforce 모드: true 면 미달 시 메타 플래그(본문은 변형하지 않음). 기본 measure-only */
    ENFORCE: process.env.DEEP_RESEARCH_CITATION_ENFORCE === 'true',
    /** SECTION_HEADERS.references 외, 모델이 변형해 쓰는 참고자료 섹션 헤더 보조 목록 */
    EXTRA_REFERENCE_HEADERS: ['참고문헌', '주', '출처', '각주', 'Sources', 'Bibliography', 'Citations'],
} as const;

// ============================================
// 모델 컨텍스트 윈도우 기본값
// ============================================

/**
 * 모델별 num_ctx, num_predict 기본값 (토큰 수)
 * model-selector.ts, llm/types.ts MODEL_PRESETS에서 참조
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
    /** 평가 입력에 포함할 의견 발췌 최대 문자 수 */
    OPINION_EXCERPT_MAX_CHARS: parseInt(process.env.DISCUSSION_OPINION_EXCERPT_MAX_CHARS || '500', 10),
    /** Evaluator LLM 최대 토큰 */
    EVALUATOR_MAX_TOKENS: 300,
    /** 최소 일관성 점수 (미달 시 경고 플래그) */
    MIN_REQUIRED_SCORE: 0.6,
} as const;

/**
 * Discussion 팩트체크 (웹 검색 근거를 최종 합성 단계에 주입)
 * 토론 주제로 웹 검색 1회 → 결과를 synthesizeFinalAnswer 컨텍스트에 근거 자료로 첨부.
 * factChecked=true 는 "근거가 실제로 합성에 주입됨"을 의미한다 (검색 0건이면 false).
 */
export const DISCUSSION_FACTCHECK = {
    /** 팩트체크 활성화 여부 (kill-switch) */
    ENABLED: process.env.DISCUSSION_FACTCHECK_ENABLED !== 'false',
    /** 합성에 주입할 검색 결과 최대 건수 (performWebSearch 기본 30 — 15 초과 시 고볼륨 모드이므로 소량 명시 필수) */
    MAX_RESULTS: parseInt(process.env.DISCUSSION_FACTCHECK_MAX_RESULTS || '5', 10),
    /** 결과당 snippet 최대 문자 수 */
    SNIPPET_MAX_CHARS: parseInt(process.env.DISCUSSION_FACTCHECK_SNIPPET_MAX_CHARS || '300', 10),
} as const;

/**
 * Discussion 멀티에이전트 동시 실행 상한
 * 라운드 내 에이전트 의견 수집(parallelBatch)의 in-flight LLM 호출 수를 제한합니다.
 * maxAgents=0(무제한, 엔진 내 20 cap) 설정 시에도 동시 요청이 폭증하지 않도록 보호합니다.
 * 기본값 5는 현재 유효 상한(strategy maxAgents=5)과 동일 — 기존 동작 불변.
 *
 * agents/discussion-engine.ts에서 참조
 */
export const DISCUSSION_CONCURRENCY = {
    /** 라운드 내 동시 에이전트 LLM 호출 최대 수 */
    MAX_PARALLEL_AGENTS: parseInt(process.env.DISCUSSION_MAX_PARALLEL_AGENTS || '5', 10),
} as const;

/**
 * 채팅 파일 첨부 한도 (2026-06-12 전체 파일 타입 허용)
 * 이미지는 기존 images(vision) 경로, 텍스트 파일은 내용을 fileContext 로 LLM 에 주입.
 * 바이너리(텍스트 디코드 불가)는 파일명/형식 메타만 전달.
 *
 * sockets/ws-chat-handler.ts에서 참조
 */
export const FILE_ATTACH_LIMITS = {
    /** 메시지당 첨부 파일 최대 개수 */
    MAX_FILES: parseInt(process.env.FILE_ATTACH_MAX_FILES || '50', 10),
    /** 파일당 주입 텍스트 최대 글자 수 (초과분 절단) */
    MAX_CHARS_PER_FILE: parseInt(process.env.FILE_ATTACH_MAX_CHARS_PER_FILE || '2000000', 10),
    /** 전체 첨부 합산 주입 텍스트 최대 글자 수 (최종 컨텍스트 적합화는 LLMClient context-fit 안전망이 담당) */
    MAX_TOTAL_CHARS: parseInt(process.env.FILE_ATTACH_MAX_TOTAL_CHARS || '10000000', 10),
    /** 파일명 표시 최대 길이 (프롬프트 주입 시 절단) */
    MAX_NAME_LENGTH: 200,
    /** 메시지/작업당 첨부 이미지 최대 개수 (composer MAX_IMAGES 와 페어) */
    MAX_IMAGES: parseInt(process.env.FILE_ATTACH_MAX_IMAGES || '20', 10),
    /** 이미지 dataURL 최대 글자 수 (base64 는 원본의 4/3 — 기본 20M ≈ 15MB 이미지) */
    MAX_IMAGE_DATAURL_CHARS: parseInt(process.env.FILE_ATTACH_MAX_IMAGE_DATAURL_CHARS || '20000000', 10),
} as const;

/**
 * 문서 첨부 텍스트 추출 한도 (2026-06-24)
 * PDF 는 opendataloader-pdf(Java CLI, JVM spawn), 그 외 office 포맷(docx/xlsx/pptx/odt 등)은
 * officeparser(순수 Node) 로 base64 원본을 텍스트로 추출해 fileContext 채널에 주입한다.
 * JVM spawn 은 느리므로 PDF 는 별도 타임아웃을 둔다.
 *
 * services/chat-service/doc-extractor.ts 에서 참조
 */
export const DOC_EXTRACT_LIMITS = {
    /** 기능 on/off (기본 on — 'false' 명시 시에만 비활성) */
    ENABLED: process.env.DOC_EXTRACT_ENABLED !== 'false',
    /** 추출 입력 1개 최대 바이트 (base64 디코드 후 원본 크기). 초과 시 추출 생략 → 메타만 */
    MAX_BYTES_PER_FILE: parseInt(process.env.DOC_EXTRACT_MAX_BYTES_PER_FILE || String(30 * 1024 * 1024), 10),
    /** PDF(opendataloader, JVM) 추출 타임아웃 (ms) */
    PDF_TIMEOUT_MS: parseInt(process.env.DOC_EXTRACT_PDF_TIMEOUT_MS || '60000', 10),
    /** office(officeparser) 추출 타임아웃 (ms) */
    OFFICE_TIMEOUT_MS: parseInt(process.env.DOC_EXTRACT_OFFICE_TIMEOUT_MS || '30000', 10),
    /** opendataloader 로 처리할 확장자 (PDF 전용 — 고품질 레이아웃 인식) */
    PDF_EXTS: ['pdf'] as readonly string[],
    /** officeparser 로 처리할 확장자 */
    OFFICE_EXTS: ['docx', 'xlsx', 'pptx', 'odt', 'odp', 'ods', 'rtf'] as readonly string[],
    /** 스캔본 PDF OCR 폴백 on/off (기본 on — opendataloader 가 텍스트를 못 뽑으면 officeparser+tesseract 로 재시도) */
    OCR_ENABLED: process.env.DOC_EXTRACT_OCR_ENABLED !== 'false',
    /** opendataloader 추출 텍스트가 이 글자 수 미만이면 스캔본(이미지 PDF)으로 보고 OCR 폴백 */
    PDF_MIN_TEXT_CHARS: parseInt(process.env.DOC_EXTRACT_PDF_MIN_TEXT_CHARS || '16', 10),
    /** OCR(tesseract) 타임아웃 (ms) — 페이지 렌더+인식이 느리므로 길게 */
    OCR_TIMEOUT_MS: parseInt(process.env.DOC_EXTRACT_OCR_TIMEOUT_MS || '120000', 10),
    /** OCR 언어 (tesseract 코드, '+' 로 다중 — 기본 영어+한국어) */
    OCR_LANGS: process.env.DOC_EXTRACT_OCR_LANGS || 'eng+kor',
} as const;

/**
 * 채팅 메시지 내 URL 자동 분석 한도 (2026-06-13)
 * 사용자 메시지에서 URL 감지 시 LLM 호출 전 scrapePage 로 본문을 가져와
 * fileContext 채널로 주입한다 (결정적 사전 분석 — 환각 방지).
 * 실패/시간 초과 시 안내 문구만 주입하고 모델 tool loop(web_scrape)에 위임.
 *
 * sockets/ws-chat-handler.ts에서 참조
 */
export const URL_ANALYZE_LIMITS = {
    /** 기능 on/off (기본 on — 'false' 명시 시에만 비활성) */
    ENABLED: process.env.URL_ANALYZE_ENABLED !== 'false',
    /** 메시지당 분석할 URL 최대 개수 (초과분은 무시) */
    MAX_URLS: parseInt(process.env.URL_ANALYZE_MAX_URLS || '3', 10),
    /** URL당 주입 본문 최대 글자 수 (초과분 절단) */
    MAX_CHARS_PER_URL: parseInt(process.env.URL_ANALYZE_MAX_CHARS_PER_URL || '50000', 10),
    /** URL당 스크래핑 대기 상한 (ms) — 초과 시 해당 URL 은 실패 처리 (TTFB 보호) */
    TIMEOUT_MS: parseInt(process.env.URL_ANALYZE_TIMEOUT_MS || '8000', 10),
} as const;

/**
 * 세션 단위 첨부 컨텍스트 캐시 한도 (2026-06-13 멀티턴 재주입)
 * fileContext(첨부 파일 + URL 사전 분석)는 DB 미저장(transient)이므로,
 * 세션별 메모리 캐시로 후속 턴에 재주입해 근거 소실로 인한 환각 재발을 막는다.
 *
 * services/chat-service/attach-context.ts에서 참조
 */
export const ATTACH_CACHE_LIMITS = {
    /** 캐시 보관 시간 (ms) — 마지막 접근 기준 갱신 */
    TTL_MS: parseInt(process.env.ATTACH_CACHE_TTL_MS || '3600000', 10),
    /** 동시 보관 세션 수 (LRU 초과분 제거) */
    MAX_SESSIONS: parseInt(process.env.ATTACH_CACHE_MAX_SESSIONS || '500', 10),
    /** 세션당 누적 컨텍스트 최대 글자 수 (초과 시 오래된 블록부터 제거) */
    MAX_CHARS: parseInt(process.env.ATTACH_CACHE_MAX_CHARS || '400000', 10),
} as const;

/**
 * 채팅 웹검색 결과의 LLM 컨텍스트 주입 한도 (2026-06-25 TTFT 개선)
 * 검색은 다소스 수집(랭킹 풀)을 위해 넉넉히 하되, LLM 에 실제 주입하는 양은 캡한다.
 * 큰 검색 컨텍스트가 prompt prefill 을 키워 TTFT(첫 토큰)를 늘리는 것을 막는다 —
 * SearXNG·위키 디랭크로 상위 결과 품질이 좋아져 적은 수로도 정답을 유지한다.
 *
 * sockets/ws-chat-handler.ts 에서 참조
 */
/**
 * 주입 캡 env 파싱 — 음수·NaN(잘못된 값)은 기본값으로, 0 은 "무제한"(캡 미적용) sentinel.
 * 가드 없는 parseInt 는 0/NaN 시 snippet 을 전부 비워 grounding 을 무너뜨릴 수 있어 명시 정규화한다.
 */
function parseInjectLimit(raw: string | undefined, def: number): number {
    const n = parseInt(raw ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : def;
}

export const WEB_SEARCH_INJECTION = {
    /**
     * 검색 수집(랭킹 풀) 결과 수 — SearXNG·위키 디랭크 포함 넉넉히 수집한 뒤 MAX_RESULTS 로 주입 캡.
     * WS 채팅·구조화(/structured) 경로가 공유한다.
     */
    COLLECT_MAX_RESULTS: parseInjectLimit(process.env.WEB_SEARCH_COLLECT_MAX_RESULTS, 12),
    /**
     * LLM 컨텍스트에 주입할 상위 결과 수 (수집은 더 많이 하되 주입은 캡). 0 = 무제한.
     * 6 → 10: 시사 쿼리에서 정답 포함 결과가 랭킹 하위(예: namu.wiki 현직 인물)로 밀려
     * top-6 컷오프에 잘리던 그라운딩 누락을 줄인다(수집 풀 12 의 대부분 주입).
     */
    MAX_RESULTS: parseInjectLimit(process.env.WEB_SEARCH_INJECT_MAX_RESULTS, 10),
    /** 결과당 주입 snippet 최대 글자 수 (초과 절단). 0 = 무제한(절단 안 함). 300→500: 결정적 사실이 스니펫 뒤쪽에 있어도 포함되게. */
    MAX_SNIPPET_CHARS: parseInjectLimit(process.env.WEB_SEARCH_INJECT_MAX_SNIPPET, 500),
} as const;

/**
 * LLM 라우터 신뢰도 기본값
 * agents/llm-router.ts에서 참조
 */
export const ROUTER_CONFIDENCE_FALLBACK = 0.85;

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
 * System prompt 에 prepend 되는 사용자 컨텍스트(custom instructions + cross-conversation
 * memory) 토큰 예산. 매 턴 고정 비용이므로 무제한 누적 시 context 잠식 → cap 필수.
 */
export const USER_CONTEXT_LIMITS = {
    /** custom_instructions 블록 최대 토큰 (초과 시 head 보존 truncate) */
    MAX_CUSTOM_INSTRUCTIONS_TOKENS: Number(process.env.USER_CTX_MAX_CI_TOKENS) || 2000,
    /** cross-conversation memory 블록 전체 최대 토큰 (누적 budget) */
    MAX_MEMORY_TOKENS: Number(process.env.USER_CTX_MAX_MEMORY_TOKENS) || 2000,
} as const;

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

/** 도구 결과를 LLM 컨텍스트로 주입할 때 단일 결과 최대 문자 수 (외부 provider · agent task 공용). */
export const MAX_TOOL_RESULT_CHARS = parseInt(process.env.MAX_TOOL_RESULT_CHARS || '8000', 10);

/** Git-ingest 컨벤션 검사 시 LLM 입력 truncation 캡. */
export const CONVENTION_CHECK_LIMITS = {
    MANIFEST_YAML_MAX_CHARS: parseInt(process.env.CONVENTION_CHECK_YAML_MAX || '4000', 10),
    PROMPT_BODY_MAX_CHARS: parseInt(process.env.CONVENTION_CHECK_BODY_MAX || '8000', 10),
} as const;

/** 대화 조회 limit (conversation-sessions / conversation-messages). */
export const CONVERSATION_LIMITS = {
    /** getSession() 단일 세션 상세의 메시지 로드 상한 */
    SESSION_DETAIL_MESSAGES: parseInt(process.env.CONVERSATION_SESSION_DETAIL_MESSAGES || '500', 10),
    /** 세션 목록 기본 조회 수 (user/anon) */
    SESSION_LIST_DEFAULT: parseInt(process.env.CONVERSATION_SESSION_LIST_DEFAULT || '50', 10),
    /** getMessages() 기본 조회 수 */
    MESSAGES_DEFAULT: parseInt(process.env.CONVERSATION_MESSAGES_DEFAULT || '200', 10),
    /** getMessages() 최대 조회 상한(cap) */
    MESSAGES_MAX: parseInt(process.env.CONVERSATION_MESSAGES_MAX || '1000', 10),
    /** 목록 view 에서 세션당 로드할 최근 메시지 수 (대용량 사용자 메모리 spike 방지) */
    LIST_MESSAGES_PER_SESSION: parseInt(process.env.CONVERSATION_LIST_MESSAGES_PER_SESSION || '50', 10),
    /** getAllSessions() 전체 세션 목록 기본 조회 수 */
    SESSION_LIST_ALL_DEFAULT: parseInt(process.env.CONVERSATION_SESSION_LIST_ALL_DEFAULT || '100', 10),
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
    /**
     * 관련도(relevance) 내에서 쿼리 단어 매칭이 차지하는 비중 (나머지는 수집 순서).
     * 기존 relevance 는 수집 순서(index)뿐이라 쿼리와 무관한 문서가 상위를 점유했다.
     * 쿼리 단어가 제목/스니펫에 실제로 등장하는지를 주신호로 삼아 정답 문서를 끌어올린다.
     * env: SEARCH_TERM_RELEVANCE_WEIGHT. 기본 0.7.
     */
    TERM_RELEVANCE_WEIGHT: parseFloat(process.env.SEARCH_TERM_RELEVANCE_WEIGHT || '0.7'),
    /**
     * 시점 민감 쿼리(현직 인물·직책 등)에서 위키피디아 결과에 적용하는 디랭크 페널티.
     * 위키 srsearch 는 과거 인물/사건 문서(예: '윤석열 정부', '10·26 사건')를 상위 반환해
     * 최신 뉴스보다 위로 올라오는 문제가 있어, preferRecent 시 위키를 낮춰 최신 뉴스를 우선한다.
     */
    RECENCY_WIKI_PENALTY: Number(process.env.SEARCH_RECENCY_WIKI_PENALTY) || 0.5,
    /** 시점 민감 쿼리에서 뉴스 소스(News/Naver 뉴스)에 적용하는 가산점 (최신 사실 우선). */
    RECENCY_NEWS_BOOST: Number(process.env.SEARCH_RECENCY_NEWS_BOOST) || 0.3,
    /**
     * 도메인당 최대 결과 수 (소스 다양성 보호).
     * 단일 provider/도메인(예: news.google.com)이 결과를 도배해 다양성이 붕괴하는 것을 방지.
     * 0 이하면 비활성(무제한). env override: SEARCH_MAX_PER_DOMAIN. 기본 5.
     */
    MAX_PER_DOMAIN: Number(process.env.SEARCH_MAX_PER_DOMAIN) || 5,
    /**
     * 백과/레퍼런스 도메인 (사실성 보강 대상).
     * 랭킹은 수집 순서(relevance) 가중이 커서 백과가 뉴스 가십에 밀려 컷오프되는 문제가 있다.
     * 현직 인물·직책 같은 사실 질문에서 백과 본문(예: "제21대 대선 이재명 당선")이 LLM 입력에서
     * 누락되지 않도록, 최종 결과에 최소 MIN_REFERENCE_RESULTS 개를 보장 포함한다.
     */
    REFERENCE_DOMAINS: ['wikipedia.org', 'namu.wiki', 'britannica.com'] as readonly string[],
    /** 최종 결과에 보장 포함할 백과/레퍼런스 최소 개수. 0 이하면 비활성. env: SEARCH_MIN_REFERENCE. 기본 4. */
    MIN_REFERENCE_RESULTS: Number(process.env.SEARCH_MIN_REFERENCE ?? 4),
    /**
     * 시점 민감 쿼리(preferRecent)에서 RECENCY_PENALTY_DAYS 초과 소스에 combinedScore 레벨로
     * 직접 적용하는 강한 감산. scoreSearchResult 내부 recency(±0.1~0.2)는 RELIABILITY_WEIGHT(0.4)를
     * 곱하면 실효 ±0.04~0.08 로 미미해, 공식 도메인 부스트(+0.3)에 밀려 오래된 정부/공식 페이지가
     * 상위를 점유했다(예: '오늘 날씨' 질의에 수년 전 정부 브리핑). preferRecent 가 아니면 40%만 적용.
     * env: SEARCH_RECENCY_STALE_PENALTY. 기본 0.35.
     */
    RECENCY_STALE_PENALTY: Number(process.env.SEARCH_RECENCY_STALE_PENALTY) || 0.35,
    /**
     * 쿼리 단어가 제목·스니펫에 전혀 없는(termRelevance ≤ MIN_TERM_RELEVANCE) 무관 소스 감산.
     * 공식 도메인 부스트(reliability)가 관련성 0 인 소스를 상위로 올리는 것을 막는다
     * (예: '서울 날씨' 질의에 .go.kr 코로나 브리핑). env: SEARCH_IRRELEVANCE_PENALTY. 기본 0.3.
     */
    IRRELEVANCE_PENALTY: Number(process.env.SEARCH_IRRELEVANCE_PENALTY) || 0.3,
    /** 관련성 하한 — termRelevance 가 이 값 이하면 무관 소스로 간주(기본 0 = 쿼리 단어 전무). env: SEARCH_MIN_TERM_RELEVANCE. */
    MIN_TERM_RELEVANCE: Number(process.env.SEARCH_MIN_TERM_RELEVANCE ?? 0),
} as const;

// (CONTEXT_GC / EVAL_PIPELINE / TRACE_ANALYZER 상수는 2026-07-18 strategy 계층
//  폐기 2단계로 삭제 — 유일 소비자였던 chat-strategies 하네스 모듈과 함께 제거됨.)

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
    /** 스트리밍 버퍼 overflow 임계 (문자) — 초과 시 끝부분만 보존 */
    BUFFER_OVERFLOW_THRESHOLD: parseInt(process.env.THINKING_BUFFER_OVERFLOW_CHARS || '200', 10),
    /** 버퍼 overflow 시 보존할 끝부분 길이 (문자) */
    BUFFER_TRIM_SIZE: parseInt(process.env.THINKING_BUFFER_TRIM_CHARS || '50', 10),
    /** 결론 섹션 추출 최대 길이 (문자) */
    CONCLUSION_MAX_CHARS: parseInt(process.env.THINKING_CONCLUSION_MAX_CHARS || '500', 10),
    /** 추론 과정 추출 최대 길이 (문자) */
    REASONING_MAX_CHARS: parseInt(process.env.THINKING_REASONING_MAX_CHARS || '1500', 10),
} as const;

// ============================================
// Loop Detection (Doom Loop 방지)
// ============================================

/**
 * 도구 호출 루프에서 동일 도구 반복 호출(Doom Loop) 감지 설정
 *
 * Harness Engineering 원칙: Correct — 에이전트가 같은 실수를 반복할 때
 * 접근법 변경을 유도하고, 최종적으로 루프를 강제 종료합니다.
 *
 * LangChain LoopDetectionMiddleware 참고:
 * https://blog.langchain.com/improving-deep-agents-with-harness-engineering/
 *
 * services/chat-service/external-provider.ts에서 참조
 */
/** Agent 도구 호출 루프 최대 턴 수 — 단일 SoT. */
export const AGENT_LOOP_LIMITS = {
    /** external dispatch 도구 호출 루프 최대 턴 */
    MAX_TURNS: Number(process.env.AGENT_MAX_TURNS) || 5,
    /**
     * 루프 전체 wall-clock 예산 (ms). 턴 수와 별개로, 느린 도구가 매 턴 타임아웃
     * 직전까지 걸려 단일 요청이 MAX_TURNS × LLM_TIMEOUT 까지 늘어지는 것을 차단.
     * 초과 시 도구를 끄고 최종 응답을 유도. 0 이하 시 비활성.
     */
    MAX_WALL_CLOCK_MS: Number(process.env.AGENT_MAX_WALL_CLOCK_MS) || 180000,
} as const;

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

// (PRE_COMPLETION_CHECKLIST / CONFIDENCE_GATE / INFORMED_FALLBACK 상수는
//  2026-07-18 strategy 계층 폐기 2단계로 삭제 — 유일 소비자였던
//  agent-loop-strategy / strategy-executor 와 함께 제거됨.)

// ============================================
// Routing Post-hoc Verification (라우팅 사후 검증)
// ============================================

/**
 * 라우팅 결정의 적절성을 응답 완료 후 사후 검증하는 설정
 *
 * Harness Engineering 원칙: Verify — 라우팅 결정이 실제로 적절했는지
 * 응답 품질 신호(지연, 토큰 사용량, 에러)로 자동 판단
 *
 * chat/routing-verifier.ts에서 참조
 */
export const ROUTING_VERIFICATION = {
    /** 사후 검증 활성화 여부 */
    ENABLED: process.env.ROUTING_VERIFICATION_ENABLED !== 'false',
    /** 비정상 지연으로 판단할 임계값 (ms) */
    HIGH_LATENCY_THRESHOLD_MS: Number(process.env.ROUTING_HIGH_LATENCY_MS || '10000'),
    /** 토큰 예산 대비 초과 사용 비율 임계값 (1.0 = 예산과 동일) */
    TOKEN_OVERUSE_RATIO: parseFloat(process.env.ROUTING_TOKEN_OVERUSE_RATIO || '1.5'),
    /** 검증 결과를 구조화 로그에 포함할지 여부 */
    INCLUDE_IN_METRICS: process.env.ROUTING_VERIFICATION_INCLUDE_METRICS !== 'false',
} as const;

// (GV_METRICS 상수는 2026-07-18 strategy 계층 폐기 2단계로 삭제 —
//  유일 소비자였던 generate-verify-strategy 와 함께 제거됨.)

// ============================================
// 외부 LLM 도구 노출 정책
// ============================================

/**
 * 외부 LLM(Anthropic/OpenAI-compat) 경로에서 노출하지 않는 MCP 도구 목록.
 *
 * 본 도구들은 MCP 사양상 등록되어 있으나, 실제 처리는 로컬 LLM 경로의
 * AgentLoopStrategy 가 가로채서 LLMClient.chat(비전 모델) 으로 위임한다
 * (mcp/tools.ts visionOcrTool/analyzeImageTool 핸들러는 안내 문구만 반환하는 stub).
 *
 * 외부 LLM 경로(streamFromExternalProvider)에는 그런 가로채기 레이어가 없어
 * 호출 시 stub 응답만 받게 되므로 토큰 낭비 + 잘못된 답변을 유발한다.
 * 또한 GPT-4o/Claude/Gemini 등 외부 vision 모델은 native 멀티모달이라 별도 OCR 도구가 불필요하다.
 *
 * services/ChatService.ts streamFromExternalProvider 에서 참조한다.
 */
export const EXTERNAL_LLM_TOOL_BLACKLIST: readonly string[] = [
    'vision_ocr',
    'analyze_image',
] as const;

/**
 * 채팅에서 자동 활성화(설치=기본 ON)되는 사용자 MCP 풀 도구 수 상한.
 *
 * 사용자가 설치한 MCP 서버 도구는 명시 토글 없이 채팅 LLM 에 노출되나, 다수 서버를
 * 설치한 사용자의 경우 전체 도구 스키마가 과대해져 vLLM 첫 토큰 컴파일이 지연/hang
 * 되는 것을 막기 위해(과거 ~150 도구 786KB → 첫토큰 101s 사례) 노출 수를 제한한다.
 * 초과분은 drop 하고 로그로 알린다. picker 로 끈 도구는 cap 계산 전에 제외된다.
 */
export const CHAT_USER_MCP_TOOL_CAP = parseInt(
    process.env.CHAT_USER_MCP_TOOL_CAP || '12',
    10,
);

/**
 * 채팅 자동 노출 user MCP 도구의 누적 **스키마 바이트** 상한 (개수 cap 과 별개의 이중 상한).
 *
 * cap 은 도구 "개수"만 제한하므로, firecrawl 처럼 도구 1개의 파라미터 스키마가 거대한(수 KB)
 * 서버는 개수가 적어도 총 바이트로 로컬 qwen 의 vLLM 도구-grammar 컴파일 예산을 초과해
 * UPSTREAM_ERROR(첫 토큰 타임아웃)를 유발한다. 누적 스키마 바이트가 이 값을 넘으면 추가
 * 노출을 중단한다(단 최소 1개는 노출). 외부 provider 는 영향 적으므로 로컬 보호용 기본값.
 */
export const CHAT_USER_MCP_SCHEMA_BUDGET_BYTES = parseInt(
    process.env.CHAT_USER_MCP_SCHEMA_BUDGET_BYTES || '16000',
    10,
);

/**
 * MCP 진행적 공개(progressive disclosure) — mcp_list_tools / mcp_call 메타 도구를 채팅에
 * always-on 노출할지. ON 이면 다(多)서버 사용자가 cap 밖으로 밀린 서버 도구도 on-demand 로
 * 발견·호출 가능(함수 스키마 슬롯 1~2개만 사용). **기본 ON** — 라이브 E2E 검증 완료로 운영
 * 기본값 채택. 비활성화하려면 .env 에 `MCP_PROGRESSIVE_DISCLOSURE_ENABLED=false` (opt-out).
 */
export const MCP_PROGRESSIVE_DISCLOSURE_ENABLED =
    process.env.MCP_PROGRESSIVE_DISCLOSURE_ENABLED !== 'false';

/**
 * 외부 provider 도구 루프 messages 토큰 예산 — external-provider 경로는 LLMClient.chat 의
 * model-pool context-fit 안전망을 우회(provider.streamChat 직접 호출)하므로, 큰 누적
 * 컨텍스트가 그대로 provider 로 전달돼 모델이 텍스트 없이 도구만 호출하고 끝나는 빈 응답을
 * 유발한다. 이 예산을 넘으면 system 보존 + 최근 메시지 우선으로 truncate 한다.
 * (262K 모델 기준 안전 마진. env 로 조정 가능.)
 */
export const EXTERNAL_LLM_INPUT_TOKEN_BUDGET = parseInt(
    process.env.EXTERNAL_LLM_INPUT_TOKEN_BUDGET || '220000',
    10,
);

/**
 * 명시적 아티팩트 생성 요청 턴에서 억제할 always-on 도구.
 *
 * 측정 근거 (2026-06-23 통제실험): "아티팩트로 html5 ... 작성해" 요청에서 qwen3.6 이
 * `<artifact>` 산출물을 쓰는 대신 always-on 도구(generate_image / agent_task_list /
 * agent_task_get)를 간헐 호출(~33%)해 아티팩트 생성이 실패(빈 응답). 동일 프롬프트로
 * 도구를 제거하면 3/3 정상 생성됨. artifact-guide 시스템 프롬프트(주입돼 있음)로는 막지
 * 못함 → 도구 레벨 조정. 이 도구들은 아티팩트 "생성"에 불필요하므로 명시적 아티팩트
 * 요청 턴에서만 제외한다(이미지/에이전트 작업 조회 등 비-아티팩트 요청은 무영향).
 *
 * 값은 mcp/agent-task-tools.ts CHAT_ALWAYS_ON_TOOL_NAMES 와 일치 — always-on 으로
 * 무조건 주입되는 도구들이 곧 distractor 이기 때문.
 */
export const ARTIFACT_REQUEST_SUPPRESSED_TOOLS: readonly string[] = [
    'generate_image',
    'agent_task_list',
    'agent_task_get',
    'extract_webpage',
] as const;

/** 사용자 메시지가 명시적 아티팩트 생성 요청인지 판정하는 키워드 패턴. */
export const ARTIFACT_INTENT_PATTERNS: readonly RegExp[] = [
    /아티팩트/i,
    /\bartifact\b/i,
    // 실사용 문구 보강 (2026-07-17): "html로 작성해서 보여줘"류가 매칭 안 돼 generate_image
    // (distractor)가 남아 모델이 이미지 생성으로 이탈 — 60초 낭비 + 아티팩트 미생성.
    // 동사 결합형만 매칭해 "html에서 추출해줘"(extract_webpage 필요) 같은 문장은 제외.
    /html\s*(파일|문서|보고서|페이지)?\s*(로|으로)?[^\n.?!]{0,10}(작성|만들|생성|정리|변환|보여)/i,
    /웹\s?페이지(로|를)?\s*(만들|작성|생성|정리)/,
] as const;

/**
 * 위치/지도 의도 판정 패턴. 매칭 시 generate_image(distractor)를 도구 목록에서 제외해
 * 모델이 "지도"를 보고 가짜 지도 이미지를 그리는 대신, 카카오 검색 도구 + 네이티브 지도
 * 블록(```kakaomap)을 쓰도록 유도한다.
 */
export const MAP_INTENT_PATTERNS: readonly RegExp[] = [
    /지도/,
    /길\s*찾기/,
    /좌표/,
    /위치/,
    /근처/,
    /어디\b/,
] as const;

/**
 * 명시적 웹 검색 요청 패턴 — 매칭 + web_search 도구 제공 시 첫 턴 tool_choice 로 web_search
 * 를 강제한다. 봇 히스토리에 남은 "검색 불가/오프라인" 자기 발언이 재주입되면 qwen 이 시스템
 * 지시로도 교정되지 않고 도구 호출 자체를 거부하는 환각(2026-07-17 Discord 사례) 의 결정적
 * 차단 장치. (카카오 지도 tool_choice 강제와 동일 선례 — 넛지·프롬프트만으론 불충분)
 */
export const WEB_SEARCH_INTENT_PATTERNS: readonly RegExp[] = [
    /(인터넷|웹|온라인)[^\n]{0,10}(검색|검샏|찾아)/,
    /검색(해\s*서|해\s*줘|해\s*봐|으로|해서|해줘|해봐)/,
    /(최신|오늘|지금|현재)[^\n]{0,12}(뉴스|날씨|시세|가격|환율)[^\n]{0,10}(알려|찾아|검색|조사)/,
    /web\s*search|search\s+(the\s+)?(web|internet|online)/i,
] as const;

/**
 * 길찾기(경로) 의도 판정 패턴. 매칭 시 카카오 find-route 도구를 강제 포함·호출해
 * 출발/도착 마커 + 경로를 지도에 표시한다. (MAP_INTENT 의 부분집합 — 경로 전용)
 */
export const ROUTE_INTENT_PATTERNS: readonly RegExp[] = [
    /길\s*찾기/,
    /경로/,
    /가는\s*(길|법|방법)/,
    /어떻게\s*가/,
    /까지\s*(가|어떻게|경로|길)/,
] as const;

/**
 * 자율 에이전트 작업 (AgentTaskService) runaway 가드 한계.
 * 백그라운드 detached 실행이라 사람이 지켜보지 않으므로 토큰/시간 폭주 방지가 필수.
 */
export const AGENT_TASK_LIMITS = {
    /** 사용자 지정 max_turns 의 절대 상한 */
    MAX_TURNS_CEILING: 20,
    /** 기본 최대 턴 수 */
    DEFAULT_MAX_TURNS: 10,
    /** 작업 전체 타임아웃 (ms) — AGENT_TASK_TIMEOUT_MS 환경변수로 오버라이드.
     *  기본 10분: HTML/디자인 등 장문 deliverable 생성은 단일 LLM 호출이 수 분 걸릴 수 있음. */
    TOTAL_TIMEOUT_MS: parseInt(process.env.AGENT_TASK_TIMEOUT_MS || '', 10) || 10 * 60 * 1000,
    /** 누적 토큰 상한 (input + output) — runaway 토큰 폭주 방지. AGENT_MAX_TOTAL_TOKENS 로 오버라이드.
     *  멀티턴 도구 작업은 매 턴 prompt_tokens(전체 컨텍스트)를 누적 카운트하므로 200k 는
     *  3턴 만에 소진됐다(샌드박스 도구 작업이 terminate 전에 실패). 기본 1M 으로 상향. */
    MAX_TOTAL_TOKENS: parseInt(process.env.AGENT_MAX_TOTAL_TOKENS || '', 10) || 1_000_000,
    /** 검색류 도구 호출 횟수 하드 상한 — 초과 시 다음 턴부터 검색 도구를 제거해 강제 종합.
     *  AGENT_MAX_SEARCH_CALLS 환경변수로 오버라이드 가능 (기본 5). */
    MAX_SEARCH_CALLS: parseInt(process.env.AGENT_MAX_SEARCH_CALLS || '5', 10),
    /** 검색/정보수집 도구 식별 키워드 (tool name 에 포함되면 검색류로 카운트) */
    SEARCH_TOOL_KEYWORDS: ['search', 'visit_page', 'research', 'firecrawl', 'scrape', 'crawl', 'fetch'] as readonly string[],
    /** 샌드박스 browser 도구 호출 횟수 하드 상한 — browser 는 SEARCH_TOOL_KEYWORDS 에 안 잡혀
     *  검색 throttle 로 제어되지 않으므로 별도 cap. 초과 시 다음 턴부터 browser 도구를 제거해
     *  강제 종합. 탐색·추출이 여러 호출로 나뉘므로 검색보다 넉넉히(기본 10).
     *  AGENT_MAX_BROWSER_CALLS 로 오버라이드. */
    MAX_BROWSER_CALLS: parseInt(process.env.AGENT_MAX_BROWSER_CALLS || '10', 10),
    /** stuck 감지 — 동일 assistant 응답이 이 횟수만큼 연속되면 전략변경 프롬프트 주입(무한루프 방지).
     *  OpenManus BaseAgent.is_stuck 패턴. AGENT_STUCK_THRESHOLD 로 오버라이드(기본 3). */
    STUCK_THRESHOLD: parseInt(process.env.AGENT_STUCK_THRESHOLD || '3', 10),
    /** 목표 달성 judge — 아티팩트 없는 최종 답변 완료 시 판정 전용 LLM 1회 호출로 목표 달성
     *  여부를 검증(마커 미준수 보완). 미달성 판정 시 completed 대신 failed(goal_incomplete).
     *  판정 실패/파싱 불가는 fail-open(완료 유지). AGENT_TASK_GOAL_JUDGE=false 로 비활성. */
    GOAL_JUDGE_ENABLED: process.env.AGENT_TASK_GOAL_JUDGE !== 'false',
    /** judge 에 넘기는 최종 답변 최대 글자 수 (프롬프트 팽창 방지) */
    GOAL_JUDGE_MAX_ANSWER_CHARS: parseInt(process.env.AGENT_TASK_GOAL_JUDGE_MAX_CHARS || '6000', 10),
    /** 부팅 자동 복구 — 프로세스 재시작으로 중단된 task 를 부팅 시 자동 resume 한다.
     *  주의: schema-initializer 가 부팅 시 running/paused 를 failed('server restarted') 로 먼저
     *  마킹하므로, 복구 대상은 ①잔존 running/paused(마킹 실패 대비) + ②restart 마킹 + checkpoint
     *  보유 + 최근 window 내 task. checkpoint 없으면 failed 유지(기존 수동 UX 그대로).
     *  AGENT_TASK_BOOT_RECOVERY=false 로 비활성(기본 on). */
    BOOT_RECOVERY_ENABLED: process.env.AGENT_TASK_BOOT_RECOVERY !== 'false',
    /** 부팅 복구 인정 window(ms) — '이번 재시작'으로 마킹된 task 만 자동 resume 하고, 과거
     *  재시작이 남긴 오래된 failed('server restarted') 는 건드리지 않는다(수동 resume 대상).
     *  AGENT_TASK_BOOT_RECOVERY_WINDOW_MS 로 오버라이드(기본 15분). */
    BOOT_RECOVERY_WINDOW_MS: parseInt(process.env.AGENT_TASK_BOOT_RECOVERY_WINDOW_MS || '', 10) || 15 * 60_000,
    /** 동적 도구 서브셋팅(Phase 2-A) — 샌드박스 활성 시 목표 관련성 top-K MCP 도구를 예산 내에서
     *  샌드박스 도구에 합류(호스트 실행 + HITL 승인 게이트). 전체 카탈로그(~150)를 넘기면 vLLM
     *  문법 컴파일이 폭주하므로 예산으로 캡한다. ⚠️ 기본 OFF — 활성화 전 문법 컴파일 지연 실측 필수.
     *  AGENT_TASK_DYNAMIC_TOOLS=true 로 활성. */
    DYNAMIC_TOOLS_ENABLED: process.env.AGENT_TASK_DYNAMIC_TOOLS === 'true',
    /** 동적 도구 포함 시 LLM 에 노출하는 총 도구 수 상한(샌드박스+extra+동적). 보수적 기본(30) —
     *  실측 후 상향. AGENT_TASK_DYNAMIC_TOOLS_BUDGET 로 오버라이드. */
    DYNAMIC_TOOLS_BUDGET: parseInt(process.env.AGENT_TASK_DYNAMIC_TOOLS_BUDGET || '30', 10),
    /** 산출물 실행 검증(Phase 2-B) — 샌드박스 활성 시 코드 deliverable 을 완료 전 문법/컴파일
     *  검사(py_compile·node --check, 코드 미실행). 실패 시 오류 리포트를 주입해 1회 자가수정 유도.
     *  AGENT_TASK_VERIFY_DELIVERABLE=false 로 비활성(기본 on, 단 샌드박스 활성 시에만 동작). */
    VERIFY_DELIVERABLE_ENABLED: process.env.AGENT_TASK_VERIFY_DELIVERABLE !== 'false',
    /** 산출물 검증 실패 시 자가수정 재시도 최대 횟수 — 초과하면 검증을 건너뛰고 완료(무한루프 방지). */
    VERIFY_DELIVERABLE_MAX_RETRIES: parseInt(process.env.AGENT_TASK_VERIFY_DELIVERABLE_MAX_RETRIES || '1', 10),
    /** 동시성 큐(Phase 3-B) — /execute·resume·부팅복구가 즉시 발사 대신 큐에 제출. 전역·유저별
     *  동시 실행 상한을 넘으면 'queued' 로 대기, 슬롯이 비면 dequeue. 기본 OFF(켜면 즉시발사→큐).
     *  ⚠️ 단일 프로세스 전제(API instances:1). 멀티프로세스 확장 시 Redis 백엔드 필요. */
    QUEUE_ENABLED: process.env.AGENT_TASK_QUEUE_ENABLED === 'true',
    /** 전역 동시 실행 상한. AGENT_TASK_QUEUE_GLOBAL_MAX 로 오버라이드(기본 4). */
    QUEUE_GLOBAL_MAX: parseInt(process.env.AGENT_TASK_QUEUE_GLOBAL_MAX || '4', 10),
    /** 유저별 동시 실행 상한. AGENT_TASK_QUEUE_USER_MAX 로 오버라이드(기본 2). */
    QUEUE_USER_MAX: parseInt(process.env.AGENT_TASK_QUEUE_USER_MAX || '2', 10),
    /** 스케줄/반복 트리거(Phase 3-A) — cron/interval 로 task 를 반복 실행. 기본 OFF.
     *  AGENT_TASK_SCHEDULES_ENABLED=true 로 활성. 스케줄러 tick 이 due 스케줄을 큐에 제출. */
    SCHEDULES_ENABLED: process.env.AGENT_TASK_SCHEDULES_ENABLED === 'true',
    /** 스케줄러 tick 주기(ms) — due 스케줄 스캔 간격. AGENT_TASK_SCHEDULE_TICK_MS(기본 60초). */
    SCHEDULE_TICK_MS: parseInt(process.env.AGENT_TASK_SCHEDULE_TICK_MS || '', 10) || 60_000,
    /** 유저당 최대 스케줄 수. AGENT_TASK_SCHEDULE_MAX_PER_USER(기본 10). */
    SCHEDULE_MAX_PER_USER: parseInt(process.env.AGENT_TASK_SCHEDULE_MAX_PER_USER || '10', 10),
    /** interval 스케줄 최소 간격(초) — 남용 방지. AGENT_TASK_SCHEDULE_MIN_INTERVAL_SEC(기본 300). */
    SCHEDULE_MIN_INTERVAL_SEC: parseInt(process.env.AGENT_TASK_SCHEDULE_MIN_INTERVAL_SEC || '300', 10),
    /** 연속 실패 이 횟수 도달 시 스케줄 자동 비활성(폭주 차단). AGENT_TASK_SCHEDULE_DISABLE_AFTER_FAILURES(기본 5). */
    SCHEDULE_DISABLE_AFTER_FAILURES: parseInt(process.env.AGENT_TASK_SCHEDULE_DISABLE_AFTER_FAILURES || '5', 10),
    /** 크로스-task 학습(Phase 5-2) — 유저 과거 유사 작업의 결과·도구·실패사유를 새 task system 에
     *  주입(같은 실수 반복 방지). 무-LLM(키워드 유사도)·기존 테이블 파생. 기본 OFF.
     *  AGENT_TASK_LEARNING_ENABLED=true 로 활성. */
    LEARNING_ENABLED: process.env.AGENT_TASK_LEARNING_ENABLED === 'true',
    /** 학습 조회 대상 — 유저 최근 terminal task 수(기본 30). */
    LEARNING_LOOKBACK: parseInt(process.env.AGENT_TASK_LEARNING_LOOKBACK || '30', 10),
    /** 주입할 교훈 최대 건수(기본 3). */
    LEARNING_MAX_LESSONS: parseInt(process.env.AGENT_TASK_LEARNING_MAX_LESSONS || '3', 10),
    /** goal 유사도(자카드) 임계 — 미만은 무관 작업으로 간주(기본 0.2). */
    LEARNING_MIN_SIMILARITY: parseFloat(process.env.AGENT_TASK_LEARNING_MIN_SIMILARITY || '0.2'),
    /** 산출물 검증 모드(Phase 5-3): 'syntax'(기본 — py_compile·node --check) | 'run'(샌드박스에서
     *  실제 실행 후 exit code 검사 — network none·자원캡 격리라 안전하나 부작용 있는 코드는 실행됨). */
    VERIFY_MODE: (process.env.AGENT_TASK_VERIFY_MODE === 'run' ? 'run' : 'syntax') as 'syntax' | 'run',
    /** 서브에이전트 위임(Phase 5-1) — delegate 를 1-shot 자문에서 depth=1 미니 tool-loop 로 승격.
     *  기본 OFF(기존 1-shot 유지). AGENT_TASK_SUBAGENT_ENABLED=true 로 활성. */
    SUBAGENT_ENABLED: process.env.AGENT_TASK_SUBAGENT_ENABLED === 'true',
    /** 서브에이전트 턴 상한(작게 — 재귀·폭주 방지, 기본 3). */
    SUBAGENT_MAX_TURNS: parseInt(process.env.AGENT_TASK_SUBAGENT_MAX_TURNS || '3', 10),
    /** 서브에이전트 1회 위임당 토큰 상한 — 부모 누적에 합산되어 부모 한도도 함께 적용(기본 100k). */
    SUBAGENT_MAX_TOKENS: parseInt(process.env.AGENT_TASK_SUBAGENT_MAX_TOKENS || '100000', 10),
    /** 동적 도구 선별 방식(Phase 5-4): 'keyword'(기본 — 무-LLM 오버랩) | 'embedding'(bge-m3 코사인,
     *  어휘가 달라도 의미 매칭. 실패 시 키워드 폴백). AGENT_TASK_DYNAMIC_TOOLS_MODE. */
    DYNAMIC_TOOLS_MODE: (process.env.AGENT_TASK_DYNAMIC_TOOLS_MODE === 'embedding' ? 'embedding' : 'keyword') as 'keyword' | 'embedding',
    /** 임베딩 모드 유사도 임계 — 미만은 예산이 남아도 제외(무관 도구 미주입, 기본 0.35). */
    DYNAMIC_TOOLS_EMBED_MIN_SIM: parseFloat(process.env.AGENT_TASK_DYNAMIC_TOOLS_EMBED_MIN_SIM || '0.35'),
    /** 임베딩 선별 전체 타임아웃(ms) — 초과 시 키워드 폴백(기본 3000). */
    DYNAMIC_TOOLS_EMBED_TIMEOUT_MS: parseInt(process.env.AGENT_TASK_DYNAMIC_TOOLS_EMBED_TIMEOUT_MS || '3000', 10),
    /** 턴 중간 체크포인트(Phase 6-4) — 도구 결과 단위로도 checkpoint 저장. 재시작이 턴 중간에
     *  일어나도 이미 실행된 도구를 재실행하지 않고 재개한다(write 도구 재실행 방지 강화).
     *  대화가 크면 도구 호출마다 DB 쓰기가 늘어나므로 기본 OFF(opt-in).
     *  AGENT_TASK_MIDTURN_CHECKPOINT=true 로 활성. */
    MIDTURN_CHECKPOINT_ENABLED: process.env.AGENT_TASK_MIDTURN_CHECKPOINT === 'true',
} as const;

/** 채팅 서브에이전트(delegate_expert) — 채팅 도구 루프에서 전문가 위임(depth=1 tool-loop). */
export const CHAT_SUBAGENT = {
    /** 기본 OFF — 지연(위임 1회 = 서브 LLM 최대 3턴) UX 영향을 관찰 후 조정. CHAT_SUBAGENT_ENABLED=true. */
    ENABLED: process.env.CHAT_SUBAGENT_ENABLED === 'true',
    /** 메시지당 위임 호출 캡(남용·지연 억제, 기본 1). CHAT_SUBAGENT_MAX_CALLS. */
    MAX_CALLS: parseInt(process.env.CHAT_SUBAGENT_MAX_CALLS || '1', 10),
} as const;

/** 병렬 서브에이전트 fan-out(spawn_agents) — 하위 작업 N 개를 병렬 위임하는 범용 오케스트레이션.
 *  채팅·에이전트 작업 양 경로 공용 (services/agent-spawn). depth=1 — 서브가 재위임 불가. */
export const AGENT_SPAWN = {
    /** 기본 OFF — GPU 처리량 분할·지연 영향을 벤치 후 운영 활성화(사용자). AGENT_SPAWN_ENABLED=true. */
    ENABLED: process.env.AGENT_SPAWN_ENABLED === 'true',
    /** 동시 실행 서브에이전트 수(기본 2) — vLLM 동시성 벤치 결과로 조정. AGENT_SPAWN_MAX_PARALLEL. */
    MAX_PARALLEL: parseInt(process.env.AGENT_SPAWN_MAX_PARALLEL || '2', 10),
    /** 1회 호출당 태스크 상한(기본 4) — 초과분은 잘라내고 결과에 명시(silent cap 금지). AGENT_SPAWN_MAX_TASKS. */
    MAX_TASKS_PER_CALL: parseInt(process.env.AGENT_SPAWN_MAX_TASKS || '4', 10),
    /** 채팅 메시지당 호출 캡(기본 1) — CHAT_SUBAGENT.MAX_CALLS 관행(남용·지연 억제). AGENT_SPAWN_MAX_CALLS. */
    MAX_CALLS_PER_MESSAGE: parseInt(process.env.AGENT_SPAWN_MAX_CALLS || '1', 10),
    /** 채팅 경로 서브 도구 이름 키워드 필터(CSV) — 부모 활성 도구 중 이름에 이 키워드가 포함된
     *  것만 서브에 전달. 라이브 관측: 혼합 19종 전달 시 qwen 서브가 무관 도구(메모리 등)로 턴을
     *  낭비해 스텁만 반환(도구폭주 패턴). 매칭 0개면 전체 폴백. AGENT_SPAWN_SUB_TOOL_KEYWORDS. */
    SUB_TOOL_KEYWORDS: (process.env.AGENT_SPAWN_SUB_TOOL_KEYWORDS || 'search,extract,scrape,fetch,crawl,browse')
        .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
} as const;


/**
 * NotebookLM composer 연동 (routes/notebooklm.routes.ts).
 *
 * TEMPLATE_ID: 카탈로그(mcp_server_catalog) 의 NotebookLM 템플릿 id — 유저의 설치 서버
 *   row 를 catalog_template_id 로 찾을 때 사용 (076 시드와 동일 값).
 * LIST_CACHE_TTL_MS: 노트북 목록 캐시 TTL. NotebookLM RPC 왕복이 2~4초라 composer
 *   picker 열 때마다 왕복하지 않도록 캐싱한다. ?refresh=1 로 무효화 가능.
 * LIST_CACHE_MAX: per-user 캐시 엔트리 상한 (LRU).
 */
export const NOTEBOOKLM_INTEGRATION = {
    TEMPLATE_ID: process.env.NOTEBOOKLM_CATALOG_TEMPLATE_ID || 'mcp-notebooklm',
    LIST_CACHE_TTL_MS: parseInt(process.env.NOTEBOOKLM_LIST_CACHE_TTL_MS || '300000', 10),
    LIST_CACHE_MAX: parseInt(process.env.NOTEBOOKLM_LIST_CACHE_MAX || '500', 10),
} as const;
