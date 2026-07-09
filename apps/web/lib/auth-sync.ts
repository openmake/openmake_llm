import type { ApiSuccess, MePayload } from "@openmake/shared-types";
import { ApiClient } from "./api-client";
import { getAnonSessionId } from "./anon-session";
import { useAppStore } from "./store";

/**
 * /api/auth/me 로 현재 로그인 사용자를 store 에 동기화하고 익명 세션을 이관.
 *
 * 앱 마운트(providers AuthSync)와 로그인 성공 직후(login 페이지) 양쪽에서 호출 —
 * router.push 는 remount 가 없어 마운트 시 1회 동기화만으로는 로그인 직후
 * 사이드바가 게스트로 남는다. 로그인 여부를 반환한다.
 */
export async function syncAuthFromServer(): Promise<boolean> {
  try {
    const res = await ApiClient.get<ApiSuccess<MePayload>>("/api/auth/me");
    const u = res?.data?.user;
    if (!u) return false;
    useAppStore.getState().setAuth({
      currentUser: {
        id: String(u.id),
        email: u.email,
        name: u.username,
        role: u.role ?? "user",
      },
      isGuestMode: false,
    });
    void ApiClient.post("/api/chat/sessions/claim", { anonSessionId: getAnonSessionId() }).catch(() => {
      /* 익명 세션이 없거나 이미 이관됨 */
    });
    // 개인정보 설정(saveHistory/memoryLearning)을 앱 마운트 시 store 에 로드 — 설정 페이지를
    // 방문하지 않아도 채팅 WS 메시지가 사용자의 저장/학습 설정을 존중하도록.
    void ApiClient.get<{ data: { preferences: Record<string, unknown> } }>("/api/users/me/preferences")
      .then((pres) => {
        const p = pres?.data?.preferences ?? {};
        const patch: { saveHistory?: boolean; memoryLearning?: boolean } = {};
        if (typeof p.saveHistory === "boolean") patch.saveHistory = p.saveHistory;
        if (typeof p.memoryLearning === "boolean") patch.memoryLearning = p.memoryLearning;
        if (Object.keys(patch).length > 0) useAppStore.getState().setPrivacyPrefs(patch);
      })
      .catch(() => {
        /* 미설정/실패 — 기본값(true) 유지 */
      });
    return true;
  } catch {
    /* 비로그인(401) — 게스트 유지 */
    return false;
  }
}
