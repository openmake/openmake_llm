/**
 * LocalBrowser 의 제한된 제어 흐름(if·repeat) 실행 — 조건 조각과 실행 순서 (2026-11-04).
 *
 * 형태 검사·상한은 @openmake/config(browser-flow.ts)를 쓴다 — 서버의 정적 검사와 같은 규칙이다.
 * 서버 샌드박스 러너(infra/task-runtime/browser-flow.mjs)와 같은 결과를 내야 한다 — 같은 사례 파일로 확인한다
 * (__tests__/browser-flow.test.ts). 한쪽을 고치면 다른 쪽도 고친다.
 *
 * 조건은 읽기 전용 고정 조각(querySelector·innerText·location.href)만 쓰고, 사용자 입력은 JSON.stringify 로만 넣는다.
 * 입력 칸의 글은 현재 값을 보되 비밀번호 칸 값은 보지 않는다(FIELD_VALUE_JS — extractText 와 같은 규칙).
 */
import type { BrowserFlowCond } from '@openmake/config';
import { FIELD_IS_FORM_JS, FIELD_VALUE_JS, type Action, type BrowserActionResult } from './local-browser-defs';

type Cond = Partial<Record<'exists' | 'visible' | 'textIncludes' | 'urlIncludes' | 'selector', string>> & { not?: Cond };

/** 조건을 페이지에서 평가할 식(문자열) — 검사(validateBrowserFlow)를 통과한 조건만 받는다. */
export function condExpression(cond: BrowserFlowCond): string {
    const c = cond as Cond;
    if (c.not !== undefined) return `!(${condExpression(c.not as BrowserFlowCond)})`;
    if (c.exists !== undefined) return `!!document.querySelector(${JSON.stringify(c.exists)})`;
    if (c.visible !== undefined) {
        return `((el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); `
            + `return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; })(document.querySelector(${JSON.stringify(c.visible)}))`;
    }
    if (c.textIncludes !== undefined) {
        const t = JSON.stringify(c.textIncludes);
        return c.selector !== undefined
            ? `((el) => { if (!el) return false; const v = (${FIELD_VALUE_JS})(el); return String(${FIELD_IS_FORM_JS} ? (v ?? '') : el.innerText).includes(${t}); })(document.querySelector(${JSON.stringify(c.selector)}))`
            : `(document.body ? document.body.innerText : '').includes(${t})`;
    }
    return `location.href.includes(${JSON.stringify(c.urlIncludes)})`;
}

export interface BrowserFlowHooks {
    /** 단순 액션 하나 — 실패도 던지지 않고 ok:false 결과로 돌려준다. step 은 중첩 액션의 위치("2.then.0") */
    runSimple: (action: Action, i: number, step: string | undefined) => Promise<BrowserActionResult>;
    /** 조건 판정 — 평가 실패는 던진다 */
    evalCond: (cond: BrowserFlowCond) => Promise<boolean>;
}

const limitError = (max: number): string => `한 호출에서 실행할 수 있는 액션 수(${max}개)에 닿아 멈췄습니다 — repeat 의 times 나 본문을 줄이거나 호출을 나누세요`;
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const isObj = (v: unknown): v is Action => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * 검사를 통과한 액션 배열을 실행한다. 결과: 단순 액션마다 1건(중첩이면 step), 제어 액션은
 * {i,type:'if',ok,branch} · {i,type:'repeat',ok,rounds,stoppedBy} 를 본문 결과 앞에 둔다.
 * 단순 액션 실패·조건 평가 실패·실행한 단순 액션 수가 maxSimple 을 넘으려 할 때 그 자리에서 멈춘다.
 */
export async function runBrowserFlow(actions: readonly unknown[], hooks: BrowserFlowHooks, maxSimple: number): Promise<BrowserActionResult[]> {
    const results: BrowserActionResult[] = [];
    let executed = 0;
    const cond = async (r: BrowserActionResult, c: unknown): Promise<boolean | null> => {
        try { return await hooks.evalCond(c as BrowserFlowCond); } catch (e) { r.ok = false; r.error = message(e); return null; }
    };
    const runList = async (list: readonly unknown[], top: number | null, prefix: string | null): Promise<boolean> => {
        for (let k = 0; k < list.length; k++) {
            const a: Action = isObj(list[k]) ? list[k] as Action : {};
            const i = top ?? k;
            const step = prefix === null ? undefined : `${prefix}.${k}`;
            const here = step ?? String(k);
            const at = step ? { step } : {};
            if (a.type === 'if') {
                const r: BrowserActionResult = { i, type: 'if', ok: true, ...at };
                results.push(r);
                const c = await cond(r, a.cond);
                if (c === null) return false;
                r.branch = c ? 'then' : Array.isArray(a.else) ? 'else' : 'none';
                const body = c ? a.then : a.else;
                if (Array.isArray(body) && !(await runList(body, i, `${here}.${r.branch}`))) { r.ok = false; return false; }
            } else if (a.type === 'repeat') {
                const r: BrowserActionResult = { i, type: 'repeat', ok: true, rounds: 0, ...at };
                results.push(r);
                let stoppedBy = 'times';
                for (let round = 1; round <= Number(a.times); round++) {
                    if (a.while !== undefined) {
                        const w = await cond(r, a.while);
                        if (w === null) return false;
                        if (!w) { stoppedBy = 'while'; break; }
                    }
                    r.rounds = round;
                    if (!(await runList(a.actions as unknown[], i, `${here}.r${round}`))) { r.ok = false; return false; }
                    if (a.until !== undefined) {
                        const u = await cond(r, a.until);
                        if (u === null) return false;
                        if (u) { stoppedBy = 'until'; break; }
                    }
                }
                r.stoppedBy = stoppedBy;
            } else {
                if (executed >= maxSimple) { results.push({ i, type: a.type, ok: false, error: limitError(maxSimple), ...at }); return false; }
                executed++;
                const res = await hooks.runSimple(a, i, step);
                if (step) res.step = step;
                results.push(res);
                if (!res.ok) return false;
            }
        }
        return true;
    };
    await runList(actions, null, null);
    return results;
}
