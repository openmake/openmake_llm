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

/** 관리자 전체 조회(/admin/conversations 리서치 탭, ?viewAll=true) 기본 목록 상한.
 *  RESEARCH_LIST_ALL_DEFAULT 로 오버라이드(기본 200). */
export const RESEARCH_SESSION_LIST_ALL_DEFAULT =
    parseInt(process.env.RESEARCH_LIST_ALL_DEFAULT || '', 10) || 200;

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
    /**
     * 검색 쿼리 최대 문자 수. 토론 주제는 모델이 쓰기 때문에 쟁점 목록까지 붙은 수백 자
     * 장문이 되는 경우가 있고, 그대로 검색하면 전 백엔드가 0건을 반환한다
     * (라이브 확인: 500자 주제 → SearXNG·Wiki·News·DDG 모두 0개).
     */
    QUERY_MAX_CHARS: parseInt(process.env.DISCUSSION_FACTCHECK_QUERY_MAX_CHARS || '80', 10),
} as const;

/**
 * Discussion 멀티에이전트 동시 실행 상한
 * 라운드 내 에이전트 의견 수집(parallelBatch)의 in-flight LLM 호출 수를 제한합니다.
 * maxAgents=0(무제한, 엔진 내 20 cap) 설정 시에도 동시 요청이 폭증하지 않도록 보호합니다.
 * 기본값 5는 현재 유효 상한(strategy maxAgents=5)과 동일 — 기존 동작 불변.
 *
 * agents/discussion-engine.ts에서 참조
 */
/**
 * 토론 성립에 필요한 최소 의견 수 (2026-08-02).
 *
 * 종전에는 전원 실패(0명)만 처리하고 부분 실패는 그대로 통과시켜, 3명 중 1명만
 * 성공해도 "3명이 참여한 토론"으로 표시됐다(participants 를 선택된 전문가 기준으로
 * 산출했기 때문). 복수 관점이 없으면 토론이 아니므로, 미달 시 실패분만 1회 재시도하고
 * 그래도 미달이면 결과에 degraded 를 표시한다(전원 실패는 기존 조기 종료 경로).
 * 실측: 현 로그 범위에서 의견 생성 실패 0건 — 드물지만 발생 시 오표시를 막는 안전장치.
 */
export const DISCUSSION_MIN_PROPOSERS = parseInt(process.env.DISCUSSION_MIN_PROPOSERS || '2', 10);

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
    /**
     * 네이티브 OCR (pdftoppm+tesseract, 2026-08-04) — 구 sips+tesseract.js 폴백은 첫
     * 페이지만 인식하는 1페이지 한계가 있었다. 호스트에 poppler/tesseract 가 있으면
     * 다중 페이지 병렬 OCR 로 대체하고, 없으면 구 경로로 자동 폴백(graceful).
     * 생성 시점 동기 추출이므로 페이지·시간 예산으로 상한을 건다 — 예산 밖 잔여
     * 페이지는 원본이 샌드박스로 전달돼 에이전트가 컨테이너 내 tesseract 로 직접 처리.
     */
    /** 생성 시점 OCR 최대 페이지 수 (한국어 OCR 실측 약 2~7초/페이지 — 예산 내 상한) */
    OCR_MAX_PAGES: parseInt(process.env.DOC_EXTRACT_OCR_MAX_PAGES || '50', 10),
    /** OCR 래스터화 해상도 (dpi) — 인쇄물 텍스트는 200 이면 충분, 300 은 2배 이상 느림 */
    OCR_DPI: parseInt(process.env.DOC_EXTRACT_OCR_DPI || '200', 10),
    /** OCR 페이지 병렬도 (tesseract 프로세스 동시 실행 수) */
    OCR_PARALLEL: parseInt(process.env.DOC_EXTRACT_OCR_PARALLEL || '4', 10),
    /** PDF OCR 경로 전용 크기 상한 — MAX_BYTES_PER_FILE(JVM 보호용 30MB) 초과 스캔본도
     *  이 상한까지는 OCR 를 시도한다(opendataloader 만 생략, 디스크 경유라 메모리 안전) */
    OCR_MAX_BYTES: parseInt(process.env.DOC_EXTRACT_OCR_MAX_BYTES || String(300 * 1024 * 1024), 10),
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
 * SearXNG 카테고리 스코프 — 질의 성격에 맞는 카테고리를 추가 요청해 권위 소스를 보강한다.
 * (기본 general 은 google cse+ddg 뿐이라 블로그 위주 — `it` 은 github/mdn/docker hub,
 *  `science` 는 arxiv/pubmed/scholar 가 유입됨. 2026-08-14 인스턴스 실측.)
 * 감지는 결정적 regex 만 사용 (LLM 판단 경계 A형 금지 — CLAUDE.md).
 */
/**
 * 검색 escalation (Tier 1) — 무료 Tier 0 수집이 부족할 때만 공식 API(Exa)로 보강한다.
 * 판단은 결정적 개수 비교뿐 (LLM 판단 아님). Exa 무료 크레딧(월 $10 ≈ 1,400회) 절약을 위해
 * 평시(수집 충분)에는 절대 호출하지 않는다. EXA_API_KEY 미설정 시 전체 비활성.
 */
export const SEARCH_ESCALATION = {
    /** dedupe 후 수집 결과가 이 값 미만이면 Exa 보강. 0 = 비활성. env: SEARCH_ESCALATION_MIN_RESULTS */
    MIN_RESULTS: parseInjectLimit(process.env.SEARCH_ESCALATION_MIN_RESULTS, 5),
    /** escalation 시 Exa 요청 결과 수. env: SEARCH_ESCALATION_EXA_RESULTS */
    EXA_NUM_RESULTS: parseInjectLimit(process.env.SEARCH_ESCALATION_EXA_RESULTS, 10),
    /**
     * escalation Exa 호출 지연 상한(ms) — 병렬 배치 이후의 **직렬** 호출이라 채팅 TTFT 에
     * 그대로 가산되므로 provider fetch timeout(~12s)보다 훨씬 짧게 캡한다. 초과 시 보강 포기
     * (Tier 0 결과만으로 진행). 0 = 상한 없음. env: SEARCH_ESCALATION_TIMEOUT_MS
     */
    TIMEOUT_MS: parseInjectLimit(process.env.SEARCH_ESCALATION_TIMEOUT_MS, 4000),
} as const;

/**
 * 네이버 검색 일일 쿼터 배분 — 보조 endpoint(encyc)는 일일 한도의 이 비율(0~1)까지만 소모한다.
 * 백과 추가로 KO 쿼리당 네이버 호출이 2→3회가 되며 같은 일일 한도를 잠식하던 것을 완화 —
 * 소프트 컷 도달 시 encyc 만 먼저 중단되고 핵심(news/webkr)은 하드 한도까지 계속 동작한다.
 * env: NAVER_SUPPLEMENTARY_QUOTA_RATIO
 */
export const NAVER_QUOTA = {
    SUPPLEMENTARY_RATIO: (() => {
        const n = Number(process.env.NAVER_SUPPLEMENTARY_QUOTA_RATIO ?? 0.9);
        return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.9;
    })(),
} as const;

