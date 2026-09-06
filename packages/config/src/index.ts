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

/** 아티팩트 코드 실행 가능성 판정 (샌드박스 표준 라이브러리 기준). */
export { checkRunnable, type RunnableVerdict } from "./artifact-runnable";

/**
 * 자격증명 파일 글롭 — 코드 탐색 제외(grep_code·repo_map)와 쓰기 승인 상향(approval-gate)의
 * **단일 출처**. 서버(apps/api)와 디바이스 코어(local-bridge-core) 양쪽이 여기서 읽는다 — 목록을
 * 두 곳에 복제하면 한쪽만 고쳐져 제외가 조용히 약해진다(2026-09-07 코드 리뷰 지적).
 * 파일명(basename) 글롭이며 디렉토리 이름에도 적용된다: rg -g · grep --exclude/--exclude-dir ·
 * find -name 에 그대로 쓰이고, 디바이스는 같은 글롭을 정규식으로 매칭한다.
 */
export const SENSITIVE_FILE_PATTERNS: readonly string[] = [
  ".env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx", "*.jks", "*.keystore",
  "id_rsa", "id_rsa.*", "id_ed25519", "id_ed25519.*", ".npmrc", ".netrc", ".pgpass", ".htpasswd",
  "credentials", "credentials.*", "service-account*.json", "*.kdbx",
];
