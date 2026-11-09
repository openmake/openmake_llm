/**
 * 대화 공유(198) — 웹 공통 헬퍼. 판정은 서버가 한다; 여기는 오류 코드 → 안내 키, 로그인 복귀 경로만.
 */
import { CONVERSATION_SHARE_ERROR_CODES } from "@openmake/shared-types";
import { ApiError } from "@/lib/api-client";

/** 로그인 뒤 돌아올 수 있는 경로 — 같은 origin 의 공유 대화 페이지만(쿼리·토큰 없음). */
const SHARE_RETURN_PATH_RE = /^\/shared\/conversation\/[A-Za-z0-9-]{1,64}$/;

export function safeShareReturnPath(raw: string | null | undefined): string | null {
  return typeof raw === "string" && SHARE_RETURN_PATH_RE.test(raw) ? raw : null;
}

/** OAuth 로그인은 전체 페이지 이동이라 next 를 잃는다 — 클릭 때 보관하고 복귀 첫 화면에서 한 번 꺼낸다. */
const SHARE_RETURN_KEY = "omk:share-return-path";

export function rememberShareReturnPath(raw: string | null | undefined): void {
  const path = safeShareReturnPath(raw);
  if (!path) return;
  try {
    window.sessionStorage.setItem(SHARE_RETURN_KEY, path);
  } catch {
    /* storage 불가 — 복귀만 포기 */
  }
}

/** 꺼내면 지운다. 저장값은 변조될 수 있어 같은 규칙으로 다시 검증한다. */
export function takeShareReturnPath(): string | null {
  try {
    const raw = window.sessionStorage.getItem(SHARE_RETURN_KEY);
    window.sessionStorage.removeItem(SHARE_RETURN_KEY);
    return safeShareReturnPath(raw);
  } catch {
    return null;
  }
}

export function sharedConversationPath(shareId: string): string {
  return `/shared/conversation/${encodeURIComponent(shareId)}`;
}

/** 거절 화면의 로그인 이동 — 토큰은 싣지 않는다. */
export function shareLoginHref(shareId: string): string {
  const next = safeShareReturnPath(sharedConversationPath(shareId));
  return next ? `/login?next=${encodeURIComponent(next)}` : "/login";
}

export type ShareErrorKey = "stale" | "empty" | "tooLarge" | "notFound" | "generic";

export function shareErrorKey(err: unknown): ShareErrorKey {
  if (!(err instanceof ApiError)) return "generic";
  const code = (err.body as { error?: { code?: string } } | null)?.error?.code;
  if (code === CONVERSATION_SHARE_ERROR_CODES.PREVIEW_STALE || err.status === 409) return "stale";
  if (code === CONVERSATION_SHARE_ERROR_CODES.EMPTY) return "empty";
  if (code === CONVERSATION_SHARE_ERROR_CODES.TOO_LARGE) return "tooLarge";
  if (err.status === 404) return "notFound";
  return "generic";
}
