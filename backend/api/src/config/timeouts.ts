/**
 * ============================================================
 * 타임아웃 및 주기 상수 중앙 관리
 * ============================================================
 * setTimeout, setInterval, 스크래핑 타임아웃, 정리 주기,
 * 서킷 브레이커 관련 시간 값을 정의합니다.
 *
 * @module config/timeouts
 */

// ============================================
// LLM / Agent 타임아웃
// ============================================

/**
 * LLM 호출 및 에이전트 관련 타임아웃
 */
export const LLM_TIMEOUTS = {
    /** LLM 라우터 응답 대기 타임아웃 (ms) */
    ROUTING_TIMEOUT_MS: 5000,
    /** Deep Research 개별 스크래핑 타임아웃 (ms) */
    SCRAPE_TIMEOUT_MS: 15000,
    /** Firecrawl 기본 요청 타임아웃 (ms) */
    FIRECRAWL_TIMEOUT_MS: 30000,
    /** 키워드 라우터 LLM 호출 타임아웃 (ms) — ROUTING_TIMEOUT_MS보다 높음 */
    KEYWORD_ROUTING_TIMEOUT_MS: 10000,
    /** LLM 기반 쿼리 분류기 타임아웃 (ms) */
    CLASSIFIER_TIMEOUT_MS: 10000,
    /** fire-and-forget 메모리 추출 LLM 호출 타임아웃 (ms) */
    MEMORY_EXTRACTION_TIMEOUT_MS: 30000,
} as const;

// ============================================
// 정리(Cleanup) 주기
// ============================================

/**
 * 백그라운드 정리 스케줄러 주기
 */
export const CLEANUP_INTERVALS = {
    /** 문서 스토어 정리 주기 (ms) — 10분 */
    DOCUMENT_STORE_MS: 10 * 60 * 1000,
    /** OAuth state 정리 주기 (ms) — 5분 */
    OAUTH_STATE_MS: 5 * 60 * 1000,
    /** Deep Research 세션 정리 대기 (ms) — 5분 */
    RESEARCH_SESSION_MS: 5 * 60 * 1000,
    /** Analytics 세션 정리 주기 (ms) — 1시간 */
    ANALYTICS_SESSION_MS: 60 * 60 * 1000,
    /** 토큰 정리 초기 지연 (ms) — 5초 */
    TOKEN_CLEANUP_DELAY_MS: 5 * 1000,
    /** 토큰 정리 반복 주기 (ms) — 1시간 */
    TOKEN_CLEANUP_INTERVAL_MS: 60 * 60 * 1000,
} as const;

// ============================================
// 서킷 브레이커 기본값
// ============================================

/**
 * 서킷 브레이커 기본 설정값
 * cluster/circuit-breaker.ts에서 참조
 */
export const CIRCUIT_BREAKER_DEFAULTS = {
    /** 실패 임계값 (OPEN 전환까지 허용 실패 횟수) */
    FAILURE_THRESHOLD: 5,
    /** OPEN 상태 유지 시간 후 HALF_OPEN 전환 (ms) */
    RESET_TIMEOUT_MS: 30000,
    /** HALF_OPEN 상태에서 허용할 최대 시도 횟수 */
    HALF_OPEN_MAX_ATTEMPTS: 2,
    /** 실패율 모니터링 윈도우 (ms) */
    MONITOR_WINDOW_MS: 60000,
} as const;

// ============================================
// 연결 풀 타임아웃
// ============================================

/**
 * Ollama 연결 풀 관련 타임아웃
 */
export const CONNECTION_POOL_TIMEOUTS = {
    /** 연결 요청 타임아웃 (ms) */
    REQUEST_TIMEOUT_MS: 30000,
    /** 헬스체크 주기 (ms) — 30초 */
    HEALTH_CHECK_INTERVAL_MS: 30000,
    /** 유휴 연결 최대 허용 시간 (ms) — 1분 */
    MAX_IDLE_TIME_MS: 60000,
    /** 연결 획득 대기 타임아웃 (ms) */
    ACQUIRE_TIMEOUT_MS: 5000,
    /** 개별 헬스체크 요청 타임아웃 (ms) */
    HEALTH_CHECK_TIMEOUT_MS: 5000,
} as const;

// ============================================
// 쿼터 관련 재시도 시간
// ============================================

/**
 * API 쿼터 초과 시 재시도 대기 시간 (초)
 */
export const QUOTA_RETRY_AFTER = {
    /** 시간당 쿼터 초과 시 재시도 대기 (초) — 1시간 */
    HOURLY_SECONDS: 3600,
    /** 일일 쿼터 초과 시 재시도 대기 (초) — 24시간 */
    DAILY_SECONDS: 86400,
} as const;

// ============================================
// 모니터링 임계값
// ============================================

/**
 * 알림 시스템 기본 임계값
 */
export const ALERT_THRESHOLDS = {
    /** 응답 시간 경고 임계값 (ms) */
    RESPONSE_TIME_MS: 5000,
    /** 에러율 경고 임계값 (%) */
    ERROR_RATE_DEGRADED_PERCENT: 5,
    /** Analytics 24시간 윈도우 (ms) */
    ANALYTICS_24H_MS: 24 * 60 * 60 * 1000,
} as const;

// ============================================
// WebSocket 타임아웃
// ============================================

/**
 * WebSocket 연결 관련 타임아웃
 */
export const WEBSOCKET_TIMEOUTS = {
    /** 하트비트 주기 (ms) — 30초 */
    HEARTBEAT_INTERVAL_MS: 30000,
} as const;

// ============================================
// WebSocket 연결 제한
// ============================================

/**
 * WebSocket 연결 수, 속도 제한, 인증 관련 상수
 * sockets/handler.ts에서 참조
 */
export const WS_LIMITS = {
    /** 사용자당 최대 동시 WebSocket 연결 수 */
    MAX_CONNECTIONS_PER_USER: Number(process.env.WS_MAX_CONNECTIONS_PER_USER) || 5,
    /** 연결 속도 제한 윈도우 (ms) — 기본 60초 */
    CONNECTION_RATE_WINDOW_MS: Number(process.env.WS_CONNECTION_RATE_WINDOW_MS) || 60 * 1000,
    /** IP당 윈도우 내 최대 연결 시도 수 */
    CONNECTION_RATE_MAX_PER_IP: Number(process.env.WS_CONNECTION_RATE_MAX_PER_IP) || 30,
    /** 사용자당 윈도우 내 최대 연결 시도 수 */
    CONNECTION_RATE_MAX_PER_USER: Number(process.env.WS_CONNECTION_RATE_MAX_PER_USER) || 15,
    /** 인증 토큰 만료 경고 윈도우 (ms) — 기본 2분 */
    AUTH_EXPIRY_WARNING_WINDOW_MS: Number(process.env.WS_AUTH_EXPIRY_WARNING_WINDOW_MS) || 2 * 60 * 1000,
    /** 토큰 만료 경고 중복 방지 쿨다운 (ms) — 기본 60초 */
    AUTH_EXPIRY_WARNING_COOLDOWN_MS: Number(process.env.WS_AUTH_EXPIRY_WARNING_COOLDOWN_MS) || 60 * 1000,
} as const;
