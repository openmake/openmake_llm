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
// access 토큰 수명은 env override 가능 (기본 15분은 WS 미-refresh 환경에서 잦은 만료를 유발 →
// ACCESS_TOKEN_MINUTES 로 연장 가능). refresh 토큰은 7일 유지.
// 양의 유한수만 허용 — 0·음수·NaN 은 기본값으로 폴백 (예: "-5m" 만료로 즉시 만료된 토큰이 발급되는 것을 방지).
const positiveEnvNumber = (raw: string | undefined, fallback: number): number => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};
const ACCESS_TOKEN_DURATION_MINUTES = positiveEnvNumber(process.env.ACCESS_TOKEN_MINUTES, 15);
const REFRESH_TOKEN_DURATION_DAYS = positiveEnvNumber(process.env.REFRESH_TOKEN_DAYS, 7);

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
    // E2E test seam — true 면 LLM 호출 우회, 결정론적 mock 매니페스트 반환.
    // 운영 환경에서는 절대 true 설정 금지 (보안 + 데이터 무결성).
    authorMock: process.env.SKILL_AUTHOR_MOCK === 'true',
    // 중복 draft 제거 윈도우 — 동일 소스 재-ingest 시 N시간 내 중복 차단 (skill/agent/git ingest 공용)
    dedupeWindowHours: parseInt(process.env.SKILL_CREATOR_DEDUPE_WINDOW_HOURS || '24', 10),
    // Git URL ingest (Phase 2) — POST /api/agents/skills/import-from-git
    gitIngestEnabled: process.env.SKILL_CREATOR_GIT_INGEST_ENABLED !== 'false',
    gitFetchTimeout: parseInt(process.env.SKILL_CREATOR_GIT_FETCH_TIMEOUT_MS || '30000', 10),
    gitMaxFileSize: parseInt(process.env.SKILL_CREATOR_GIT_MAX_FILE_SIZE || '262144', 10),
    gitMaxFilesPerRepo: parseInt(process.env.SKILL_CREATOR_GIT_MAX_FILES_PER_REPO || '50', 10),
    // tree(전체 blob) 엔트리 상한 — monorepo 등 거대 repo 의 JSON 파싱·스캔 DoS 방어용.
    // gitMaxFilesPerRepo(처리 파일 수)와 별개로 listTree 단계에서 강제.
    gitMaxTreeEntries: parseInt(process.env.SKILL_CREATOR_GIT_MAX_TREE_ENTRIES || '10000', 10),
} as const;

/**
 * Agent Creator (Phase 3) — Git URL → AGENT.md → draft 워크플로 의 런타임 설정.
 */
export const AGENT_CREATOR = {
    enabled: process.env.AGENT_CREATOR_ENABLED !== 'false',
    userTierEnabled: process.env.AGENT_CREATOR_USER_TIER_ENABLED !== 'false',
    gitIngestEnabled: process.env.AGENT_CREATOR_GIT_INGEST_ENABLED !== 'false',
    maxDraftsPerUser: parseInt(process.env.AGENT_CREATOR_MAX_DRAFTS_PER_USER || '20', 10),
} as const;

// ============================================================
// MCP_INGEST — Phase 4 MCP server manifest ingest 설정
// ============================================================

interface RiskyCommandRule {
    severity: 'error' | 'warn';
    rule: string;
    pattern: RegExp;
    message: string;
}

/**
 * MCP_INGEST — MCPSERVER.md Git ingest 파이프라인 설정.
 *
 * 환경변수 오버라이드:
 *   - MCP_INGEST_ENABLED=false           (기본 true)
 *   - MCP_INGEST_MAX_DRAFTS_PER_USER=20  (기본 20)
 *   - MCP_INGEST_DEDUPE_HOURS=24         (기본 24)
 *   - MCP_INGEST_FETCH_TIMEOUT_MS=15000  (기본 15000)
 *   - MCP_INGEST_MAX_FILE_SIZE_BYTES=262144 (기본 256KB)
 *   - MCP_INGEST_ADMIN_GLOBAL=true       (기본 true — admin 만 global 등록 허용)
 *
 * riskyCommandPatterns 는 ConventionChecker 가 command/args 검사 시 적용.
 *   severity='error' → 자동 승인 차단
 *   severity='warn'  → 경고만 (사용자가 명시 동의로 진행 가능)
 */
export const MCP_INGEST = {
    enabled: process.env.MCP_INGEST_ENABLED !== 'false',
    maxDraftsPerUser: parseInt(process.env.MCP_INGEST_MAX_DRAFTS_PER_USER || '20', 10),
    dedupeWindowHours: parseInt(process.env.MCP_INGEST_DEDUPE_HOURS || '24', 10),
    gitFetchTimeoutMs: parseInt(process.env.MCP_INGEST_FETCH_TIMEOUT_MS || '15000', 10),
    gitMaxFileSizeBytes: parseInt(process.env.MCP_INGEST_MAX_FILE_SIZE_BYTES || '262144', 10),
    adminCanRegisterGlobal: process.env.MCP_INGEST_ADMIN_GLOBAL !== 'false',

    riskyCommandPatterns: [
        {
            severity: 'error',
            rule: 'shell-pipe-execution',
            pattern: /curl\s+[^|]+\|\s*(sh|bash|zsh)/i,
            message: 'curl | sh 패턴 — 원격 스크립트를 검증 없이 실행하는 위험',
        },
        {
            severity: 'error',
            rule: 'wget-pipe-execution',
            pattern: /wget\s+[^|]+\|\s*(sh|bash|zsh)/i,
            message: 'wget | sh 패턴 — 원격 스크립트를 검증 없이 실행하는 위험',
        },
        {
            severity: 'error',
            rule: 'rm-rf-root',
            pattern: /rm\s+-rf?\s+(\/|~|\$HOME)/,
            message: 'rm -rf / 또는 홈 디렉토리 삭제 시도',
        },
        {
            severity: 'error',
            rule: 'sensitive-file-read',
            pattern: /\/(etc\/passwd|etc\/shadow|etc\/sudoers)|~\/\.ssh\/|~\/\.aws\/credentials/,
            message: '시스템 자격증명/비밀 파일 접근 시도',
        },
        {
            severity: 'error',
            rule: 'base64-exec',
            pattern: /base64\s+(-d|--decode)[^|]*\|\s*(sh|bash|zsh|python|node)/i,
            message: 'base64 디코드 후 즉시 실행 — 난독화된 코드 실행',
        },
        {
            severity: 'warn',
            rule: 'absolute-tmp-binary',
            pattern: /^\/(tmp|var\/tmp)\//,
            message: '/tmp 또는 /var/tmp 경로의 바이너리 실행 — 사용자가 의도한 것인지 확인',
        },
        {
            severity: 'warn',
            rule: 'unverified-npm-scope',
            pattern: /@[a-z0-9_-]{1,5}\//,
            message: '짧은 npm 스코프 — typosquat 가능성 (예: @aws 대신 @aws- 같은 가짜 패키지)',
        },
    ] as RiskyCommandRule[],
};

// ============================================
// 모델 선택
// ============================================

// 모델 식별은 `getModelForRole('chat')` 또는 `getConfig().llmDefaultModel` 사용.