/**
 * Deep Research 전용 Tavily 보강 — 일반 검색에는 쓰지 않는다 (무료 월 1,000 크레딧 절약).
 * advanced 는 쿼리당 2 크레딧이지만 정제 본문(content)이 실려 와 스크랩 실패를 줄인다.
 */
export const RESEARCH_TAVILY = {
    /** 쿼리당 Tavily 결과 수. 0 = 비활성. env: RESEARCH_TAVILY_MAX_RESULTS */
    MAX_RESULTS: parseInjectLimit(process.env.RESEARCH_TAVILY_MAX_RESULTS, 5),
    /** 검색 깊이 basic(1크레딧)/advanced(2크레딧). env: RESEARCH_TAVILY_DEPTH */
    SEARCH_DEPTH: (process.env.RESEARCH_TAVILY_DEPTH === 'basic' ? 'basic' : 'advanced') as 'basic' | 'advanced',
} as const;

/** 카카오 지도 임베드 HTML (네이티브 앱 WKWebView 용) */
export const KAKAO_MAP_EMBED = {
    /** 정적 HTML 이라 캐시 허용 — 장소 데이터는 앱이 주입하므로 응답에 없다 */
    CACHE_SECONDS: Number(process.env.KAKAO_MAP_EMBED_CACHE_SECONDS) || 3600,
    /** 단일 지점일 때의 기본 확대 레벨 (카카오 기준: 작을수록 확대) */
    DEFAULT_LEVEL: Number(process.env.KAKAO_MAP_EMBED_DEFAULT_LEVEL) || 4,
} as const;

