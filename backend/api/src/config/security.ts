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

export type CsrfMode = 'off' | 'warn' | 'enforce';

export const CSRF_POLICY = {
    /** 쿠키 이름 (JS 읽기 가능, non-HttpOnly — Double-Submit Cookie 패턴 요건) */
    COOKIE_NAME: 'csrf_token',
    /** 요청 헤더 이름 (표준 convention) */
    HEADER_NAME: 'X-CSRF-Token',
    /** 토큰 바이트 수 (32바이트 = 256비트 → base64url 43자) */
    TOKEN_BYTES: 32,
    /** 쿠키 수명 (24시간 — 세션 길이와 비슷하게) */
    COOKIE_MAX_AGE_MS: 24 * 60 * 60 * 1000,
    /** 검증 스킵 HTTP 메서드 (RFC 9110 safe methods) */
    SAFE_METHODS: new Set(['GET', 'HEAD', 'OPTIONS']),
    /** 검증 스킵 경로 prefix (OAuth 콜백은 제3자 redirect, 자체 state 파라미터로 보호됨) */
    SKIP_PATHS: [
        '/api/auth/callback/',
        '/api/csrf-token',
    ] as const,
} as const;
