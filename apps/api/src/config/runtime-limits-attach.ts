/**
 * 런타임 제한값 — 채팅 파일 첨부·문서 추출, 프롬프트 이미지·PDF vision, URL 사전 분석, 첨부 컨텍스트 캐시.
 * 공개 진입점은 config/runtime-limits(이 파일을 re-export) — 소비처는 그쪽에서 import 한다.
 *
 * @module config/runtime-limits-attach
 */

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
    /** 주소 형태 이미지 입력을 서버가 받을 때 타임아웃(ms) — chat/inbound-images */
    IMAGE_URL_FETCH_TIMEOUT_MS: parseInt(process.env.FILE_ATTACH_IMAGE_URL_FETCH_TIMEOUT_MS || '15000', 10),
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
