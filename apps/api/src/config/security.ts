/**
 * ============================================================
 * Security Config - 보안 관련 상수 중앙 관리 (L2 Config 계층)
 * ============================================================
 * CLAUDE.md No-Hardcoding Policy에 따라 보안 임계값·정책을
 * 인라인 리터럴 대신 명명 상수로 정의합니다.
 *
 * @module config/security
 */

// 프론트(@openmake/api-client)와 공유하는 계약은 @openmake/config 가 단일 정의처다.
// 종전엔 같은 리터럴을 양쪽에 손으로 복사하고 주석으로 "1:1" 이라 적어 두었을 뿐이라,
// 한쪽만 바꾸면 CSRF 검증이 조용히 실패했다(컴파일·테스트에 걸리지 않음).
import { CSRF, AUTH } from '@openmake/config';

export const SSRF_LIMITS = {
    /** safeFetch redirect chain 최대 허용 횟수 */
    MAX_REDIRECTS: 5,
    /** 외부 요청 기본 타임아웃 (ms) */
    REQUEST_TIMEOUT_MS: 30_000,
} as const;

export const WS_SECURITY = {
    /** 연결 거부 시 표준 WebSocket close code (Policy Violation) */
    ORIGIN_REJECTED_CLOSE_CODE: 1008,
    /** close frame reason phrase */
    ORIGIN_REJECTED_REASON: 'origin_rejected',
} as const;

/**
 * HSTS (Strict-Transport-Security) 정책 상수.
 * helmet 기본 180일보다 길게 설정 — OWASP 권장은 최소 1년.
 * preload는 되돌리기 어려운 단방향 티켓이라 조직 정책 결정 전까지 미포함.
 */
export const HSTS_POLICY = {
    /** max-age — 2년 (초 단위) */
    MAX_AGE_SECONDS: 2 * 365 * 24 * 60 * 60,
    /** includeSubDomains 활성 */
    INCLUDE_SUBDOMAINS: true,
    /** Chrome HSTS preload list 등록 여부 (false = 롤백 가능 상태 유지) */
    PRELOAD: false,
} as const;

/**
 * Rate limiter counter 저장 정책.
 */
