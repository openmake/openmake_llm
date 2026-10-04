/**
 * 브라우저 사이트 정책 — 서버(apps/api)와 기기(local-bridge-core)가 같은 판정을 쓰는 순수 로직 (Companion P2, 2026-10-04).
 *
 * 에이전트가 사용자 PC 의 브라우저로 사이트에 무언가를 입력하면 그 내용은 OpenMake 밖으로 나간다. 그래서:
 *   - 읽기(관찰)는 어느 사이트든 허용한다.
 *   - 쓰기(입력·키 입력·확인창 수락)와 누르기는 관리자가 지정한 허용 목록 사이트에서만 하고, 목록 밖에서는 건별 승인을 받는다.
 *   - 주소에 질의 문자열을 실어 목록 밖 사이트로 가는 이동(검색 등)은 쓰기로 본다 — 검색어가 주소에 실려 나간다.
 *   - http(s) 가 아닌 주소(file:·javascript:·data: 등)로는 이동하지 않는다 — 허용 폴더 밖의 로컬 파일을 브라우저로 읽는 길을 막는다.
 *
 * 서버는 호출 전에 액션 배열을 훑어 승인이 필요한 것을 찾고(planBrowserActions), 기기는 실행 직전에 **실제 탭의 주소**로
 * 다시 판정한다(checkBrowserAction) — 리다이렉트·페이지가 연 새 창·사용자의 직접 조작으로 주소가 달라질 수 있다.
 */

// 이 패키지는 DOM·Node 타입 없이 빌드한다 — 런타임(Node·브라우저)이 모두 제공하는 URL 의 쓰는 부분만 선언한다.
declare const URL: { new (url: string): { protocol: string; hostname: string; search: string } };

export interface BrowserSitePolicy {
  /** 승인 없이 쓰기를 허용하는 호스트 패턴 — `groupware.example.co.kr`, `*.example.co.kr` */
  allow: string[];
  /** 허용 목록에 걸려도 승인을 요구하는 호스트 패턴 — 거부가 이긴다 */
  deny: string[];
}

export const EMPTY_BROWSER_SITE_POLICY: BrowserSitePolicy = { allow: [], deny: [] };

/** 액션 분류 — observe: 읽기, navigate: 주소 이동, write: 입력·키·확인창 수락, click: 누르기 */
export type BrowserActionClass = "observe" | "navigate" | "write" | "click";

const ACTION_CLASS: Readonly<Record<string, BrowserActionClass>> = {
  goto: "navigate",
  click: "click",
  smartClick: "click",
  fill: "write",
  smartFill: "write",
  press: "write",
  snapshot: "observe",
  wait: "observe",
  waitFor: "observe",
  screenshot: "observe",
  extractText: "observe",
  extractHtml: "observe",
};

/** 승인 카드·오류 문구에 싣는 값의 길이 상한 */
const DETAIL_MAX_CHARS = 200;

type ActionLike = { type?: unknown; url?: unknown; text?: unknown; selector?: unknown; role?: unknown; name?: unknown; key?: unknown; accept?: unknown };

function asAction(a: unknown): ActionLike {
  return a && typeof a === "object" ? (a as ActionLike) : {};
}

/**
 * 액션의 분류. `dialog` 는 수락(accept:true)이면 쓰기, 아니면 읽기다(취소는 아무것도 보내지 않는다).
 * 모르는 종류는 쓰기로 본다 — 분류표에 없는 새 액션이 승인 없이 지나가지 않게.
 */
export function classifyBrowserAction(action: unknown): BrowserActionClass {
  const a = asAction(action);
  if (a.type === "dialog") return a.accept === true ? "write" : "observe";
  return (typeof a.type === "string" && ACTION_CLASS[a.type]) || "write";
}

