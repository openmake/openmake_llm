/**
 * 브라우저 제한된 제어 흐름(if·repeat) — 검사와 평탄화. 서버(apps/api)와 기기(local-bridge-core)가 같이 쓴다 (2026-11-04).
 *
 *   { type:"if",     cond, then:[...], else?:[...] }
 *   { type:"repeat", times:1..BROWSER_REPEAT_MAX, actions:[...], until?:cond, while?:cond }
 *   cond = {exists:css} | {visible:css} | {textIncludes:문자열, selector?:css} | {urlIncludes:문자열} | {not:cond}
 *
 * 조건은 읽기 전용 판정만 한다(임의 JS 없음 — 사이트 정책 판정을 우회하는 길을 만들지 않는다).
 * 실행 전 정적 검사(사이트 정책·주소 검사·업로드 검사·절차 스킬 검사)는 flattenBrowserActions 의 결과를 훑는다 —
 * 어느 분기·반복 본문에 있든 승인·차단이 실행 전에 걸린다.
 * 서버 샌드박스 러너(infra/task-runtime/browser-flow.mjs)는 패키지를 import 하지 못해 같은 규칙을 따로 두고,
 * 같은 사례 파일(infra/task-runtime/__fixtures__/browser-flow-cases.json)로 결과가 같은지 확인한다.
 */

/** if·repeat 를 겹칠 수 있는 단계 수 — 2 면 if 안의 repeat 까지 */
export const BROWSER_FLOW_MAX_DEPTH = 2;
/** repeat 의 times 상한 */
export const BROWSER_REPEAT_MAX = 20;

export type BrowserFlowCond =
  | { exists: string }
  | { visible: string }
  | { textIncludes: string; selector?: string }
  | { urlIncludes: string }
  | { not: BrowserFlowCond };

/** 제어 흐름 형태 오류 — 메시지는 모델이 고쳐 다시 부를 수 있게 위치(path)와 이유를 담는다 */
export class BrowserFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserFlowError";
  }
}

const COND_KEYS = ["exists", "visible", "textIncludes", "urlIncludes", "not"] as const;
const FLOW_TYPES: ReadonlySet<unknown> = new Set(["if", "repeat"]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v !== "";

/** 제어 액션(if·repeat)인가 */
export function isBrowserFlowAction(action: unknown): boolean {
  return isObj(action) && FLOW_TYPES.has(action.type);
}

function condError(c: unknown, at: string): string | null {
  if (!isObj(c)) return `${at}: 조건은 객체여야 합니다`;
  const keys = COND_KEYS.filter((k) => c[k] !== undefined);
  if (keys.length !== 1) return `${at}: 조건에는 exists·visible·textIncludes·urlIncludes·not 중 하나만 넣으세요`;
  const k = keys[0];
  if (k === "not") return condError(c.not, `${at}.not`);
  if (!isText(c[k])) return `${at}: ${k} 에는 빈 값이 아닌 문자열을 넣으세요`;
  if (k === "textIncludes" && c.selector !== undefined && !isText(c.selector)) return `${at}: selector 에는 빈 값이 아닌 문자열을 넣으세요`;
  return null;
}

function listError(list: readonly unknown[], level: number, where: string): string | null {
  for (let k = 0; k < list.length; k++) {
    const a = list[k];
    if (!isBrowserFlowAction(a)) continue;
    const o = a as Obj;
    const at = where ? `${where}.${k}` : String(k);
    if (level >= BROWSER_FLOW_MAX_DEPTH) return `${at}: if·repeat 은 ${BROWSER_FLOW_MAX_DEPTH}단계까지만 겹칠 수 있습니다`;
    if (o.type === "if") {
      const e = condError(o.cond, `${at}.cond`);
      if (e) return e;
      if (!Array.isArray(o.then)) return `${at}: if 에는 then 배열이 필요합니다`;
      if (o.else !== undefined && !Array.isArray(o.else)) return `${at}: else 는 배열이어야 합니다`;
      const inner = listError(o.then, level + 1, `${at}.then`) ?? (Array.isArray(o.else) ? listError(o.else, level + 1, `${at}.else`) : null);
      if (inner) return inner;
    } else {
      if (!Number.isInteger(o.times) || (o.times as number) < 1 || (o.times as number) > BROWSER_REPEAT_MAX) {
        return `${at}: repeat 의 times 는 1~${BROWSER_REPEAT_MAX} 정수여야 합니다`;
      }
      if (!Array.isArray(o.actions) || o.actions.length === 0) return `${at}: repeat 에는 비어 있지 않은 actions 배열이 필요합니다`;
      for (const key of ["until", "while"] as const) {
        const e = o[key] !== undefined ? condError(o[key], `${at}.${key}`) : null;
        if (e) return e;
      }
      const inner = listError(o.actions, level + 1, `${at}.actions`);
      if (inner) return inner;
    }
  }
  return null;
}

/** 제어 흐름 형태 검사 — 통과면 null, 아니면 이유. 배열이 아니면(단일 액션 객체) 한 칸짜리 배열로 본다. */
export function validateBrowserFlow(actions: unknown): string | null {
  const e = listError(Array.isArray(actions) ? actions : [actions], 0, "");
  return e ? `browser 제어 흐름 오류 — 위치 ${e}` : null;
}

function walk(list: readonly unknown[], out: unknown[]): void {
  for (const a of list) {
    if (!isBrowserFlowAction(a)) { out.push(a); continue; }
    const o = a as Obj;
    if (o.type === "if") {
      walk(o.then as unknown[], out);
      if (Array.isArray(o.else)) walk(o.else, out);
    } else {
      walk(o.actions as unknown[], out);
    }
  }
}

/**
 * 모든 분기·반복 본문을 깊이 우선으로 펼친 단순 액션 목록(제어 액션 자체는 빠진다). 반복 본문은 한 번만 넣는다 —
 * 정적 검사는 "어떤 액션이 실행될 수 있는가"만 본다. 형태가 어긋나면 BrowserFlowError.
 */
export function flattenBrowserActions(actions: unknown): unknown[] {
  const e = validateBrowserFlow(actions);
  if (e) throw new BrowserFlowError(e);
  const out: unknown[] = [];
  walk(Array.isArray(actions) ? actions : [actions], out);
  return out;
}
