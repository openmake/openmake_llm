/**
 * ============================================================
 * 애플리케이션 상수 중앙 관리
 * ============================================================
 * 모든 매직 넘버와 하드코딩된 값을 이곳에 정의합니다.
 *
 * NOTE: 런타임 제한/타임아웃/가격은 다음 모듈로 이관됨:
 *   - config/runtime-limits.ts (컨텍스트, 토큰, 문서, 용량)
 *   - config/timeouts.ts (타임아웃, 주기, 서킷 브레이커)
 *   - config/pricing.ts (비용 추정)
 *   - config/external-services.ts (외부 URL)
 *   - config/model-defaults.ts (엔진/모델 프리셋)
 */

/**
 * 파일 업로드 제한 설정
 *
 * 업로드 가능한 파일의 최대 크기와 허용 확장자를 정의합니다.
 * 문서(PDF, TXT 등)와 이미지(JPG, PNG 등) 확장자를 별도로 관리합니다.
 */
export const FILE_LIMITS = {
    /** 최대 파일 크기 (MB) */
    MAX_SIZE_MB: 300,
    /** 최대 파일 크기 (Bytes) */
    MAX_SIZE_BYTES: 300 * 1024 * 1024,
    /** 허용되는 문서 확장자 (참고용 — 실제 업로드 제한은 validation.ts에서 관리) */
    ALLOWED_DOCUMENT_EXTENSIONS: ['.pdf', '.txt', '.doc', '.docx', '.md', '.csv', '.xlsx', '.xls', '.pptx', '.hwp', '.hwpx', '.json', '.xml', '.yaml', '.yml', '.log', '.rtf', '.odt'],
    /** 허용되는 이미지 확장자 (참고용 — 실제 업로드 제한은 validation.ts에서 관리) */
    ALLOWED_IMAGE_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.tiff', '.ico'],
    /** 허용되는 문서 MIME 타입 (참고용 — 실제 업로드 제한은 validation.ts에서 관리) */
    ALLOWED_DOCUMENT_MIME_TYPES: ['application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/xml', 'text/xml', 'application/rtf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/x-hwp', 'application/vnd.oasis.opendocument.text', 'text/yaml'],
    /** 허용되는 이미지 MIME 타입 (참고용 — 실제 업로드 제한은 validation.ts에서 관리) */
    ALLOWED_IMAGE_MIME_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/tiff', 'image/x-icon']
} as const;

// ============================================
// 서버 설정
// ============================================

/**
 * HTTP 서버 및 WebSocket 설정
 *
 * 기본 포트, 요청 타임아웃, WebSocket 하트비트 간격을 정의합니다.
 */
export const SERVER_CONFIG = {
    /** 기본 포트 */
    DEFAULT_PORT: 52416,
    /** 요청 타임아웃 (밀리초) */
    REQUEST_TIMEOUT_MS: 30 * 1000,
    /** WebSocket 하트비트 간격 (밀리초) */
    WS_HEARTBEAT_INTERVAL_MS: 30 * 1000
} as const;

// ============================================
// 세션 및 인증
// ============================================

/**
 * 인증 및 세션 관리 설정
 *
 * JWT 액세스/리프레시 토큰 만료 시간, 세션 정리 주기,
 * 익명 세션 최대 유지 시간을 정의합니다.
 */
// JWT + Cookie 만료 시간 단일 소스 (L4 보안 수정: 단위 혼용 방지)
const ACCESS_TOKEN_DURATION_MINUTES = 15;
const REFRESH_TOKEN_DURATION_DAYS = 7;

export const AUTH_CONFIG = {
    /** 세션 정리 주기 (밀리초) - 24시간 */
    SESSION_CLEANUP_INTERVAL_MS: 24 * 60 * 60 * 1000,
    /** 액세스 토큰 만료 시간 (JWT expiresIn 형식) */
    TOKEN_EXPIRY: `${ACCESS_TOKEN_DURATION_MINUTES}m`,
    /** 리프레시 토큰 만료 시간 (JWT expiresIn 형식) */
    REFRESH_TOKEN_EXPIRY: `${REFRESH_TOKEN_DURATION_DAYS}d`,
    /** 액세스 토큰 쿠키 maxAge (밀리초) — TOKEN_EXPIRY와 동일 소스 */
    ACCESS_TOKEN_MAX_AGE_MS: ACCESS_TOKEN_DURATION_MINUTES * 60 * 1000,
    /** 리프레시 토큰 쿠키 maxAge (밀리초) — REFRESH_TOKEN_EXPIRY와 동일 소스 */
    REFRESH_TOKEN_MAX_AGE_MS: REFRESH_TOKEN_DURATION_DAYS * 24 * 60 * 60 * 1000,
    /** 익명 세션 최대 유지 시간 (밀리초) - 30일 */
    ANON_SESSION_MAX_AGE_MS: 30 * 24 * 60 * 60 * 1000,
    /** 사용자당 최대 동시 활성 세션 수 */
    MAX_SESSIONS_PER_USER: 5
} as const;

// ============================================
// 애플리케이션 메타 정보
// ============================================

// eslint-disable-next-line @typescript-eslint/no-var-requires
const rootPkg = require('../../../../package.json') as { version: string };

/**
 * 애플리케이션 버전 (Single Source of Truth)
 *
 * 루트 package.json의 version 필드에서 읽어옵니다.
 * 버전을 변경할 때는 루트 package.json만 수정하면 됩니다.
 * CLI 배너, OpenTelemetry, API 응답 등 모든 곳에서 이 상수를 참조합니다.
 */
export const APP_VERSION: string = rootPkg.version;

/**
 * HTTP 요청 시 사용할 User-Agent 문자열
 *
 * GitHub API 등 외부 API 호출 시 식별자로 사용합니다.
 */
export const APP_USER_AGENT = 'OpenMake-AI';

// ============================================
// Skill Creator (Phase 1) feature flags
// ============================================

/**
 * Skill Creator (Phase 1) — 자연어 prompt → LLM → SKILL 매니페스트 → draft 워크플로
 * 의 런타임 설정 객체. `.env` 의 SKILL_* 변수를 named constant 로 외부화.
 *
 * 사용 위치:
 *   - skills.routes.ts: /auto-create 진입 가드 (enabled, userTierEnabled)
 *   - skill-creator.ts: LLM 모델 / fallback / draft 상한 (authorModel/authorFallback/maxDraftsPerUser)
 *   - cleanup 스크립트 (예정): draftTtlDays
 */
export const SKILL_CREATOR = {
    enabled: process.env.SKILL_CREATOR_ENABLED !== 'false',
    userTierEnabled: process.env.SKILL_CREATOR_USER_TIER_ENABLED !== 'false',
    authorModel: process.env.SKILL_AUTHOR_MODEL || '',
    authorFallback: process.env.SKILL_AUTHOR_FALLBACK === 'true',
    draftTtlDays: parseInt(process.env.SKILL_DRAFT_TTL_DAYS || '30', 10),
    maxDraftsPerUser: parseInt(process.env.SKILL_AUTO_CREATE_MAX_DRAFTS_PER_USER || '50', 10),
} as const;

// ============================================
// 모델 선택
// ============================================

// 모델 식별은 `getModelForRole('chat')` 또는 `getConfig().llmDefaultModel` 사용.