/** http(s) 주소의 호스트(소문자). 그 밖의 주소·해석 불가는 null. */
export function browserHostOf(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** 이동해도 되는 주소인가 — http(s) 와 빈 페이지만. */
export function isNavigableBrowserUrl(url: unknown): boolean {
  return typeof url === "string" && (url.trim() === "about:blank" || browserHostOf(url) !== null);
}

/** 호스트 패턴 일치 — `*` 는 임의 문자열. `*.example.com` 은 하위 도메인만(`example.com` 자체는 따로 적는다). 대소문자 무시. */
export function browserHostMatches(host: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (!p) return false;
  const re = new RegExp(`^${p.split("*").map((s) => s.replace(/[.+^${}()|[\]\\?]/g, "\\$&")).join(".*")}$`);
  return re.test(host.toLowerCase());
}

/** 이 호스트에서 승인 없이 쓰기를 해도 되는가 — 거부가 이기고, 허용 목록에 있어야 한다. */
export function isBrowserHostAllowed(host: string | null, policy: BrowserSitePolicy): boolean {
  if (!host) return false;
  if (policy.deny.some((p) => browserHostMatches(host, p))) return false;
  return policy.allow.some((p) => browserHostMatches(host, p));
}

function clip(v: unknown): string {
  const s = typeof v === "string" ? v : v === undefined || v === null ? "" : String(v);
  return s.length > DETAIL_MAX_CHARS ? `${s.slice(0, DETAIL_MAX_CHARS)}…` : s;
}

/** 승인 카드에 보여 줄 한 줄 — 무엇을 어디에 보내려는지. */
function describeAction(action: unknown): string {
  const a = asAction(action);
  switch (a.type) {
    case "goto": return clip(a.url);
    case "fill": return `${clip(a.selector)} ← ${clip(a.text)}`;
    case "smartFill": return `${clip(a.role)} "${clip(a.name)}" ← ${clip(a.text)}`;
    case "click": return clip(a.selector);
    case "smartClick": return `${clip(a.role)} "${clip(a.name)}"`;
    case "press": return clip(a.key);
    case "dialog": return "확인창 수락";
    default: return clip(a.type);
  }
}

export interface BrowserSiteWrite {
  /** actions 배열에서의 위치 */
  index: number;
  type: string;
  /** 쓰기가 향하는 호스트 — 알 수 없으면(빈 페이지·이동 실패) 빈 문자열 */
  host: string;
  detail: string;
}

export interface BrowserBlockedNavigation {
  index: number;
  url: string;
}

export interface BrowserSitePlan {
  /** 이동할 수 없는 주소(http(s) 아님) — 승인으로도 풀지 않는다 */
  blocked: BrowserBlockedNavigation[];
  /** 허용 목록 밖 쓰기 — 사용자 승인이 필요하다 */
  offListWrites: BrowserSiteWrite[];
}

/**
 * 이 액션이 지금 호스트(currentHost)에서 승인을 필요로 하는가. 이동은 **목적지** 호스트로 판정한다.
 * 반환: 승인이 필요하면 그 쓰기가 향하는 호스트(알 수 없으면 ''), 필요 없으면 null.
 */
export function browserActionNeedsApproval(action: unknown, currentHost: string | null, policy: BrowserSitePolicy): string | null {
  const cls = classifyBrowserAction(action);
  if (cls === "observe") return null;
  if (cls === "navigate") {
    const url = asAction(action).url;
    const target = browserHostOf(url);
    if (!target || isBrowserHostAllowed(target, policy)) return null;
    // 목록 밖 사이트로 가는 주소에 질의 문자열이 있으면 쓰기 — 검색어 등이 주소에 실려 나간다
    try { return new URL(String(url)).search.length > 1 ? target : null; } catch { return null; }
  }
  return isBrowserHostAllowed(currentHost, policy) ? null : (currentHost ?? "");
}

/**
 * 서버용 — 액션 배열을 순서대로 훑어 막을 이동과 승인이 필요한 쓰기를 찾는다. startUrl 은 서버가 아는 마지막 주소.
 * 누르기로 일어나는 이동은 서버가 알 수 없다 — 그 뒤의 쓰기는 기기가 실제 주소로 다시 판정한다.
 */
export function planBrowserActions(actions: readonly unknown[], startUrl: string | null, policy: BrowserSitePolicy): BrowserSitePlan {
  const plan: BrowserSitePlan = { blocked: [], offListWrites: [] };
  let host = browserHostOf(startUrl);
  actions.forEach((action, index) => {
    const a = asAction(action);
    if (a.type === "goto" && !isNavigableBrowserUrl(a.url)) {
      plan.blocked.push({ index, url: clip(a.url) });
      return;
    }
    const needs = browserActionNeedsApproval(action, host, policy);
    if (needs !== null) plan.offListWrites.push({ index, type: String(a.type ?? ""), host: needs, detail: describeAction(action) });
    if (a.type === "goto") host = browserHostOf(a.url);
  });
  return plan;
}

/**
 * 기기용 — 실행 직전, 실제 탭의 호스트로 판정한다. 통과면 null, 막으면 사유.
 * approvedHosts 는 이번 호출에서 사용자가 승인한 호스트(서버가 실어 보낸다). '' 는 "호스트를 알 수 없던 쓰기"의 승인이라
 * 실제 호스트가 무엇이든 통과시키지 않는다 — 승인 화면에 보이지 않은 사이트로 쓰지 않는다.
 */
export function checkBrowserAction(
  action: unknown, currentHost: string | null, policy: BrowserSitePolicy, approvedHosts: readonly string[],
): string | null {
  const a = asAction(action);
  if (a.type === "goto" && !isNavigableBrowserUrl(a.url)) return `이동할 수 없는 주소입니다(http·https 만 허용): ${clip(a.url)}`;
  const needs = browserActionNeedsApproval(action, currentHost, policy);
  if (needs === null) return null;
  if (needs !== "" && approvedHosts.some((h) => h.toLowerCase() === needs)) return null;
  return `사이트 정책: 허용 목록에 없는 사이트(${needs || "주소 확인 불가"})에 대한 ${classifyBrowserAction(action) === "click" ? "누르기" : "입력"}는 사용자 승인이 필요합니다. `
    + "현재 페이지를 다시 확인한 뒤 같은 동작을 다시 요청하면 승인을 받습니다.";
}

/** 저장된 정책 값(JSON 문자열 또는 객체) → 정책. 형태가 어긋나면 빈 정책(전부 승인 대상). */
export function parseBrowserSitePolicy(raw: unknown): BrowserSitePolicy {
  let v: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return EMPTY_BROWSER_SITE_POLICY;
    try { v = JSON.parse(raw); } catch { return EMPTY_BROWSER_SITE_POLICY; }
  }
  if (!v || typeof v !== "object") return EMPTY_BROWSER_SITE_POLICY;
  const list = (x: unknown): string[] =>
    Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim().toLowerCase()) : [];
  const o = v as { allow?: unknown; deny?: unknown };
  return { allow: list(o.allow), deny: list(o.deny) };
}