export const SEARXNG_CATEGORY_SCOPE = {
    /** 기술/개발 질의 → `it` 카테고리 (github·stackoverflow·mdn·pypi·docker hub).
     *  ⚠️ 단독 `코드` 같은 일반어 토큰 금지 — '할인 코드' 류 비기술 질의가 매칭돼 카테고리를 오염시킨다. */
    IT_PATTERN: /(에러|오류|버그|디버깅|코드\s?리뷰|코딩|라이브러리|프레임워크|컴파일|리액트|백엔드|프론트엔드|데이터베이스|프로그래밍|소스\s?코드|개발\s?환경|\bapi\b|\bsdk\b|\bnpm\b|\bpip\b|docker|kubernetes|github|typescript|javascript|python|\bjava\b|\brust\b|golang|react|next\.?js|node\.?js|\bsql\b)/i,
    /** 학술/논문 질의 → `science` 카테고리 (arxiv·pubmed·google scholar·semantic scholar).
     *  ⚠️ 단독 `paper`/`study` 금지 — 'paper towel'·'study cafe' 류 일반 질의 오매칭. */
    SCIENCE_PATTERN: /(논문|학술|저널|피인용|임상|의학\s?연구|arxiv|pubmed|scholar|preprint|research\s+paper|academic\s+paper|clinical\s+(trial|study))/i,
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
    /** 의미론적 요약 사용 모델 — 빈 값이면 LLM_DEFAULT_MODEL.
     * (구 기본 'phi3:mini' 는 Ollama 시절 모델로 vLLM/LiteLLM 카탈로그에 없어
     *  활성화 시 404→절단 폴백만 타던 죽은 기본값 — 2026-08-03 제거) */
    COMPACTOR_MODEL: process.env.COMPACTOR_MODEL || '',
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
    /** 본문 검색 발췌(snippet)의 매칭 지점 전후 문자 수 */
    SEARCH_SNIPPET_RADIUS: parseInt(process.env.CONVERSATION_SEARCH_SNIPPET_RADIUS || '60', 10),
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
    REFERENCE_DOMAINS: ['wikipedia.org', 'namu.wiki', 'britannica.com', 'terms.naver.com'] as readonly string[],
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
    /**
     * 같은 도구를 **인자 무관** 으로 반복 호출한 누적 횟수 임계값 (경고 주입).
     *
     * 기존 SAME_CALL_* 은 "도구+인자" 해시 기준이라, 검색어만 조금씩 바꿔 부르면
     * 영원히 걸리지 않는다. 실측(2026-08-02): 검색성 질의 6건 중 3건이 쿼리를
     * 갈아가며 최대 턴(5)을 소진했고 — "주식코드" → "엔비디아 주가" →
     * "엔비디아 NVDA 주가 오늘" → "nvda stock price today" → … —
     * 매 턴 모델 prefill(≈1.8초)이 누적돼 총 37초가 걸렸다.
     */
    SAME_TOOL_WARN_AT: Number(process.env.LOOP_SAME_TOOL_WARN) || 3,
    /** 같은 도구 반복 누적이 이 횟수에 도달하면 도구를 끄고 마무리 턴으로 전환. */
    SAME_TOOL_BREAK_AT: Number(process.env.LOOP_SAME_TOOL_BREAK) || 5,
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
/**
 * 채팅 경로의 외부 provider 실패 → 로컬 기본 모델 폴백 정책.
 *
 * 역할(role) 경로에는 4xx 강등이 있었으나 채팅에는 없어, 기본 모델을 외부로 둔 사용자가
 * 구독 한도(429)·세션 만료(401)를 만나면 대화가 통째로 실패했다(2026-07-26 점검).
 * 스트리밍 도중 교체는 답변이 섞이므로, 폴백은 "첫 토큰 이전"에만 수행한다.
 */
/**
 * 외부 모델 가용성 프로브 (services/model-availability-probe).
 * provider 카탈로그를 최소 요청으로 찔러 실사용 가능 모델만 남기는 점검의 한도.
 */
/**
 * 딥리서치 컨텍스트 (스킬 지식 + MCP 근거 수집).
 * 리서치는 웹검색 전용 파이프라인이라 도구·스킬이 없었다(2026-07-26 점검) — 이 상수들이
 * 도구폭주(전체 카탈로그 전달 시 vLLM 문법 컴파일 101s 실측) 없이 붙이기 위한 상한이다.
 */
export const RESEARCH_CONTEXT = {
    /** MCP 근거 수집 단계 게이트 — RESEARCH_MCP_EVIDENCE=false 로 opt-out */
    MCP_EVIDENCE_ENABLED: process.env.RESEARCH_MCP_EVIDENCE !== 'false',
    /** LLM 에 노출할 관련 도구 상한 (목표 관련성 top-K). RESEARCH_MCP_TOOL_BUDGET */
    MCP_TOOL_BUDGET: parseInt(process.env.RESEARCH_MCP_TOOL_BUDGET || '8', 10),
    /** 1회 수집에서 실행할 도구 호출 상한. RESEARCH_MCP_MAX_CALLS */
    MCP_MAX_CALLS: parseInt(process.env.RESEARCH_MCP_MAX_CALLS || '3', 10),
    /** 수집 턴의 출력 토큰 상한 (도구 호출 인자만 필요). RESEARCH_MCP_MAX_TOKENS */
    MCP_MAX_TOKENS: parseInt(process.env.RESEARCH_MCP_MAX_TOKENS || '1024', 10),
    MCP_MIN_RESULT_CHARS: parseInt(process.env.RESEARCH_MCP_MIN_RESULT_CHARS || '40', 10),
    /** 도구 결과 본문 캡 — 합성 컨텍스트 팽창 방지 */
    MCP_RESULT_CHAR_CAP: parseInt(process.env.RESEARCH_MCP_RESULT_CHAR_CAP || '8000', 10),
    /** 리서치에 부적합해 제외하는 도구 (웹검색은 파이프라인이 이미 수행) */
    MCP_EXCLUDED_TOOLS: (process.env.RESEARCH_MCP_EXCLUDED_TOOLS
        || 'web_search,web_scrape,web_crawl,web_map,extract_webpage,research_topic,generate_image')
        .split(',').map((s) => s.trim()).filter(Boolean),
} as const;

export const MODEL_AVAILABILITY_PROBE = {
    /** 모델 1건당 상한 — 초과 시 '판정 보류'(기록 안 함). MODEL_PROBE_TIMEOUT_MS */
    TIMEOUT_MS: parseInt(process.env.MODEL_PROBE_TIMEOUT_MS || '20000', 10),
    /** 동시 프로브 수 — upstream rate limit 회피. MODEL_PROBE_CONCURRENCY */
    CONCURRENCY: parseInt(process.env.MODEL_PROBE_CONCURRENCY || '6', 10),
} as const;

export const EXTERNAL_CHAT_FALLBACK = {
    /** 기능 게이트 — 끄려면 EXTERNAL_CHAT_LOCAL_FALLBACK=false */
    ENABLED: process.env.EXTERNAL_CHAT_LOCAL_FALLBACK !== 'false',
    /** status 코드가 없을 때 폴백 대상으로 볼 ProviderError code (CSV 오버라이드 가능) */
    RETRYABLE_CODES: (process.env.EXTERNAL_CHAT_FALLBACK_CODES
        || 'INVALID_API_KEY,QUOTA_EXCEEDED,INSUFFICIENT_CREDIT,SUBSCRIPTION_REQUIRED,MODEL_NOT_FOUND,UPSTREAM_ERROR')
        .split(',').map((s) => s.trim()).filter(Boolean),
} as const;

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
 *
 * 2026-08-19: 12 → 20. 실측상 **개수 cap 이 바이트 예산보다 먼저 걸려** 정원을 낭비하고
 * 있었다 — 운영 로그가 매 요청 `46개 중 12개(8KB)` 로, SCHEMA_BUDGET(16KB)의 절반만
 * 쓰고도 개수에서 잘렸다. 도구당 평균 ~0.67KB 이므로 20개여도 ~13KB 로 예산 안이며,
 * 바이트 상한이 실질 가드로 남는다(hang 근거였던 786KB 와는 두 자릿수 차이).
 * 도구가 많은 서버(notebooklm 39·open-design 18)를 쓰는 사용자는 이 상한 때문에
 * round-robin 앞쪽 2~3개만 노출돼 나머지에 접근할 방법이 서버명 언급뿐이었다.
 */
export const CHAT_USER_MCP_TOOL_CAP = parseInt(
    process.env.CHAT_USER_MCP_TOOL_CAP || '20',
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

/** P1 보고서 파이프라인 — 보고서 의도 시 reportdata 데이터 계약 주입 + 결정적 템플릿 렌더. */
export const REPORT_PIPELINE = {
    /** 기본 OFF — 운영 .env 에서 REPORT_PIPELINE_ENABLED=true 로 활성화(카나리아 후 상시 ON). */
    ENABLED: process.env.REPORT_PIPELINE_ENABLED === 'true',
} as const;

/**
 * 오픈디자인(open-design MCP) 산출물 결정적 에코 — 도구 루프에서 create_artifact 로
 * 워크스페이스에 저장한 HTML 을 모델이 최종 응답 <artifact> 로 옮기지 않는 문제(말로만
 * "아래에서 확인하세요" 안내, 2026-08-14 라이브 실측)의 보정. 생성 이미지·카카오맵·웹검색
 * 출처·reportdata 와 동일한 결정적 첨부 패턴 — external-deterministic-append 참고.
 */
export const OD_ARTIFACT_ECHO = {
    /** 기본 ON — OD_ARTIFACT_ECHO_ENABLED=false 로 비활성화. */
    ENABLED: process.env.OD_ARTIFACT_ECHO_ENABLED !== 'false',
    /** HTML 캡처 대상 도구 이름 콤마 목록 (네임스페이스 포함 전체 이름). */
    TOOL_NAMES: (process.env.OD_ARTIFACT_ECHO_TOOLS
        ?? 'open-design::create_artifact,open-design::write_file')
        .split(',').map((s) => s.trim()).filter(Boolean),
} as const;

/**
 * 이미지 생성 병렬화 — 같은 턴에 generate_image 가 2회 이상 호출되면 순차 await 대신
 * 동시 실행한다. FLUX 디퓨전 1장이 수십 초라 다중 이미지(발표자료 삽화 등)에서 도구 배치
 * 시간이 장수에 비례해 늘던 것을 1장 수준으로 줄인다. 다른 도구는 순차 유지(부수효과·
 * 메시지 순서 보존), 결과는 원래 호출 순서대로 tool 메시지에 배치된다.
 */
export const IMAGE_GEN_PARALLEL = {
    /** 기본 ON — IMAGE_GEN_PARALLEL_ENABLED=false 로 비활성화(순차 복귀). */
    ENABLED: process.env.IMAGE_GEN_PARALLEL_ENABLED !== 'false',
    /** 동시 생성 상한 — vLLM-Omni FLUX 서버 큐 과점유 방지. */
    MAX_CONCURRENT: parseInt(process.env.IMAGE_GEN_PARALLEL_MAX || '3', 10),
    /**
     * 루프 wall-clock 예산에서 공제할 이미지 생성 소요시간 상한 (ms).
     *
     * 이미지 3장 배치(실측 166s, FLUX 직렬 큐)가 AGENT_LOOP_LIMITS.MAX_WALL_CLOCK_MS
     * (180s)를 잠식해 후속 덱 저장 턴이 "도구 비활성 최종 턴"으로 강제 전환되던 결함
     * (2026-08-14 라이브 실측) 보정 — 디퓨전 대기는 모델/도구 폭주가 아니므로 예산에서
     * 공제하되, 상한을 둬 최악 요청 시간을 예산+상한으로 묶는다.
     */
    WALL_CLOCK_CREDIT_MAX_MS: parseInt(process.env.IMAGE_GEN_CREDIT_MAX_MS || '180000', 10),
} as const;

/**
 * 보고서 작성 의도 판정 패턴. 매칭 시 ① report-guide(reportdata JSON 계약) 시스템 프롬프트
 * 주입 ② 아티팩트 의도와 동일한 distractor 도구 억제. 실사용 문구 기반(운영 로그 2026-07):
 * "html 로 보고서를 작성해서 보고해", "보고서 형식으로 만들어줘", "리포트 작성해줘" 류.
 * "보고해"(구두 보고)만으로는 매칭하지 않는다 — 문서 산출 명사(보고서/리포트)가 필수.
 */
export const REPORT_INTENT_PATTERNS: readonly RegExp[] = [
    /(보고서|리포트)[^\n.?!]{0,16}(작성|만들|생성|정리|써\s*줘|써줘|뽑아)/,
    /(작성|만들|생성|정리)[^\n.?!]{0,10}(보고서|리포트)/,
    /\breport\b[^\n.?!]{0,24}\b(write|create|make|generate|produce)/i,
    /\b(write|create|make|generate|produce)\b[^\n.?!]{0,24}\breport\b/i,
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
    // 시의성 질의는 "검색" 이라는 단어 없이 오는 경우가 더 많다 — 시점어 + 시황/지표만으로도
    // 매칭시킨다. ("코스피 지수랑 ... 어제 어떻게 됐어?" 가 위 3개 패턴에 모두 걸리지 않아
    // web_search 가 도구 목록에서 빠졌고, 모델이 텍스트 툴콜을 뱉어 본문에 노출된 2026-08-01 사례)
    /(어제|오늘|지금|현재|최근|최신|이번\s*주)[^\n]{0,20}(종가|지수|주가|시세|환율|금리|코스피|코스닥|나스닥|비트코인|날씨|뉴스|순위)/,
    /(종가|주가|시세|환율|금리|코스피|코스닥|나스닥|비트코인)[^\n]{0,15}(얼마|어때|어떻게|알려|현황)/,
] as const;

/**
 * 응답 스크립트 순수성 교정 (2026-08-02) — 한글 문장에 섞인 한자·가나를 후단에서 교정.
 * 프롬프트 강화로는 혼입률이 내려가지 않아(A/B 45% 유지) 후단 교정으로 처리한다.
 * 상세 근거는 services/chat-service/script-purity.ts 참고.
 */
export const SCRIPT_PURITY = {
    /** false 면 교정 LLM 호출 자체를 하지 않음(전체 비활성). */
    ENABLED: process.env.CHAT_SCRIPT_PURITY_REPAIR !== 'false',
    /** 혼입 줄이 이보다 많으면 교정 생략 — 줄 단위 교정의 이점이 사라지는 구간. */
    MAX_LINES: parseInt(process.env.CHAT_SCRIPT_PURITY_MAX_LINES || '20', 10),
    /** 교정 호출 전용 타임아웃 — 응답 완료 후 추가 지연이므로 짧게. */
    TIMEOUT_MS: parseInt(process.env.CHAT_SCRIPT_PURITY_TIMEOUT_MS || '20000', 10),
    /** 교정 출력 상한. 혼입 줄만 되돌려받으므로 본문 전체보다 훨씬 작다. */
    MAX_OUTPUT_TOKENS: parseInt(process.env.CHAT_SCRIPT_PURITY_MAX_TOKENS || '1200', 10),
    /** 교정본이 원문 대비 이 비율보다 짧으면 내용 유실로 보고 그 줄은 원문 유지. */
    MIN_LENGTH_RATIO: 0.5,
    /**
     * 교정 프롬프트. 성공 기준("하나라도 남으면 실패")과 단어 단위 매핑 예시가 핵심 —
     * 이 둘이 없던 초기 문구는 어려운 케이스(중국어 단어가 통째로 섞인 경우)를 0/5 로
     * 전혀 고치지 못했고, 추가 후 5/5 로 바뀌었다(2026-08-02 A/B).
     * 예시는 라이브에서 실제 교정에 실패했던 문장들에서 뽑았다.
     */
    SYSTEM_PROMPT: [
        '당신은 한국어 교정기입니다. 각 줄에서 한글이 아닌 문자(한자·중국어 간체자·일본어 가나)를',
        '문맥에 맞는 한국어로 빠짐없이 바꾸세요. 출력에 한자가 하나라도 남아 있으면 실패입니다.',
        '',
        '중국어 단어가 통째로 섞인 경우가 많습니다. 글자마다 음차하지 말고 단어 전체를 한국어로 옮기세요:',
        '- 주도下的 기술 → 주도하는 기술',
        '- 전交易日 → 전 거래일',
        '- 前次会议 → 지난 회의',
        '- 影响 → 영향,  除外 → 제외,  开发商 → 개발사,  当天 → 당일,  支出 → 지출',
        '',
        '그 외의 내용·수치·마크다운 서식은 절대 바꾸지 마세요.',
        '입력과 같은 "번호. 내용" 형식으로, 입력된 줄 수만큼만 출력하세요. 설명은 붙이지 마세요.',
    ].join('\n'),
} as const;

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
    /** 작업 생성 요청 body 상한(bytes) — /api/agent-tasks 의 express.json 파서와 validate
     *  미들웨어(maxBodySizeBytes)가 공유하는 단일 소스(정합 고정: 파서만 크고 검증이 1MB 로
     *  거부하던 불일치 방지). 첨부는 base64 로 4/3 팽창하므로 원본 파일 실효 상한은 약 3/4.
     *  AGENT_TASK_BODY_MAX_BYTES(기본 1000MB). */
    REQUEST_BODY_MAX_BYTES: parseInt(process.env.AGENT_TASK_BODY_MAX_BYTES || '', 10) || 1000 * 1024 * 1024,
    /** 입력 첨부 원본 저장 루트(호스트) — multipart 업로드가 디스크로 스트리밍되는 위치.
     *  base64-in-JSON 경로와 달리 메모리에 body 를 올리지 않는다. task 삭제 시 함께 정리.
     *  AGENT_TASK_UPLOAD_ROOT(기본 <cwd>/data/uploads/agent-tasks). */
    UPLOAD_ROOT: process.env.AGENT_TASK_UPLOAD_ROOT
        || `${process.cwd()}/data/uploads/agent-tasks`,
    /**
     * 청크 업로드(2026-08-04) — chat.openmake.cc 외부 경로는 Cloudflare 무료 플랜의
     * 요청당 100MB 상한이 있어 단일 multipart/json 으로는 대용량 첨부가 edge 413 으로
     * 거절된다. 파일을 청크로 나눠 /api/agent-task-uploads 로 올린 뒤 uploadId 참조로
     * 작업을 생성하면 요청당 크기가 CHUNK_MAX_BYTES 이하로 유지돼 상한을 우회한다.
     */
    /** 청크 1개 최대 크기(bytes) — Cloudflare 100MB 상한 대비 충분한 여유.
     *  AGENT_TASK_CHUNK_MAX_BYTES(기본 32MB). */
    CHUNK_MAX_BYTES: parseInt(process.env.AGENT_TASK_CHUNK_MAX_BYTES || '', 10) || 32 * 1024 * 1024,
    /** 업로드당 청크 수 상한 — REQUEST_BODY_MAX_BYTES(1000MB)/최소 실용 청크 기준 여유값. */
    CHUNK_MAX_COUNT: parseInt(process.env.AGENT_TASK_CHUNK_MAX_COUNT || '', 10) || 256,
    /** 미완성(미클레임) 청크 업로드 보관 시한(ms) — init 시 지난 것을 기회적으로 청소.
     *  AGENT_TASK_CHUNK_TTL_MS(기본 24h). */
    CHUNK_UPLOAD_TTL_MS: parseInt(process.env.AGENT_TASK_CHUNK_TTL_MS || '', 10) || 24 * 60 * 60 * 1000,
    /** 사용자 지정 max_turns 의 절대 상한(Zod 입력 검증 상한도 이 값을 참조).
     *  20 은 조사→데이터 생성→렌더→검증이 이어지는 작업엔 부족하다 — 2026-08-09 실측: 예약
     *  리포트 최근 5회가 **전부 20/20 을 소진**했고, 성공한 회차조차 마진이 0이라 조금만 흔들리면
     *  실패했다. 천장만 올리는 것이라 요청 maxTurns 가 작은 작업(기본 10)에는 영향이 없다.
     *  ⚠️ 턴을 늘려도 MAX_TOTAL_TOKENS(1M)·TOKEN_SOFT_RATIO 가 먼저 걸릴 수 있다 — 토큰 사유로
     *  마무리 턴에 들어가면 shouldAdoptFinalTurnAnswer 가 본문을 살린다.
     *  AGENT_TASK_MAX_TURNS_CEILING 로 오버라이드. */
    MAX_TURNS_CEILING: parseInt(process.env.AGENT_TASK_MAX_TURNS_CEILING || '', 10) || 32,
    /**
     * 작업 목표(goal) 최대 길이. 종전 2,000자는 스키마에 하드코딩돼 있었고 근거가 없었다 —
     * 채팅 message 는 100,000자, tool arguments 는 200,000자를 받는데 goal 만 50배 좁았다.
     * 설계 문서를 그대로 작업 지시로 넣는 사용(2026-08-02, 약 11,000자)이 막혔고,
     * 채팅→작업 자동 위임 경로에서는 긴 메시지가 그대로 goal 이 되므로 같은 실패가 난다.
     * goal 은 매 턴 시스템 프롬프트에 실리므로 무제한은 곤란하다 — 20,000자면 약 1만 토큰,
     * 262K 컨텍스트의 4% 수준이라 안전하다.
     */
    GOAL_MAX_CHARS: parseInt(process.env.AGENT_TASK_GOAL_MAX_CHARS || '', 10) || 20000,
    /** 기본 최대 턴 수 */
    DEFAULT_MAX_TURNS: 10,
    /**
     * 대형 첨부(생성 시점 추출 상한 초과 — 샌드박스에서 에이전트가 직접 파싱/OCR) 시 기본 턴 수.
     * 기본 10턴은 수백 페이지 문서의 읽기+정리에 부족해 goal_incomplete 로 실패한다
     * (2026-08-08 실측: 66MB 스캔 PDF 가 턴 10/10 소진, 57MB 도 10/10 턱걸이 완주).
     * 명시 maxTurns 가 오면 그 값이 우선.
     */
    LARGE_INPUT_MAX_TURNS: parseInt(process.env.AGENT_TASK_LARGE_INPUT_MAX_TURNS || '', 10) || 20,
    /** 관리자 전체 조회(/admin/conversations 작업 탭, ?viewAll=true) 기본 목록 상한.
     *  AGENT_TASK_LIST_ALL_DEFAULT 로 오버라이드(기본 200). */
    LIST_ALL_DEFAULT: parseInt(process.env.AGENT_TASK_LIST_ALL_DEFAULT || '', 10) || 200,
    /** 작업 전체 타임아웃 (ms) — AGENT_TASK_TIMEOUT_MS 환경변수로 오버라이드.
     *  기본 10분: HTML/디자인 등 장문 deliverable 생성은 단일 LLM 호출이 수 분 걸릴 수 있음. */
    TOTAL_TIMEOUT_MS: parseInt(process.env.AGENT_TASK_TIMEOUT_MS || '', 10) || 10 * 60 * 1000,
    /** 누적 토큰 상한 (input + output) — runaway 토큰 폭주 방지. AGENT_MAX_TOTAL_TOKENS 로 오버라이드.
     *  멀티턴 도구 작업은 매 턴 prompt_tokens(전체 컨텍스트)를 누적 카운트하므로 200k 는
     *  3턴 만에 소진됐다(샌드박스 도구 작업이 terminate 전에 실패). 기본 1M 으로 상향. */
    MAX_TOTAL_TOKENS: parseInt(process.env.AGENT_MAX_TOTAL_TOKENS || '', 10) || 1_000_000,
    /** 턴 LLM 호출의 일시적 오류(5xx·408·429·connection/timeout) 재시도 횟수 — 후향 실측
     *  (2026-08-05, failed 20건 중 6~7건이 timeout/connection 류)에 근거한 노드 retry 정책 1단계.
     *  0 이면 비활성. 사용자 취소·예산 소진(signal abort)은 재시도하지 않는다.
     *  AGENT_TASK_TURN_RETRY_MAX 로 오버라이드(기본 2). */
    TURN_RETRY_MAX: parseInt(process.env.AGENT_TASK_TURN_RETRY_MAX || '2', 10),
    /** 턴 재시도 지수 백오프 기저(ms) — n번째 재시도 전 기저 × 2^(n-1) 대기(abort 시 즉시 중단).
     *  AGENT_TASK_TURN_RETRY_BACKOFF_MS 로 오버라이드(기본 2초). */
    TURN_RETRY_BACKOFF_MS: parseInt(process.env.AGENT_TASK_TURN_RETRY_BACKOFF_MS || '', 10) || 2_000,
    /** 플랜 자동 진행(088 증분 3) — 단계 완료/차단 후 in_progress 가 없으면 첫 not_started 를
     *  결정적으로 승격. 모델이 [~] 마킹을 생략해도(후향 60%, 명시 지시에도 라이브 재현)
     *  스텝→노드 귀속(plan_step_index)·진행 표시가 비지 않게 한다. 모델의 명시 마킹이 우선.
     *  AGENT_TASK_PLAN_AUTO_ADVANCE=false 로 비활성(기본 on). */
    PLAN_AUTO_ADVANCE: process.env.AGENT_TASK_PLAN_AUTO_ADVANCE !== 'false',
    /** HITL 무응답 강등 — 승인 무응답(timeout, 명시 거절 아님)이 이 횟수에 달하면 이후 턴에서
     *  승인 필요 도구(+ask_human)를 제거하고 확보한 정보로 마무리를 유도한다. 후향 실측: 방치
     *  task 가 승인 대기(30분)×N 반복으로 예산만 소진하고 산출물 0 으로 종결되던 패턴 차단.
     *  0 이면 비활성. AGENT_TASK_HITL_TIMEOUT_DEGRADE_AFTER 로 오버라이드(기본 2). */
    HITL_TIMEOUT_DEGRADE_AFTER: parseInt(process.env.AGENT_TASK_HITL_TIMEOUT_DEGRADE_AFTER || '2', 10),
    /**
     * 마무리 턴 강제(2026-08-03) — 자원 상한에 **닿기 전에** 도구를 끊고 종합 답변을 받는다.
     *
     * 하드 상한(MAX_TOTAL_TOKENS·max_turns)은 폭주를 끊을 뿐 산출을 남기지 못한다. 30일 실측:
     * 예약 리포트 20/20 턴 3건 중 2건이 리포트 파일을 이미 만든 뒤 검증 사족("Let me verify
     * the file exists")에서 절단됐고, 마지막 응답이 35~96자라 결과로 쓸 수 없었다.
     * 남은 턴이 1 이거나 누적 토큰이 하드 상한의 SOFT_RATIO 에 닿으면 도구를 제거하고
     * 마무리 지시(getAgentTaskFinalTurnNudge)를 1회 주입해 정상 완료 경로로 유도한다.
     *
     * 하드 상한 자체는 낮추지 않는다 — 완료 작업 p95 가 538K, 최대 618K 로 1M 은 정상 작업을
     * 죽이지 않는 안전망이며, 실제 제어는 이 소프트 경계가 맡는다.
     * AGENT_TASK_FINAL_TURN_NUDGE=false 로 비활성.
     */
    FINAL_TURN_NUDGE_ENABLED: process.env.AGENT_TASK_FINAL_TURN_NUDGE !== 'false',
    /**
     * 마무리 턴 전환 토큰 비율 (MAX_TOTAL_TOKENS 대비). AGENT_TASK_TOKEN_SOFT_RATIO 로 오버라이드.
     *
     * 0.7 인 이유는 **마무리 턴 한 번이 하드 상한 안에 반드시 들어오게** 하기 위해서다.
     * 남는 여유가 300K 로 모델 컨텍스트(262K)보다 크므로, 마무리 턴이 전체 컨텍스트를 다시
     * 실어도 하드 상한에 걸려 죽지 않는다. 0.8(여유 200K)이면 컨텍스트가 큰 작업의 마무리 턴이
     * 상한을 넘겨, 정리시키려던 턴에서 오히려 산출 없이 종료될 수 있다.
     * 완료 작업 실측(30일) p95 538K·최대 618K 가 700K 아래라 정상 작업은 이 경계에 닿지 않는다.
     */
    TOKEN_SOFT_RATIO: parseFloat(process.env.AGENT_TASK_TOKEN_SOFT_RATIO || '') || 0.7,
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
    /** judge 실행 컨텍스트에 싣는 최근 도구 결과 수 — 성공 증거 부재로 완수 작업을 미달성
     *  판정하던 false negative(2026-08-09 예약리포트·2026-08-15 로컬실행, 실측 2회) 완화. */
    GOAL_JUDGE_EVIDENCE_MAX_ITEMS: parseInt(process.env.AGENT_TASK_GOAL_JUDGE_EVIDENCE_MAX_ITEMS || '5', 10),
    /** judge 도구 결과 항목당 글자 캡 (프롬프트 팽창 방지) */
    GOAL_JUDGE_EVIDENCE_ITEM_CHARS: parseInt(process.env.AGENT_TASK_GOAL_JUDGE_EVIDENCE_ITEM_CHARS || '160', 10),
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
    /** 마무리 턴 본문 채택 임계(글자) — 자원 상한으로 도구를 막은 턴에서 모델이 도구 호출과 본문을
     *  함께 뱉었을 때, 본문이 이 길이 이상이면 최종 답변으로 채택해 완료 관문으로 보낸다.
     *  (미만이면 종전대로 응답을 버리고 다음 턴/턴상한 종료 — "산출물 다 만들고 실패 기록" 방지와
     *  "의도 선언만 하고 완료 오표시" 방지의 경계. 2026-08-09 예약 리포트 실측: 실패 사례의 의도
     *  선언문은 100자 안팎, 정상 최종 정리는 수백 자.) AGENT_TASK_FINAL_TURN_MIN_ANSWER 로 오버라이드. */
    FINAL_TURN_MIN_ANSWER_CHARS: parseInt(process.env.AGENT_TASK_FINAL_TURN_MIN_ANSWER || '200', 10),
    /** 도구 호출 인자 영속(091) — tool_result 스텝에 마스킹된 args 를 남겨 사후 원인 분석을 연다.
     *  (종전엔 tool_name 만 남아 "어떤 인자로 호출해서 실패했는가"를 복기할 수 없었다.)
     *  AGENT_TASK_TOOL_ARGS_PERSIST=false 로 비활성(기본 on). */
    TOOL_ARGS_PERSIST_ENABLED: process.env.AGENT_TASK_TOOL_ARGS_PERSIST !== 'false',
    /** 영속하는 인자 JSON 의 최대 글자 수 — 초과 시 절단 표식으로 대체(저장 팽창 방지).
     *  파일 내용을 통째로 넘기는 write 계열 인자가 있어 캡이 필요하다. */
    TOOL_ARGS_MAX_CHARS: parseInt(process.env.AGENT_TASK_TOOL_ARGS_MAX_CHARS || '2000', 10),
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
    /** 예약 실행 승인정책 — 예약 task 는 무인(사람 승인 불가)이므로 기본 'none'(전부 자동).
     *  전역 TASK_SANDBOX_APPROVAL_POLICY='all' 이면 예약 task 가 첫 도구서 pause 되어 멈추므로 분리한다.
     *  AGENT_TASK_SCHEDULE_APPROVAL_POLICY(기본 'none' | 'high-risk' | 'all'). */
    SCHEDULE_APPROVAL_POLICY: ((): 'all' | 'high-risk' | 'none' => {
        const v = process.env.AGENT_TASK_SCHEDULE_APPROVAL_POLICY;
        return v === 'all' || v === 'high-risk' || v === 'none' ? v : 'none';
    })(),
    /** 예약(무인) task 총 타임아웃(ms) — 리포트·디자인 등 무거운 생성 워크플로우는 대화형 기본
     *  10분을 넘길 수 있어 분리(기본 20분). AGENT_TASK_SCHEDULE_TIMEOUT_MS. */
    SCHEDULE_TOTAL_TIMEOUT_MS: parseInt(process.env.AGENT_TASK_SCHEDULE_TIMEOUT_MS || '', 10) || 20 * 60 * 1000,
    /** 예약 산출물 게시 루트 — 백엔드가 인증 없이 항상 서빙하는 정적 경로(legacy-web public) 하위.
     *  publish_slug 가 설정된 스케줄의 결과물이 <루트>/<slug>/{YYYY-MM-DD,latest}.html 로 쌓인다.
     *  AGENT_TASK_SCHEDULE_PUBLISH_DIR(기본 <cwd>/apps/legacy-web/public/generated/reports). */
    SCHEDULE_PUBLISH_DIR: process.env.AGENT_TASK_SCHEDULE_PUBLISH_DIR
        || `${process.cwd()}/apps/legacy-web/public/generated/reports`,
    /** 게시 URL 접두사 — SCHEDULE_PUBLISH_DIR 이 실제로 서빙되는 경로와 짝을 이룬다.
     *  AGENT_TASK_SCHEDULE_PUBLISH_URL_PREFIX(기본 /generated/reports). */
    SCHEDULE_PUBLISH_URL_PREFIX: process.env.AGENT_TASK_SCHEDULE_PUBLISH_URL_PREFIX || '/generated/reports',
    /** workspace 에서 게시 대상으로 집어올 산출물 파일명.
     *  AGENT_TASK_SCHEDULE_PUBLISH_FILE(기본 report.html). */
    SCHEDULE_PUBLISH_FILE: process.env.AGENT_TASK_SCHEDULE_PUBLISH_FILE || 'report.html',
    /** 게시 파일명 날짜의 기준 TZ — 서버·컨테이너가 UTC 여도 날짜가 하루 밀리지 않게 명시.
     *  AGENT_TASK_SCHEDULE_PUBLISH_TZ(기본 Asia/Seoul). */
    SCHEDULE_PUBLISH_TZ: process.env.AGENT_TASK_SCHEDULE_PUBLISH_TZ || 'Asia/Seoul',
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
    /** 재생 가능 절차 스킬(#1 Procedural Skill) — 성공한 액션 시퀀스를 저장(skill_save)하고
     *  유사 goal 에서 LLM 재추론 없이 재생(skill_run). agent_skills(category='procedural') 재사용,
     *  신규 테이블 없음. skill_run 은 코드/브라우저를 실행하므로 승인 게이트상 high-risk. 기본 OFF.
     *  AGENT_TASK_PROCEDURAL_SKILLS=true 로 활성. */
    PROCEDURAL_SKILLS_ENABLED: process.env.AGENT_TASK_PROCEDURAL_SKILLS === 'true',
    /** 재사용 후보로 system 에 제안할 절차 스킬 최대 건수(기본 3). */
    PROCEDURAL_MAX_SUGGEST: parseInt(process.env.AGENT_TASK_PROCEDURAL_MAX_SUGGEST || '3', 10),
    /** Computer Use Stage 0: browser 액션 계측(browser_action_metrics 079)을 기록한다.
     *  a11y 폴백 실효 + canvas 신호(selector·a11y 동시 실패)를 주-단위로 집계해 Stage 1
     *  분기(State block vs Vision)를 데이터로 결정. 측정이 목적이라 기본 ON — 끄려면 =false. */
    BROWSER_METRICS_ENABLED: process.env.AGENT_TASK_BROWSER_METRICS !== 'false',
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
    /** 실행 중 중간 지시(steering) — 실행 중 task 에 사용자가 방향 지시를 주입하면 다음 턴 경계에서
     *  conversation 에 user 메시지로 반영(취소·재시작 없이 교정). steering 은 사용자가 명시적으로
     *  보낼 때만 동작하므로 기본 ON. AGENT_TASK_STEERING=false 로 비활성. */
    STEERING_ENABLED: process.env.AGENT_TASK_STEERING !== 'false',
    /** steering 메시지 1건 최대 글자 수. AGENT_TASK_STEERING_MAX_CHARS(기본 2000). */
    STEERING_MAX_CHARS: parseInt(process.env.AGENT_TASK_STEERING_MAX_CHARS || '2000', 10),
    /** task 당 미소비 steering 대기 상한 — 초과 시 429(플러딩 방지). AGENT_TASK_STEERING_MAX_PENDING(기본 10). */
    STEERING_MAX_PENDING: parseInt(process.env.AGENT_TASK_STEERING_MAX_PENDING || '10', 10),
    /** execute 의 allowedSkills 배열 상한 — 초과 시 400(잘라내지 않는다). AGENT_TASK_EXECUTE_MAX_ALLOWED_SKILLS(기본 50). */
    EXECUTE_MAX_ALLOWED_SKILLS: parseInt(process.env.AGENT_TASK_EXECUTE_MAX_ALLOWED_SKILLS || '50', 10),
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
 * 오케스트레이션 자동 배정 (Stage 1, 2026-08-01) — 모델이 토론(start_discussion)·
 * 백그라운드 작업(delegate_agent_task)을 도구 호출로 직접 배정한다.
 *
 * 설계 원칙 (실측 근거):
 *  - 앞단 라우터 LLM 금지(Phase B 제거 이력) — 메인 모델의 tool_choice:auto 한 턴으로 결정.
 *  - 도구 상시 노출 금지(도구폭주 함정) — 아래 *_INTENT_PATTERNS 프리필터에 걸릴 때만 노출.
 *  - 고비용 경로 가드 — delegate 작업은 기존 승인 정책(TASK_SANDBOX_APPROVAL_POLICY)을
 *    그대로 타고, 토론은 축소 프로파일(전문가 수·라운드 캡)로 실행.
 */
export const ORCHESTRATION_DISPATCH = {
    /** 기본 OFF — 셰도우 관찰(노출·호출 로그) 후 운영 활성화. ORCHESTRATION_AUTO_DISPATCH=true. */
    ENABLED: process.env.ORCHESTRATION_AUTO_DISPATCH === 'true',
    /** 도구 경유 토론의 전문가 수 캡(기본 3) — 토글 토론(기본 10)보다 축소해 채팅 지연 억제. */
    DISCUSSION_MAX_AGENTS: parseInt(process.env.ORCH_DISCUSSION_MAX_AGENTS || '3', 10),
    /** 도구 경유 토론 시간 상한(ms, 기본 120초) — 초과 시 도구 결과로 오류 반환. */
    DISCUSSION_TIMEOUT_MS: parseInt(process.env.ORCH_DISCUSSION_TIMEOUT_MS || '120000', 10),
    /**
     * 도구 경유 토론의 근거 수집(Evidence Package) 여부. 기본 true.
     * 종전엔 이 경로만 enableFactCheck=false + webSearchFn 미주입이라 검색 0건으로
     * 토론했다(토글 경로는 켜져 있어 비대칭). 라이브 확인: "2026년 반도체 리스크"
     * 토론 41초 동안 검색 0건 — 시의성 주제를 파라메트릭 지식만으로 논함.
     * 검색 1회(~3-5초)가 추가되므로 지연이 문제면 false 로 끈다.
     */
    DISCUSSION_EVIDENCE: process.env.ORCH_DISCUSSION_EVIDENCE !== 'false',
    /** 도구 결과 문자열 캡 — 토론 합성 결과의 컨텍스트 폭주 방지. */
    RESULT_CAP_CHARS: parseInt(process.env.ORCH_RESULT_CAP_CHARS || '8000', 10),
    /** 메시지당 오케스트레이션 도구 호출 캡(종류 무관 합산, 기본 1). */
    MAX_CALLS_PER_MESSAGE: parseInt(process.env.ORCH_MAX_CALLS_PER_MESSAGE || '1', 10),
    /**
     * Agent Task 스텝에서 start_discussion 노출 여부. **기본 OFF**.
     *
     * 채팅 배정(ENABLED)과 분리한 이유:
     *  ① 수요 미확인 — 유사 기능인 spawn_agents 는 Agent Task 에서 역대 호출 0건이고,
     *     실측 상위는 bash(247)·plan_update(179)·web_search(103) 로 위임/토론류가 없다.
     *  ② 도구 수는 의식적으로 관리된다 — 작업 도구는 11종으로 고정돼 있고 테스트가 이를
     *     단언한다(도구폭주 시 vLLM 문법 컴파일 101초 타임아웃 선례).
     * 켜면 12종이 되므로, 필요한 운영에서만 명시적으로 활성화한다.
     */
    TASK_DISCUSSION: process.env.AGENT_TASK_DISCUSSION === 'true',
} as const;

/** 토론 의도 프리필터 — start_discussion 노출 게이트 (매칭 시에만 도구 노출).
 *
 *  2026-08-01 벤치마크(32건 라벨셋) 기반 교정: 초판은 재현율 65%·오탐 0 이었다.
 *  오탐 여유가 있어 표현 변형을 넓혔다 — '찬성과 반대', '다양한/다각적 관점', '장단점',
 *  'A와 B 중 뭐가 나은지' 형태를 추가(미탐이던 실제 질의 패턴). */
export const DISCUSSION_INTENT_PATTERNS: readonly RegExp[] = [
    /토론|찬반|논쟁|양쪽\s*(의견|입장)|다각도|전문가.{0,6}(의견|관점|시각)/i,
    /찬성.{0,6}반대|반대.{0,6}찬성/i,
    /(여러|다양한|다각적|여러가지|폭넓은)\s*(관점|시각|의견|입장|각도)/i,
    /장단점|(긍정|부정)\s*(적)?\s*(측면|면)|상반된\s*(의견|주장)/i,
    /(중|가운데)\s*(뭐가|무엇이|어느\s*쪽이)\s*(나은|좋은|맞는)/i,
    /debate|pros\s+and\s+cons|multiple\s+perspectives|different\s+viewpoints/i,
];

/** 백그라운드 작업 위임 의도 프리필터 — delegate_agent_task 노출 게이트.
 *  ⚠️ '보고서' 는 P1 인라인 보고서 파이프라인과 충돌하므로 의도적으로 제외.
 *  프론트 Option B(파일 첨부+연산 → 자동 위임)와 상보적 — 여긴 텍스트-온리 중작업 커버.
 *
 *  2026-08-01 벤치마크 교정: 초판은 산출물 명사와 생성 동사가 **인접**해야만 매칭돼
 *  "xlsx 파일을 만들어줘"(조사)·"스크립트를 만들어서 돌려줘"·"텍스트 파일로 회의록을 생성"
 *  같은 실제 어순을 놓쳤다(미탐 5건). 명사~동사 사이 최대 20자를 허용하되 동사는
 *  생성 계열로 한정해 "이 파일 설명해줘" 류 조회 질의는 계속 배제한다. */
export const TASK_DELEGATE_INTENT_PATTERNS: readonly RegExp[] = [
    /백그라운드|에이전트\s*작업/i,
    /(파일|엑셀|스프레드시트|xlsx|csv|pdf|pptx?|docx?|스크립트|프로그램)[^\n]{0,20}?(만들|생성|작성|저장|변환|출력)/i,
    /코드를?\s*(실행|돌려|구동)|스크립트를?\s*(실행|돌려|구동)/i,
    /장시간|(시간이?\s*)?오래\s*걸(리|려)|시간\s*오래/i,
    /in\s+the\s+background|as\s+an?\s+agent\s+task|(create|generate|build|write)\s+(a\s+)?[^\n]{0,15}?(file|excel|csv|pdf|script)/i,
];

/** 계획수립 의도 프리필터 — create_plan 강제 포함 + 첫 턴 tool_choice 강제 게이트.
 *  create_plan(review role 소비처)은 always-on/스킬바인딩/토글 어디에도 없어 채팅에서
 *  도달 불가능했다(2026-08-11 진단). 구현/개발 계획의 명시 요청만 매칭 — "여행 계획" 같은
 *  일반 계획은 배제해 tool_choice 강제 오탐(도구 이탈)을 막는다. */
export const PLAN_INTENT_PATTERNS: readonly RegExp[] = [
    /(구현|개발|실행|작업|리팩터링|마이그레이션)\s*계획[^\n]{0,10}?(세워|수립|짜|만들|작성)/i,
    /(기능|시스템|모듈|서비스|프로젝트)[^\n]{0,25}?계획[^\n]{0,10}?(세워|수립|짜|만들|작성)/i,
    /create_plan/i,
    /implementation\s+plan/i,
];

/** 확장 설치 의도 프리필터 — import_extension_from_git 강제 포함 게이트.
 *  확장/플러그인/마켓플레이스 설치는 always-on/토글 어디에도 없어 채팅에서 도달
 *  불가능했다(2026-08-16 라이브 실측 — 모델이 filesystem MCP 로 이탈). Settings
 *  확장 탭의 안내("채팅에서 '이 확장 설치해줘: URL' 로 요청")와 UX 계약을 맞춘다.
 *  git URL/저장소 언급 + 설치/업데이트 동사의 결합만 매칭 (오탐 억제). */
export const EXTENSION_IMPORT_INTENT_PATTERNS: readonly RegExp[] = [
    /(확장|플러그인|extension|plugin)[^\n]{0,40}?(설치|추가|가져와|업데이트|install|import|update)/i,
    /(설치|추가|install)[^\n]{0,20}?(확장|플러그인|extension|plugin)/i,
    /(마켓플레이스|marketplace)[^\n]{0,30}?(설치|목록|보여|열어|install|list)/i,
    /import_extension_from_git/i,
];

/** 병렬 위임 의도 프리필터 — spawn_agents 사용 가이드 주입 게이트 (도구는 상시 노출).
 *  spawn 자발 채택 0 의 원인 = description 의 보수적 경고 + 사용 가이드 부재
 *  (2026-08-11 진단, 명시 유도 시엔 fan-out 정상 동작 실증 2026-07-17). */
export const SPAWN_INTENT_PATTERNS: readonly RegExp[] = [
    /(병렬|동시)(로|에)?\s*(조사|검색|리서치|분석|처리|수행|실행|진행)/i,
    /(서브|하위)\s*에이전트|subagent|sub-agent/i,
    /spawn_agents/i,
    /(각각|나눠서|나누어)\s*(조사|검색|분석|알아보)/i,
    /in\s+parallel|parallel\s+(research|search|tasks)/i,
];


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


/**
 * 에이전트 자가개선 루프 (F2) — 피드백 수집 → 품질 분석 → 프롬프트 제안 → 관리자 승인 → 주입.
 *
 * 운영에서 제안이 0건이던 원인이 세 갈래였다(마이그 099 주석 + 아래 항목):
 *   ① 입력 부재 — 채팅 thumbs 신호가 학습 시스템으로 흘러들지 않았다 (SIGNAL_RATING 배선으로 해소).
 *   ② 휘발 — 피드백이 인메모리 배열에만 있고 부팅 시 복원되지 않았다 (HYDRATE_LIMIT).
 *   ③ 미실행 — 24h setInterval 뿐이라 재시작이 잦은 환경에선 사실상 돌지 않았다 (FIRST_RUN_DELAY_MS).
 *
 * SIGNAL_RATING: 채팅 피드백 신호를 학습 시스템의 1~5 평점으로 환산하는 매핑.
 *   regenerate 는 명시적 불만은 아니나 재생성을 부른 응답이므로 낮게 둔다.
 * HYDRATE_LIMIT: 부팅 시 agent_feedback 에서 복원할 최근 피드백 수 (인메모리 상한도 겸함).
 * FIRST_RUN_DELAY_MS: 부팅 후 첫 사이클까지의 지연 — 부팅 폭주를 피하면서도 24h 를 기다리지 않는다.
 * INTERVAL_MS: 이후 사이클 주기.
 */
export const AGENT_SELF_IMPROVE = {
    SIGNAL_RATING: {
        thumbs_up: 5,
        thumbs_down: 1,
        regenerate: 2,
    } as Record<string, 1 | 2 | 3 | 4 | 5>,
    HYDRATE_LIMIT: parseInt(process.env.AGENT_SELF_IMPROVE_HYDRATE_LIMIT || '2000', 10),
    FIRST_RUN_DELAY_MS: parseInt(process.env.AGENT_SELF_IMPROVE_FIRST_RUN_DELAY_MS || '300000', 10),
    INTERVAL_MS: parseInt(process.env.AGENT_SELF_IMPROVE_INTERVAL_MS || String(6 * 60 * 60 * 1000), 10),
} as const;
