/**
 * GA4 방문자 분석 계측 헬퍼 — 이벤트명·파라미터 스키마를 이 모듈에 집약한다.
 *
 * gtag 로더(components/google-analytics.tsx)가 아직 실행되기 전이어도 유실되지 않도록
 * 로더의 stub 과 동일한 방식(window.dataLayer 에 arguments push)으로 전송한다 —
 * gtag.js 는 큐에 쌓인 Arguments 객체를 로드 후 순서대로 처리한다.
 *
 * ⚠️ user_id·파라미터에 PII(이메일·이름) 금지 — users.id 는 시퀀스 숫자 문자열이라 안전.
 */

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export const GA_MEASUREMENT_IDS = (process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

// 모듈 로드(하이드레이션) 시점에 gtag 명령 큐를 부트스트랩 — React effect·비동기 계측이
// 로더(gtag.js) 실행 전에 호출돼도 'js'→'config' 뒤에 줄서서 유실되지 않게 순서를 확정한다.
// (구 인라인 Script 부트스트랩은 첫 로드에서 라우트 effect 가 로더보다 먼저 돌아
//  랜딩 page_view 를 유실했다 — 2026-08-10 chat.openmake.cc 외부 경로 실측)
if (typeof window !== "undefined" && GA_MEASUREMENT_IDS.length > 0 && !window.gtag) {
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  for (const id of GA_MEASUREMENT_IDS) {
    window.gtag("config", id, { send_page_view: false });
  }
}

export const GA_EVENTS = {
  /** 로그인 성공 — method: password | google | github | kakao | guest */
  login: "login",
  /** 회원가입 성공 — method: password */
  signUp: "sign_up",
  /** 채팅 메시지 전송(핵심 인게이지먼트) — chat_mode, model_id, web_search, with_attachment */
  chatMessageSent: "chat_message_sent",
  /** 에이전트 작업 생성 — executor: local | sandbox */
  agentTaskCreated: "agent_task_created",
} as const;

type GaEventName = (typeof GA_EVENTS)[keyof typeof GA_EVENTS];
type GaParams = Record<string, string | number | boolean | undefined>;

/** OAuth 는 전체 페이지 리디렉트라 복귀 후에야 성공을 알 수 있다 — 클릭 시점의 method 를 보관. */
const OAUTH_LOGIN_PENDING_KEY = "ga:oauth-login-method";

function callGtag(...args: unknown[]): void {
  if (typeof window === "undefined" || !window.gtag) return;
  window.gtag(...args);
}

export function gaEvent(name: GaEventName, params?: GaParams): void {
  callGtag("event", name, params ?? {});
}

/**
 * 방문자 식별 — 이후 전송되는 모든 이벤트(구성된 측정 ID 전체)에 적용된다.
 * userId=null 이면 비로그인(익명/게스트) 방문자.
 */
export function gaSetVisitor(userId: string | null, userType: "admin" | "user" | "guest"): void {
  callGtag("set", { user_id: userId });
  callGtag("set", "user_properties", { user_type: userType });
}

/** OAuth 로그인 버튼 클릭 시 호출 — 리디렉트 복귀 후 flush 에서 login 이벤트로 전송된다. */
export function markOAuthLoginPending(method: "google" | "github" | "kakao"): void {
  try {
    sessionStorage.setItem(OAUTH_LOGIN_PENDING_KEY, method);
  } catch {
    /* storage 불가(시크릿 등) — 계측만 유실 */
  }
}

/** 인증 동기화 성공 시 호출 — 보관된 OAuth method 가 있으면 login 이벤트로 1회 전송. */
export function flushOAuthLoginPending(): void {
  try {
    const method = sessionStorage.getItem(OAUTH_LOGIN_PENDING_KEY);
    if (!method) return;
    sessionStorage.removeItem(OAUTH_LOGIN_PENDING_KEY);
    gaEvent(GA_EVENTS.login, { method });
  } catch {
    /* storage 불가 — 무시 */
  }
}
