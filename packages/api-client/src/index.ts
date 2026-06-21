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

const MUTATING = new Set<string>(MUTATING_METHODS);

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };
  if (options.body instanceof FormData) delete headers["Content-Type"];
  if (MUTATING.has(method) && !headers[CSRF.HEADER_NAME]) {
    const token = await ensureCsrf();
    if (token) headers[CSRF.HEADER_NAME] = token;
  }
  const res = await fetch(endpoint, { ...options, credentials: "include", headers });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as ApiResponse<T> | T) : null;
  if (!res.ok) {
    const body = json as { error?: { message?: string }; message?: string } | null;
    throw new ApiError(res.status, body?.error?.message || body?.message || `요청 실패 (${res.status})`, json);
  }
  return json as T;
}

export const ApiClient = {
  get: <T>(endpoint: string, options: RequestInit = {}) =>
    request<T>(endpoint, { ...options, method: "GET" }),
  post: <T>(endpoint: string, body?: unknown, options: RequestInit = {}) =>
    request<T>(endpoint, {
      ...options,
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  put: <T>(endpoint: string, body?: unknown, options: RequestInit = {}) =>
    request<T>(endpoint, {
      ...options,
      method: "PUT",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  del: <T>(endpoint: string, options: RequestInit = {}) =>
    request<T>(endpoint, { ...options, method: "DELETE" }),
};
