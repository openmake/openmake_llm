/**
 * 런타임 제한값 — 컨텍스트·토큰 예산, 절단, 첨부·문서 처리, 웹검색 주입, 캐시·재시도·비밀번호 정책.
 * 공개 진입점은 config/runtime-limits(이 파일을 re-export) — 소비처는 그쪽에서 import 한다.
 *
 * @module config/runtime-limits-context
 */

// ============================================
// 토큰 예산 (Discussion/Context Engineering)
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
// Deep Research 기본 파라미터
// ============================================

// ============================================
// Deep Research Strategy 파라미터 (Chat 파이프라인 전용)
// ============================================

// ============================================
// Deep Research 깊이별 루프 설정
// ============================================

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
// 신뢰도/중요도 기본값
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
    /**
     * kordoc 으로 처리할 한국 공문서 확장자.
     *
     * `.hwp`·`.hwpx` 는 업로드 화이트리스트(`ALLOWED_DOCUMENT_EXTENSIONS`)에 오래 있었지만
     * 추출기 어느 목록에도 없어 **받아만 두고 본문을 못 읽었다**(확장자 허용 ≠ 파싱 지원).
     * kordoc(순수 JS, 한컴오피스·JVM 불요)이 HWP 3.x/5.x·HWPX·HWPML 을 마크다운으로 낸다.
     */
    HWP_EXTS: ['hwp', 'hwpx', 'hml'] as readonly string[],
    /**
     * 텍스트로 풀어 쓸 확장자(base64 data → UTF-8 → content).
     * REST 클라이언트(봇 등)는 텍스트 파일도 base64 로 보내는데, 위 목록에 없어 data 가 버려지고
     * "바이너리 메타"로만 들어갔다. 실제 판정은 NUL 바이트·UTF-8 디코딩 검사를 함께 통과해야 한다.
     */
    TEXT_EXTS: ['txt', 'csv', 'tsv', 'md', 'markdown', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'log', 'ini', 'cfg',
        'conf', 'toml', 'html', 'htm', 'css', 'js', 'ts', 'py', 'sh', 'sql'] as readonly string[],
    /** kordoc 추출 타임아웃 (ms) — 순수 JS 파서라 JVM 경로보다 짧게 잡는다 */
    HWP_TIMEOUT_MS: parseInt(process.env.DOC_EXTRACT_HWP_TIMEOUT_MS || '30000', 10),
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
 * 로컬 vLLM 요청당 프롬프트 이미지 총 상한 (2026-09-03)
 * vLLM `--limit-mm-per-prompt '{"image": N}'` 와 페어 — 초과 요청은 업스트림 400
 * ("At most N image(s) may be provided in one prompt"). LLMClient wire 변환 직전
 * (llm/prompt-image-cap.ts) 이 history 포함 총량을 이 값에 맞춘다. 0 이면 비활성.
 */
export const LLM_PROMPT_IMAGE_LIMITS = {
    MAX_PER_REQUEST: parseInt(process.env.LLM_PROMPT_IMAGE_CAP || '8', 10),
} as const;

/**
 * PDF 첨부 vision 페이지 주입 한도 (2026-08-19)
 * 채팅 PDF 첨부를 하이브리드로 처리 — 기존 doc-extractor 텍스트 추출에 더해 앞쪽
 * 페이지를 pdftoppm 으로 JPEG 렌더해 vision(images) 채널에 병행 주입한다
 * (표·차트 등 텍스트 추출로 소실되는 레이아웃 보강). pdftoppm 미설치 시 graceful skip.
 *
 * services/chat-service/pdf-vision.ts 에서 참조
 */
export const PDF_VISION_LIMITS = {
    /** 기능 on/off (기본 on — 'false' 명시 시에만 비활성) */
    ENABLED: process.env.PDF_VISION_ENABLED !== 'false',
    /** 요청당 프롬프트 이미지 총 상한 — 기본은 LLM_PROMPT_IMAGE_LIMITS(vLLM 페어)를 따른다.
     *  사용자 첨부 이미지가 이 값을 채우면 페이지 주입은 잔여분만 사용 */
    TOTAL_IMAGE_CAP: parseInt(process.env.PDF_VISION_TOTAL_IMAGE_CAP || String(LLM_PROMPT_IMAGE_LIMITS.MAX_PER_REQUEST), 10),
    /** 요청당 렌더 페이지 최대 수 (PDF 여러 개면 순서대로 예산 소진) */
    MAX_PAGES: parseInt(process.env.PDF_VISION_MAX_PAGES || '4', 10),
    /** 렌더 해상도 dpi — 문서 판독 라이브 실측(2026-08-19) 120 이면 충분, 상향은 비전 토큰 비례 증가 */
    DPI: parseInt(process.env.PDF_VISION_DPI || '120', 10),
    /**
     * 렌더 이미지 긴 변 픽셀 상한 — dpi 만으로는 판형이 큰 문서(대형 슬라이드·도면·포스터)에서
     * 초대형 이미지가 나온다. 실측(2026-08-20): A0급 스캔 슬라이드가 120dpi 에서 4134×5847px
     * (24MP)로 렌더돼 vision prefill 이 LiteLLM 소켓 읽기 타임아웃을 넘겨 요청 자체가 실패했다.
     * 예상 픽셀이 이 값을 넘으면 dpi 대신 pdftoppm -scale-to 로 긴 변을 맞춘다.
     */
    MAX_EDGE_PX: parseInt(process.env.PDF_VISION_MAX_EDGE_PX || '1600', 10),
    /** 렌더(pdftoppm)·페이지 수 조회(pdfinfo) 타임아웃 ms */
    RENDER_TIMEOUT_MS: parseInt(process.env.PDF_VISION_RENDER_TIMEOUT_MS || '20000', 10),
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
export function parseInjectLimit(raw: string | undefined, def: number): number {
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
    /**
     * 검색 쿼리 최대 글자 수 — 장문 프롬프트 전체가 웹검색 쿼리로 흘러가 provider URI 한도에
     * 걸리던 414(네이버 hub·Daum, 2026-08-21 라이브) 차단. 검색엔진 실효 질의는 앞부분 수십
     * 자로 충분하며, 초과분은 단어 경계에서 절단한다. 0 = 무제한.
     */
    QUERY_MAX_CHARS: parseInjectLimit(process.env.WEB_SEARCH_QUERY_MAX_CHARS, 200),
} as const;

/** 모델이 답변에 직접 쓴 출처 섹션의 인식 규칙 (services/chat-service/external-deterministic-append) */
export const MODEL_SOURCE_SECTION = {
    /** 평문 머리줄(`검색 결과 출처:`)에서 출처 라벨 앞에 올 수 있는 수식어의 최대 글자 수 — 넘으면 문장으로 본다 */
    LABEL_PREFIX_MAX_CHARS: 20,
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
/**
 * goal judge 증거 창에서 제외할 도구 — 결과가 ANSWER(terminate) 나 계획 스냅샷(plan_*) 과 중복이라
 * 마지막 N개 창을 차지하면 실제 수행 증거가 밀려난다. (goal-judge.ts buildJudgeToolEvidence)
 */
export const JUDGE_EVIDENCE_EXCLUDED_TOOLS: ReadonlySet<string> = new Set(['terminate', 'plan_create', 'plan_update', 'plan_view']);

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
// 도메인 카테고리 분류 (Discussion 보완 에이전트)
// ============================================

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

