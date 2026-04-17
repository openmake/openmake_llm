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

/**
 * Permissions-Policy 디렉티브 허용 범위 상수.
 * `()` = 전면 차단 / `(self)` = same-origin 문서만 허용 / `(self "https://x.com")` = 특정 origin 추가.
 *
 * 프론트 스캔 결과 실 사용 중인 powerful API는 `navigator.clipboard.writeText`만 확인됨.
 * 나머지는 XSS / iframe embed 시 공격면이 되므로 전면 차단.
 */
export const PERMISSIONS_POLICY = {
    DIRECTIVES: {
        // 센서·입력 장치
        'accelerometer': '()',
        'ambient-light-sensor': '()',
        'gyroscope': '()',
        'magnetometer': '()',
        'battery': '()',
        'gamepad': '()',
        // 미디어 캡처
        'camera': '()',
        'microphone': '()',
        'display-capture': '()',
        // 위치·웨이크락
        'geolocation': '()',
        'screen-wake-lock': '()',
        // 외부 연결
        'usb': '()',
        'midi': '()',
        'bluetooth': '()',
        'serial': '()',
        'hid': '()',
        // 결제·인증
        'payment': '()',
        'publickey-credentials-get': '()',
        'publickey-credentials-create': '()',
        // 미디어 재생
        'autoplay': '()',
        'encrypted-media': '()',
        'fullscreen': '()',
        'picture-in-picture': '()',
        // 기타
        'document-domain': '()',
        'sync-xhr': '()',
        'web-share': '()',
        'xr-spatial-tracking': '()',
        // 프라이버시 — Chrome FLoC/Topics (명시 차단)
        'interest-cohort': '()',
        'browsing-topics': '()',
        // 클립보드 — 복사 기능만 self 허용, 읽기는 차단
        'clipboard-read': '()',
        'clipboard-write': '(self)',
    } as const,
} as const;

/** Permissions-Policy 헤더 값 빌드 (정렬 안정성 위해 Object.entries 순서 유지) */
export function buildPermissionsPolicyHeader(): string {
    return Object.entries(PERMISSIONS_POLICY.DIRECTIVES)
        .map(([name, allowlist]) => `${name}=${allowlist}`)
        .join(', ');
}

/**
 * Stage 2-H3: 공용 Key-Value 저장소 정책 상수.
 * Rate limiter와 OAuth state의 키 네임스페이스·TTL 관리.
 * CLAUDE.md no-hardcoding policy에 따라 prefix/TTL을 리터럴 대신 명명 상수로.
 */
export const STORAGE_POLICY = {
    /** 다른 앱과 Redis DB 공유 시 네임스페이스 격리용 루트 prefix */
    KEY_PREFIX: 'omk:',
    /** Rate limiter sliding-window counter 키 prefix */
    RATE_LIMIT_PREFIX: 'rl:',
    /** OAuth state nonce 키 prefix */
    OAUTH_STATE_PREFIX: 'oauth:state:',
    /** OAuth state nonce 수명 — CSRF 검증 유효 기간 */
    OAUTH_STATE_TTL_MS: 10 * 60 * 1000,
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