export const RATE_LIMIT_POLICY = {
    /** counter TTL = windowMs * 이 배수. sliding window의 이전 window까지 커버하려면 2 이상 필요 */
    TTL_WINDOW_MULTIPLIER: 2,
    /** Admin은 일반 사용자 limit × 이 배수까지 허용 (완전 우회 방지) */
    ADMIN_MULTIPLIER: 5,
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
        // 'ambient-light-sensor' / 'battery' 제거: Chrome 등 모던 브라우저가
        // Permissions-Policy 표준에서 제거 → "Unrecognized feature" 경고 회피
        'accelerometer': '()',
        'gyroscope': '()',
        'magnetometer': '()',
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
        // 'document-domain' 제거: Chrome 109+ 에서 Permissions-Policy 표준 제외
        // → "Unrecognized feature" 경고 회피
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

export const CSRF_POLICY = {
    /** 쿠키 이름 (JS 읽기 가능, non-HttpOnly — Double-Submit Cookie 패턴 요건) */
    COOKIE_NAME: CSRF.COOKIE_NAME,
    /** 요청 헤더 이름 (표준 convention) */
    HEADER_NAME: CSRF.HEADER_NAME,
    /** 토큰 바이트 수 (32바이트 = 256비트 → base64url 43자) */
    TOKEN_BYTES: 32,
    /** 쿠키 수명 (24시간 — 세션 길이와 비슷하게) */
    COOKIE_MAX_AGE_MS: 24 * 60 * 60 * 1000,
    /** 검증 스킵 HTTP 메서드 (RFC 9110 safe methods) */
    SAFE_METHODS: new Set(['GET', 'HEAD', 'OPTIONS']),
    /** 검증 스킵 경로 prefix (OAuth 콜백은 제3자 redirect, 자체 state 파라미터로 보호됨) */
    SKIP_PATHS: [
        '/api/auth/callback/',
        CSRF.TOKEN_ENDPOINT,
    ] as const,
    /** 쿠키 옵션 — JS 읽기 가능해야 Double-Submit 패턴 성립 (httpOnly:false 필수) */
    COOKIE_OPTIONS: {
        /** SameSite 정책: Strict = cross-site 전혀 전송 안 함 (Double-Submit 패턴과 시너지) */
        SAME_SITE: 'strict' as const,
        /** 쿠키 적용 path — 앱 전체 */
        PATH: '/',
    },
} as const;

/**
 * 인증 쿠키 이름 — 발급(res.cookie)과 판독(req.cookies)이 반드시 같은 값을 써야 하므로
 * 리터럴을 흩뿌리지 않고 여기서만 노출한다. 이름 자체는 @openmake/config 가 SoT.
 */
export const AUTH_COOKIES = {
    /** 액세스 토큰 (HttpOnly) */
    ACCESS: AUTH.COOKIE_NAME,
    /** 리프레시 토큰 (HttpOnly, path=/api/auth/refresh) */
    REFRESH: AUTH.REFRESH_COOKIE_NAME,
} as const;

/**
 * 모바일 인증 (iOS 축 2) — OAuth exchange code 흐름.
 *
 * ASWebAuthenticationSession 은 앱 URLSession 과 쿠키 저장소가 분리되어 쿠키로는
 * 토큰이 앱에 도달하지 못한다. 콜백에서 단명 일회성 코드를 app scheme 으로 전달하고
 * `POST /api/auth/mobile/exchange` 에서 토큰으로 교환한다. app scheme URL 은 로그·타 앱
 * 가로채기에 노출될 수 있어 refresh token 을 직접 싣지 않는다.
 */
export const MOBILE_AUTH = {
    /** 앱 URL scheme — iOS Xcode URL Types 와 동일해야 함 */
    APP_SCHEME: process.env.MOBILE_APP_SCHEME || 'openmake',
    /** scheme 뒤 콜백 경로 — `openmake://auth/callback?code=...` */
    CALLBACK_HOST_PATH: 'auth/callback',
    /** exchange code 만료 (ms, 기본 60초) */
    EXCHANGE_CODE_TTL_MS: Number(process.env.MOBILE_EXCHANGE_CODE_TTL_MS) || 60 * 1000,
    /** KVStore 키 prefix */
    EXCHANGE_KEY_PREFIX: 'mobile_exchange:',
    /** code 엔트로피 (bytes → hex 2배 길이) */
    EXCHANGE_CODE_BYTES: 32,
    /** 허용 클라이언트 식별자 화이트리스트 (`?client=`) */
    ALLOWED_CLIENTS: ['ios'],
} as const;

/**
 * 웹 SSO 클라이언트 (다른 호스트명의 자매 서비스가 openmake 로그인을 그대로 쓰는 경우)
 *
 * 쿠키는 호스트 단위라 bench.openmake.cc 같은 별도 오리진은 chat.openmake.cc 의 세션 쿠키를
 * 받지 못한다. 대신 `GET /api/auth/sso/authorize?client=<id>` 가 로그인된 사용자에게 일회성
 * exchange code(MOBILE_AUTH 와 같은 저장소·TTL)를 발급해 등록된 redirect URI 로 보내고,
 * 클라이언트 서버가 `POST /api/auth/mobile/exchange` 로 교환한다. redirect URI 는 여기 등록된
 * 값만 쓰며 요청 파라미터로 받지 않는다 (open redirect 차단).
 */
export const SSO_CLIENTS: Readonly<Record<string, { redirectUri: string }>> = {
    bench: { redirectUri: process.env.SSO_BENCH_REDIRECT_URI || 'https://bench.openmake.cc/api/auth/callback' },
};
