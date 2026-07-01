/**
 * @openmake/api-client — shared-types 계약을 사용하는 타입 안전 fetch 래퍼 (브라우저).
 *
 * apps/web 의 lib/api-client.ts 를 이 패키지로 대체해, 응답 타입을 @openmake/shared-types 로
 * 강제한다. credentials: 'include' + CSRF 자동(@openmake/config 의 CSRF 계약).
 *
 * 외부 LLM/DB 는 백엔드(apps/api)가 통제하므로, 이 클라이언트는 항상 /api 만 호출한다.
 */
import { CSRF, MUTATING_METHODS } from "@openmake/config";
import type { ApiResponse } from "@openmake/shared-types";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const escaped = name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1");
  const m = document.cookie.match(new RegExp("(?:^|; )" + escaped + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

async function ensureCsrf(): Promise<string | null> {
  let t = readCookie(CSRF.COOKIE_NAME);
  if (t) return t;
  try {
    await fetch(CSRF.TOKEN_ENDPOINT, { method: "GET", credentials: "include" });
    t = readCookie(CSRF.COOKIE_NAME);
  } catch {
    /* 토큰 없이 진행 */
  }
  return t;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export type ApiRequestOptions = RequestInit & {
  redirectOnUnauthorized?: boolean;
};

const MUTATING = new Set<string>(MUTATING_METHODS);

/** 401 자동 refresh 를 건너뛸 endpoint 목록 (무한루프 방지). */
const SKIP_REFRESH_ENDPOINTS = ["/api/auth/refresh", "/api/auth/login", "/api/auth/me"];

/**
 * Single-flight refresh: 동시에 401 이 난 여러 요청이 각자 /api/auth/refresh 를 호출하면
 * 서버 토큰 로테이션이 경합(첫 호출이 회전·기존 토큰 블랙리스트 → 나머지는 블랙리스트된
 * 토큰으로 401 → clearTokenCookie 로 세션 쿠키 wipe)해 세션이 죽는다.
 * 진행 중인 refresh 가 있으면 그 Promise 를 공유해 /refresh 가 단 1회만 나가도록 한다.
 */
let refreshInFlight: Promise<boolean> | null = null;

function refreshOnce(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch("/api/auth/refresh", { method: "POST", credentials: "include" })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function request<T>(endpoint: string, options: ApiRequestOptions = {}, _isRetry = false): Promise<T> {
  const { redirectOnUnauthorized = true, ...fetchOptions } = options;
  const method = (fetchOptions.method || "GET").toUpperCase();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((fetchOptions.headers as Record<string, string>) || {}),
  };
  if (fetchOptions.body instanceof FormData) delete headers["Content-Type"];
  if (MUTATING.has(method) && !headers[CSRF.HEADER_NAME]) {
    const token = await ensureCsrf();
    if (token) headers[CSRF.HEADER_NAME] = token;
  }
  const res = await fetch(endpoint, { ...fetchOptions, credentials: "include", headers });
  const text = await res.text();
  // 비-JSON 본문(예: 프록시/서버 기본 "Internal Server Error" 평문)에도 깨지지 않도록 방어.
  // 파싱 실패 시 json=null 로 두고, 아래 에러 분기에서 status 기반 메시지로 폴백한다.
  let json: ApiResponse<T> | T | null = null;
  if (text) {
    try {
      json = JSON.parse(text) as ApiResponse<T> | T;
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    // 401 자동 refresh: 재시도 아니고, 건너뛸 endpoint 가 아닌 경우에만 1회 시도.
    if (
      res.status === 401 &&
      !_isRetry &&
      !SKIP_REFRESH_ENDPOINTS.some((ep) => endpoint === ep || endpoint.startsWith(ep + "?"))
    ) {
      const refreshed = await refreshOnce();
      if (refreshed) {
        return request<T>(endpoint, options, true);
      }
      if (redirectOnUnauthorized && typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    const body = json as { error?: { message?: string }; message?: string } | null;
    throw new ApiError(res.status, body?.error?.message || body?.message || `요청 실패 (${res.status})`, json);
  }
  return json as T;
}

export const ApiClient = {
  get: <T>(endpoint: string, options: ApiRequestOptions = {}) =>
    request<T>(endpoint, { ...options, method: "GET" }),
  post: <T>(endpoint: string, body?: unknown, options: ApiRequestOptions = {}) =>
    request<T>(endpoint, {
      ...options,
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  put: <T>(endpoint: string, body?: unknown, options: ApiRequestOptions = {}) =>
    request<T>(endpoint, {
      ...options,
      method: "PUT",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  del: <T>(endpoint: string, options: ApiRequestOptions = {}) =>
    request<T>(endpoint, { ...options, method: "DELETE" }),
};
