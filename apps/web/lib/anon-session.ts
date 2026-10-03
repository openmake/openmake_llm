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

/** 저장된 id 를 버리고 새 UUID 를 발급한다 — 예전 형식 id 의 게스트 대화를 계정으로 이관한 뒤에만 부른다. */
export function resetAnonSessionId(): void {
  try {
    localStorage.setItem("omk_anon_session", uuid());
  } catch {
    /* storage 불가 — 다음 로드에 다시 시도된다 */
  }
}

export function appendAnonSessionId(endpoint: string): string {
  const separator = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${separator}anonSessionId=${encodeURIComponent(getAnonSessionId())}`;
}
