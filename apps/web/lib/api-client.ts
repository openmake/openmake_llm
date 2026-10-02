/**
 * API Client — @openmake/api-client 로 일원화 (shared-types 계약 기반).
 *
 * 기존 자체 구현(credentials+CSRF fetch 래퍼)을 워크스페이스 패키지로 통합했다.
 * 호출처(21곳)는 그대로 `import { ApiClient } from "@/lib/api-client"` 를 쓰며,
 * 응답 타입은 @openmake/shared-types 의 ApiResponse 등으로 강제할 수 있다.
 */
export { ApiClient, ApiError } from "@openmake/api-client";
// SSE 등 ApiClient 로 처리 못 하는 직접 fetch 에서 CSRF 헤더 주입용(enforce 모드 대비).
export { csrfHeaders } from "@openmake/api-client";
// 401 인터셉트와 같은 single-flight refresh — 따로 fetch 하면 토큰 로테이션이 경합해 세션이 지워진다.
export { refreshOnce } from "@openmake/api-client";
