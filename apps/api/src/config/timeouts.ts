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
    /** 웹 스크래핑 기본 요청 타임아웃 (ms) */
    WEB_SCRAPE_TIMEOUT_MS: 30000,
    /** 키워드 라우터 LLM 호출 타임아웃 (ms) — ROUTING_TIMEOUT_MS보다 높음 */
    KEYWORD_ROUTING_TIMEOUT_MS: 10000,
    /** LLM 기반 쿼리 분류기 타임아웃 (ms) */
    CLASSIFIER_TIMEOUT_MS: 10000,
    /** fire-and-forget 메모리 추출 LLM 호출 타임아웃 (ms) */
    MEMORY_EXTRACTION_TIMEOUT_MS: 30000,
    /** Deep Research 주제 분해 타임아웃 (ms) */
    RESEARCH_DECOMPOSE_TIMEOUT_MS: 60000,
    /** Deep Research 추가정보 필요 판단 LLM 호출 타임아웃 (ms). env override: DEEP_RESEARCH_NEED_MORE_TIMEOUT_MS */
    RESEARCH_NEED_MORE_TIMEOUT_MS: Number(process.env.DEEP_RESEARCH_NEED_MORE_TIMEOUT_MS) || 30000,
    /** 웹 검색 프로바이더 개별 fetch 타임아웃 (ms) — timeout 부재 시 Promise.all 무한 hang 방지. env override: WEB_SEARCH_FETCH_TIMEOUT_MS */
    WEB_SEARCH_FETCH_TIMEOUT_MS: Number(process.env.WEB_SEARCH_FETCH_TIMEOUT_MS) || 12000,
    /** Deep Research 청크 합성 개별 타임아웃 (ms) — 전역 LLM_TIMEOUT과 독립 */
    SYNTHESIS_PER_CHUNK_TIMEOUT_MS: 120000,
    /** Deep Research 청크 병합 타임아웃 (ms) */
    SYNTHESIS_MERGE_TIMEOUT_MS: 180000,
    /**
     * Deep Research 최종 보고서 생성 타임아웃 (ms).
     * 대형 프롬프트(다수 소스)·장문 출력으로 전역 LLM_TIMEOUT보다 길어야 한다.
     * 보고서 생성 LLM 호출에 **전용 클라이언트의 SDK 타임아웃**으로 적용됨(report-generator).
     * env override: DEEP_RESEARCH_REPORT_TIMEOUT_MS. 기본 900000(15분) — 소스 축소(50)와 함께
     * 정식 LLM 보고서가 timeout 으로 잘려 fallback 되지 않도록 여유 확보(평소엔 거의 미사용).
     */
    REPORT_GENERATION_TIMEOUT_MS: Number(process.env.DEEP_RESEARCH_REPORT_TIMEOUT_MS) || 900000,
} as const;

// ============================================
// DB 연결 풀 타임아웃
// ============================================

/**
 * PostgreSQL 연결 풀 타임아웃 설정
 * unified-database.ts에서 참조
 */
export const DB_POOL_TIMEOUTS = {
    /** SQL statement 타임아웃 (ms) */
    STATEMENT_TIMEOUT_MS: Number(process.env.DB_STATEMENT_TIMEOUT_MS) || 30000,
    /** 유휴 클라이언트 타임아웃 (ms) */
    IDLE_TIMEOUT_MS: Number(process.env.DB_IDLE_TIMEOUT_MS) || 30000,
    /** 연결 획득 타임아웃 (ms) */
    CONNECTION_TIMEOUT_MS: Number(process.env.DB_CONNECTION_TIMEOUT_MS) || 10000,
    /** 헬스체크 ping 타임아웃 (ms) */
    HEALTH_PING_TIMEOUT_MS: Number(process.env.DB_HEALTH_PING_TIMEOUT_MS) || 2000,
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
    /**
     * WebSocket 프레임 최대 페이로드 (bytes). **0 = 무제한**(ws 는 maxPayload>0 일 때만 검사).
     * 파일/이미지 업로드 용량 제한을 두지 않기 위해 기본 0(무제한). 단, 무제한은 거대 프레임이
     * 서버 메모리를 한 번에 점유할 수 있으므로(OOM/DoS 여지), 운영상 상한이 필요하면
     * 환경변수 WS_MAX_PAYLOAD_BYTES 에 바이트 수를 지정해 재설정한다(예: 67108864=64MB).
     * 프론트 가드(chat.js WS_MAX_PAYLOAD_BYTES)도 0=무제한 sentinel 로 정합.
     */
    MAX_PAYLOAD_BYTES: process.env.WS_MAX_PAYLOAD_BYTES !== undefined ? Number(process.env.WS_MAX_PAYLOAD_BYTES) : 0,
    /**
     * 단일 메시지 문자열 최대 길이(chars). MAX_PAYLOAD_BYTES(0=무제한 sentinel)와 별개로,
     * 메시지 핸들러가 raw.length 로 거대 텍스트 프레임을 즉시 거부하는 가드. 기본 1MB(chars).
     */
    MAX_MESSAGE_CHARS: parseInt(process.env.WS_MAX_MESSAGE_CHARS || String(1024 * 1024), 10),
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
    /** 메시지 빈도 제한 윈도우 (ms) — 기본 10초 */
    MESSAGE_RATE_WINDOW_MS: Number(process.env.WS_MESSAGE_RATE_WINDOW_MS) || 10 * 1000,
    /** 윈도우 내 최대 메시지 수 — 기본 30개 */
    MESSAGE_RATE_MAX_PER_WINDOW: Number(process.env.WS_MESSAGE_RATE_MAX_PER_WINDOW) || 30,
    /**
     * Backpressure 임계 (bytes). bufferedAmount 가 이 값을 초과한 클라이언트는
     * broadcast 시 skip 됨 — 슬로우 클라이언트가 이벤트 루프/메모리 점유 방지.
     * 기본 1MB — 일반 cluster_event 메시지 (~수 KB) 수십 개가 큐에 쌓인 수준.
     */
    BROADCAST_BACKPRESSURE_THRESHOLD_BYTES: Number(process.env.WS_BROADCAST_BACKPRESSURE_THRESHOLD_BYTES) || 1 * 1024 * 1024,
    /**
     * 위 임계를 N회 연속 초과한 클라이언트는 강제 종료 (terminate). 0 = 종료 안 함.
     * 기본 5회 — 일시적 네트워크 spike 는 허용, 만성적 stall 은 정리.
     */
    BROADCAST_BACKPRESSURE_TERMINATE_AFTER: Number(process.env.WS_BROADCAST_BACKPRESSURE_TERMINATE_AFTER) || 5,
    /** artifact_chunk 스트리밍 throttle 윈도우(ms) — 토큰 단위 delta 를 합쳐 메시지 폭주 방지. */
    ARTIFACT_CHUNK_FLUSH_MS: parseInt(process.env.WS_ARTIFACT_CHUNK_FLUSH_MS || '50', 10),
} as const;

// ============================================
// MCP 외부 도구 실행 제한
// ============================================

export const MCP_EXTERNAL_TOOL_LIMITS = {
    /** 외부 도구 실행 타임아웃 (ms) — 30초 */
    EXECUTION_TIMEOUT_MS: Number(process.env.MCP_EXTERNAL_TOOL_TIMEOUT_MS) || 30_000,
    /** 외부 도구 출력 최대 크기 (bytes) — 1MB */
    MAX_OUTPUT_SIZE: Number(process.env.MCP_EXTERNAL_TOOL_MAX_OUTPUT_SIZE) || 1024 * 1024,
} as const;
