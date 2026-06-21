/**
 * @openmake/config — 프론트(apps/web) ↔ 백엔드(apps/api) 공통 상수·계약.
 * 외부 분리 서버(vLLM/LiteLLM, DB)는 각자 env 로 주입하므로 여기 포함하지 않는다.
 */

/** CSRF Double-Submit Cookie 계약 (backend config/security 와 1:1). */
export const CSRF = {
  COOKIE_NAME: "csrf_token",
  HEADER_NAME: "X-CSRF-Token",
  TOKEN_ENDPOINT: "/api/csrf-token",
} as const;

/** 인증 쿠키 이름. */
export const AUTH = {
  COOKIE_NAME: "auth_token",
  REFRESH_COOKIE_NAME: "refresh_token",
} as const;

/** 기본 포트 (개발). 운영은 Nginx 단일 도메인. */
export const PORTS = {
  WEB: 3000, // apps/web (Next)
  API: 52416, // apps/api (Express)
  POSTGRES: 5432, // docker (외부 분리)
  REDIS: 6379, // docker (외부 분리)
} as const;

/** 변경(mutating) 메서드 — CSRF 헤더 주입 대상. */
export const MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;
