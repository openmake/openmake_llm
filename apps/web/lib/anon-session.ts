/**
 * Browser-scoped anonymous owner id for guest sessions.
 *
 * This is intentionally shared across guest conversations so the backend can
 * list and claim all anonymous sessions owned by the same browser profile.
 */
import { uuid } from "./local-id";

export function getAnonSessionId(): string {
  try {
    const KEY = "omk_anon_session";
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = uuid(); // 서버의 세션 이관(claim)은 UUID v4 형식만 받는다
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return `anon-${Date.now()}`;
  }
}

export function appendAnonSessionId(endpoint: string): string {
  const separator = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${separator}anonSessionId=${encodeURIComponent(getAnonSessionId())}`;
}
