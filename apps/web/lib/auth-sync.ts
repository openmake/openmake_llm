import type { ApiSuccess, MePayload } from "@openmake/shared-types";
import { ApiClient, ApiError, refreshOnce } from "./api-client";
import { getAnonSessionId } from "./anon-session";
import { flushOAuthLoginPending, gaSetVisitor } from "./analytics";
import { useAppStore } from "./store";
import { CLIENT_TIMING } from "./config";

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

/**
 * 마운트 동기화가 refresh 로 세션을 되살렸다는 알림 — 채팅 소켓은 마운트 때 한 번 핸드셰이크하므로,
 * auth_token 쿠키가 없던 순간에 붙은 소켓은 게스트로 남는다(2026-10-03 재현: 화면은 로그인 상태인데
 * 소켓만 게스트, 새로고침해야 풀림). 소켓 훅이 이 이벤트를 받아 새 쿠키로 다시 핸드셰이크한다.
 */
export const AUTH_RESTORED_EVENT = "omk:auth-restored";

/**
 * refresh 1회 시도 — 성공 시 새 auth_token 쿠키가 심긴다. ApiClient 의 401 인터셉트와 같은 single-flight 를
 * 쓴다: 따로 fetch 하면 동시에 난 두 refresh 중 늦은 쪽이 이미 회전된 토큰으로 401 을 받고 서버가 세션
 * 쿠키를 지워 로그아웃된다(2026-10-03 재현: 7ms 간격 두 호출 → 로그인 화면).
 */
function tryRefresh(): Promise<boolean> {
  return refreshOnce();
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
  // 이 호출이 곧 새 시도다 — 예약해 둔 재시도는 거둔다(겹쳐 돌지 않게).
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  try {
    return await syncAuthInner();
  } finally {
    // 성공·게스트·실패 어느 경로든 "판정 끝" — /admin 가드가 이 플래그를 기다린다
    useAppStore.getState().setAuthResolved(true);
  }
}

/**
 * 서버 오류·네트워크 실패는 "게스트"가 아니라 "아직 모름"이다 — 잠시 뒤 다시 묻는다. 종전엔 한 번 실패하면
 * 그대로 게스트로 굳어, 서버가 뜨는 도중 열린(다시 로드된) 탭이 쿠키가 멀쩡한데도 "로그인 안 됨"으로 남았다
 * (2026-10-03 재현: 재기동 중 /api/auth/me 프록시 실패 → 새로고침해야 풀림).
 */
let retryAttempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRetry(): void {
  if (retryTimer || retryAttempt >= CLIENT_TIMING.AUTH_SYNC_RETRY_LIMIT) return;
  const delay = Math.min(CLIENT_TIMING.AUTH_SYNC_RETRY_BASE_MS * 2 ** retryAttempt, CLIENT_TIMING.AUTH_SYNC_RETRY_MAX_MS);
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void syncAuthFromServer();
  }, delay);
}

async function syncAuthInner(): Promise<boolean> {
  try {
    const signedIn = await syncAuthOnce();
    retryAttempt = 0; // 서버가 답했다(로그인이든 게스트든) — 다음 장애 때 처음부터 다시 센다
    return signedIn;
  } catch (e) {
    // `/api/auth/me` 가 만료 토큰에 **401** 을 돌려주는 경우(서버가 쿠키를 정리하기 전) — 게스트
    // (200, user:null)와 같은 뜻이다. 종전엔 라벨만 바꾸고 store 를 두어 만료 탭이 한 사이클 더
    // 폴링했다(2026-08-27 라이브: 401 → 30초 뒤 폴링 → 그때야 200 게스트로 정리).
    if (e instanceof ApiError && e.status === 401) {
      clearHadSession();
      if (useAppStore.getState().auth.currentUser) useAppStore.getState().setAuth({ currentUser: null, isGuestMode: true });
    } else if (!(e instanceof ApiError) || e.status >= 500) {
      scheduleRetry();
    }
    gaSetVisitor(null, "guest");
    return false;
  }
}

async function syncAuthOnce(): Promise<boolean> {
  let res = await fetchMe();
  let u = res?.data?.user;
  if (!u && hadSession()) {
    // 로그인 흔적이 있는데 게스트로 왔다 = auth_token 쿠키가 만료-purge 된 상태일 수 있다.
    // refresh_token(7일) 이 살아 있으면 1회 선시도로 세션을 복원한다(위 HAD_SESSION_KEY 주석).
    if (await tryRefresh()) {
      window.dispatchEvent(new Event(AUTH_RESTORED_EVENT));
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
      activeOrgId: res?.data?.activeOrganization?.orgId ?? null,
      activeOrgRole: res?.data?.activeOrganization?.orgRole ?? null,
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
      // 기본 모델도 서버가 SoT — 종전엔 설정 페이지를 열 때만 복원돼, 로그아웃 중 컴포저가
      // 로컬 기본값으로 덮어쓴 selectedModel 이 재로그인 뒤에도 그대로였다(2026-09-08 신고).
      if (typeof p.defaultModel === "string" && p.defaultModel.length > 0) {
        useAppStore.getState().setSelectedModel(p.defaultModel);
      }
    })
    .catch(() => {
      /* 미설정/실패 — 기본값(true) 유지 */
    });
  return true;
}
