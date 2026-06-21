/**
 * API Client — @openmake/api-client 로 일원화 (shared-types 계약 기반).
 *
 * 기존 자체 구현(credentials+CSRF fetch 래퍼)을 워크스페이스 패키지로 통합했다.
 * 호출처(21곳)는 그대로 `import { ApiClient } from "@/lib/api-client"` 를 쓰며,
 * 응답 타입은 @openmake/shared-types 의 ApiResponse 등으로 강제할 수 있다.
 */
export { ApiClient, ApiError } from "@openmake/api-client";
