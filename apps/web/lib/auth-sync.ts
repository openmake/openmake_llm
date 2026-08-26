import type { ApiSuccess, MePayload } from "@openmake/shared-types";
import { ApiClient, ApiError, csrfHeaders } from "./api-client";
import { getAnonSessionId } from "./anon-session";
import { flushOAuthLoginPending, gaSetVisitor } from "./analytics";
import { useAppStore } from "./store";

/**
 * "이 브라우저에서 로그인한 적 있음" 흔적 — 만료된 auth_token 쿠키는 브라우저가 purge 해
 * /api/auth/me 가 401 이 아닌 200(게스트)로 오고, 401 트리거가 없어 자동 refresh 가 돌지
 * 않는다(2026-08-15 실측: 앱 재시작 후 refresh_token 이 살아 있는데 게스트로 표시). 이
 * 흔적이 있을 때만 마운트 동기화에서 refresh 를 1회 선시도한다 — 순수 게스트는 흔적이
 * 없어 불필요한 refresh 요청이 나가지 않는다.
 */
const HAD_SESSION_KEY = "omk_had_session";

function hadSession(): boolean {
  try { return localStorage.getItem(HAD_SESSION_KEY) === "1"; } catch { return false; }
}

function markHadSession(): void {
  try { localStorage.setItem(HAD_SESSION_KEY, "1"); } catch { /* storage 불가 — 선시도만 포기 */ }
}

/** 로그아웃/refresh 실패(세션 수명 종료) 시 흔적 제거 — 다음 마운트의 헛 refresh 방지. */
export function clearHadSession(): void {
  try { localStorage.removeItem(HAD_SESSION_KEY); } catch { /* noop */ }
}

/** refresh 1회 시도(CSRF 이중제출 포함) — 성공 시 새 auth_token 쿠키가 심긴다. */
async function tryRefresh(): Promise<boolean> {
  try {
    const headers = await csrfHeaders();
    const r = await fetch("/api/auth/refresh", { method: "POST", credentials: "include", headers });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * ⚠️ `redirectOnUnauthorized: false` 필수 — 이건 "누구세요"를 묻는 **탐침**이지 사용자가
 * 요청한 동작이 아니다. 기본값(리다이렉트)이면 만료 쿠키를 가진 방문자가 **공개 페이지**
 * (`/shared/task/...`)를 열 때 로그인 화면으로 튕긴다(2026-08-26 실측 — 한 번 로그인한 적
 * 있는 동료에게 공유 링크가 안 열렸다). 401 은 여기선 그냥 "게스트"다.
 */
function fetchMe(): Promise<ApiSuccess<MePayload>> {
  return ApiClient.get<ApiSuccess<MePayload>>("/api/auth/me", { redirectOnUnauthorized: false });
}

/**
 * /api/auth/me 로 현재 로그인 사용자를 store 에 동기화하고 익명 세션을 이관.
 *
 * 앱 마운트(providers AuthSync)와 로그인 성공 직후(login 페이지) 양쪽에서 호출 —
 * router.push 는 remount 가 없어 마운트 시 1회 동기화만으로는 로그인 직후
 * 사이드바가 게스트로 남는다. 로그인 여부를 반환한다.
 */
export async function syncAuthFromServer(): Promise<boolean> {
  try {
    return await syncAuthInner();
  } finally {
    // 성공·게스트·실패 어느 경로든 "판정 끝" — /admin 가드가 이 플래그를 기다린다
    useAppStore.getState().setAuthResolved(true);
  }
}

async function syncAuthInner(): Promise<boolean> {
  try {
    let res = await fetchMe();
    let u = res?.data?.user;
    if (!u && hadSession()) {
      // 로그인 흔적이 있는데 게스트로 왔다 = auth_token 쿠키가 만료-purge 된 상태일 수 있다.
      // refresh_token(7일) 이 살아 있으면 1회 선시도로 세션을 복원한다(위 HAD_SESSION_KEY 주석).
      if (await tryRefresh()) {
        res = await fetchMe();
        u = res?.data?.user;
      } else {
        clearHadSession(); // refresh 수명도 끝 — 다음 마운트부터 헛 시도 없음
      }
    }
    if (!u) {
      // 비로그인은 200 + user:null 로 온다(401 아님) — 게스트 라벨링은 이 분기가 본선.
      // ⚠️ store 도 게스트로 되돌린다. 종전엔 라벨만 바꾸고 currentUser 를 남겨서, 세션이 만료된
      // 탭이 "로그인 상태"로 보이는 채 사이드바 배지가 30초마다 4개 요청을 만료 토큰으로
      // 영원히 두드렸다(2026-08-27 실측: 24h `jwt expired` 5,471건).
      const cur = useAppStore.getState().auth;
      if (cur.currentUser) useAppStore.getState().setAuth({ currentUser: null, isGuestMode: true });
      gaSetVisitor(null, "guest");
      return false;
    }
    markHadSession();
    useAppStore.getState().setAuth({
      currentUser: {
        id: String(u.id),
        email: u.email,
        name: u.username,
        role: u.role ?? "user",
      },
      isGuestMode: false,
    });
    // GA4 방문자 식별 — user_id + user_type(admin/user/guest). OAuth 복귀 시 login 이벤트 flush.
    const role = u.role === "admin" || u.role === "guest" ? u.role : "user";
    gaSetVisitor(String(u.id), role);
    flushOAuthLoginPending();
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
  } catch (e) {
    // `/api/auth/me` 가 만료 토큰에 **401** 을 돌려주는 경우(서버가 쿠키를 정리하기 전) — 게스트
    // (200, user:null)와 같은 뜻이다. 종전엔 라벨만 바꾸고 store 를 두어 만료 탭이 한 사이클 더
    // 폴링했다(2026-08-27 라이브: 401 → 30초 뒤 폴링 → 그때야 200 게스트로 정리).
    if (e instanceof ApiError && e.status === 401) {
      clearHadSession();
      if (useAppStore.getState().auth.currentUser) useAppStore.getState().setAuth({ currentUser: null, isGuestMode: true });
    }
    gaSetVisitor(null, "guest");
    return false;
  }
}
