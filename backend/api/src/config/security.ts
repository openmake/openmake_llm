/**
 * ============================================================
 * Security Config - 보안 관련 상수 중앙 관리 (L2 Config 계층)
 * ============================================================
 * CLAUDE.md No-Hardcoding Policy에 따라 보안 임계값·정책을
 * 인라인 리터럴 대신 명명 상수로 정의합니다.
 *
 * @module config/security
 */

export const SSRF_LIMITS = {
    /** safeFetch redirect chain 최대 허용 횟수 */
    MAX_REDIRECTS: 5,
    /** 외부 요청 기본 타임아웃 (ms) */
    REQUEST_TIMEOUT_MS: 30_000,
} as const;

export type BlacklistFailMode = 'open' | 'safe';

export const BLACKLIST_POLICY = {
    /** 기본값: 기존 동작 유지 (가용성 우선) — additive 변경 */
    DEFAULT_FAIL_MODE: 'open' as BlacklistFailMode,
} as const;

export const WS_SECURITY = {
    /** 연결 거부 시 표준 WebSocket close code (Policy Violation) */
    ORIGIN_REJECTED_CLOSE_CODE: 1008,
    /** close frame reason phrase */
    ORIGIN_REJECTED_REASON: 'origin_rejected',
} as const;

export const COOKIE_POLICY = {
    /** production 환경에서 cookieSecure=false 허용 여부 */
    ALLOW_INSECURE_IN_PRODUCTION: false,
} as const;
