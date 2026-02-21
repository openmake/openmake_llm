/**
 * ============================================================
 * 애플리케이션 상수 중앙 관리
 * ============================================================
 * 모든 매직 넘버와 하드코딩된 값을 이곳에 정의합니다.
 */

// ============================================
// 파일 업로드 제한
// ============================================

/**
 * 파일 업로드 제한 설정
 *
 * 업로드 가능한 파일의 최대 크기와 허용 확장자를 정의합니다.
 * 문서(PDF, TXT 등)와 이미지(JPG, PNG 등) 확장자를 별도로 관리합니다.
 */
export const FILE_LIMITS = {
    /** 최대 파일 크기 (MB) */
    MAX_SIZE_MB: 100,
    /** 최대 파일 크기 (Bytes) */
    MAX_SIZE_BYTES: 100 * 1024 * 1024,
    /** 허용되는 문서 확장자 */
    ALLOWED_DOCUMENT_EXTENSIONS: ['.pdf', '.txt', '.doc', '.docx', '.md'],
    /** 허용되는 이미지 확장자 */
    ALLOWED_IMAGE_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.gif', '.webp']
} as const;

// ============================================
// Rate Limiting 설정
// ============================================

/**
 * Rate Limiting 설정
 *
 * API 엔드포인트별 요청 빈도 제한을 정의합니다.
 * 일반 API, 인증 API, 채팅 API 각각 독립적인 윈도우와 최대 요청 수를 가집니다.
 */
export const RATE_LIMITS = {
    /** 일반 API: 15분당 100 요청 */
    GENERAL: {
        windowMs: 15 * 60 * 1000,
        max: 100,
        message: { error: 'Too many requests. Please try again later.' }
    },
    /** 인증 API: 15분당 5 요청 */
    AUTH: {
        windowMs: 15 * 60 * 1000,
        max: 5,
        message: { error: 'Too many authentication attempts. Please try again later.' }
    },
    /** 채팅 API: 1분당 30 요청 */
    CHAT: {
        windowMs: 60 * 1000,
        max: 30,
        message: { error: 'Too many chat requests. Please slow down.' }
    }
} as const;

// ============================================
// 캐시 설정
// ============================================

/**
 * 인메모리 캐시 설정
 *
 * LRU 캐시의 기본 TTL과 최대 항목 수를 정의합니다.
 */
export const CACHE_CONFIG = {
    /** 기본 TTL (밀리초) - 30분 */
    DEFAULT_TTL_MS: 30 * 60 * 1000,
    /** 최대 캐시 항목 수 */
    MAX_SIZE: 1000
} as const;

// ============================================
// API 키 관리
// ============================================

/**
 * Cloud API Key 로테이션 설정
 *
 * API Key 실패 감지 및 자동 전환 정책을 정의합니다.
 * 429/401 에러 발생 시 다음 키로 전환하는 임계값과 쿨다운 시간을 관리합니다.
 */
export const API_KEY_CONFIG = {
    /** 실패 시 다음 키로 전환하기 전 최대 실패 횟수 */
    MAX_FAILURES_BEFORE_SWITCH: 2,
    /** 실패한 키 재시도까지 대기 시간 (밀리초) - 5분 */
    FAILURE_COOLDOWN_MS: 5 * 60 * 1000
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
export const AUTH_CONFIG = {
    /** 세션 정리 주기 (밀리초) - 24시간 */
    SESSION_CLEANUP_INTERVAL_MS: 24 * 60 * 60 * 1000,
    /** 액세스 토큰 만료 시간 - 15분 (보안 강화) */
    TOKEN_EXPIRY: '15m',
    /** 리프레시 토큰 만료 시간 - 7일 */
    REFRESH_TOKEN_EXPIRY: '7d',
    /** 액세스 토큰 쿠키 maxAge (밀리초) - 15분 */
    ACCESS_TOKEN_MAX_AGE_MS: 15 * 60 * 1000,
    /** 리프레시 토큰 쿠키 maxAge (밀리초) - 7일 */
    REFRESH_TOKEN_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000,
    /** 익명 세션 최대 유지 시간 (밀리초) - 30일 */
    ANON_SESSION_MAX_AGE_MS: 30 * 24 * 60 * 60 * 1000
} as const;

// ============================================
// LLM 모델 설정
// ============================================

/**
 * LLM 모델 기본 설정
 *
 * 기본 모델명과 모델별 최대 컨텍스트 길이(문자 수)를 정의합니다.
 * Gemini 모델은 일반 모델 대비 더 큰 컨텍스트 윈도우를 지원합니다.
 */
export const LLM_CONFIG = {
    /** 기본 모델 */
    DEFAULT_MODEL: 'gemini-3-flash-preview:cloud',
    /** Gemini 모델 최대 컨텍스트 길이 */
    GEMINI_MAX_CONTEXT_CHARS: 100000,
    /** 일반 모델 최대 컨텍스트 길이 */
    DEFAULT_MAX_CONTEXT_CHARS: 30000
} as const;

// ============================================
// 로깅 레벨
// ============================================

/**
 * 로깅 레벨 우선순위 매핑
 *
 * 숫자가 클수록 심각도가 높습니다. Winston 로거와 연동됩니다.
 */
export const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
} as const;

export type LogLevel = keyof typeof LOG_LEVELS;

// ============================================
// 외부 서비스 호스트
// ============================================

/**
 * Ollama Cloud API 호스트 URL
 *
 * :cloud 접미사 모델 사용 시 연결할 Ollama Cloud 서버 주소입니다.
 * client.ts, agent-loop.ts, multi-model-client.ts에서 공통 참조합니다.
 */
export const OLLAMA_CLOUD_HOST = 'https://ollama.com';

// ============================================
// 애플리케이션 메타 정보
// ============================================

/**
 * HTTP 요청 시 사용할 User-Agent 문자열
 *
 * GitHub API 등 외부 API 호출 시 식별자로 사용합니다.
 */
export const APP_USER_AGENT = 'OpenMake-AI';
