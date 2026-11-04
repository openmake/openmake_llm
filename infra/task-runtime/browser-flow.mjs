/**
 * browser-flow — browser-runner 의 제한된 제어 흐름(if·repeat) (2026-11-04).
 *
 * 러너는 컨테이너 안이라 @openmake/config 를 import 하지 못한다 — 같은 규칙(packages/config/src/browser-flow.ts 의 검사·평탄화,
 * packages/local-bridge-core/src/browser/browser-flow.ts 의 실행 순서)을 여기 따로 두고, 같은 사례 파일
 * (__fixtures__/browser-flow-cases.json)로 결과가 같은지 확인한다(browser-flow.test.mjs). 한쪽을 고치면 다른 쪽도 고친다.
 *
 * 조건은 읽기 전용 고정 조각(querySelector·innerText·location.href)만 쓰고, 사용자 입력은 JSON.stringify 로만 넣는다.
 */
import { readTextOrValue } from './field-value.mjs';

/** if·repeat 를 겹칠 수 있는 단계 수 */
export const BROWSER_FLOW_MAX_DEPTH = 2;
/** repeat 의 times 상한 */
export const BROWSER_REPEAT_MAX = 20;

const COND_KEYS = ['exists', 'visible', 'textIncludes', 'urlIncludes', 'not'];
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v !== '';

export function isBrowserFlowAction(a) {
    return isObj(a) && (a.type === 'if' || a.type === 'repeat');
}

function condError(c, at) {
    if (!isObj(c)) return `${at}: 조건은 객체여야 합니다`;
    const keys = COND_KEYS.filter((k) => c[k] !== undefined);
    if (keys.length !== 1) return `${at}: 조건에는 exists·visible·textIncludes·urlIncludes·not 중 하나만 넣으세요`;
    const k = keys[0];
    if (k === 'not') return condError(c.not, `${at}.not`);
    if (!isText(c[k])) return `${at}: ${k} 에는 빈 값이 아닌 문자열을 넣으세요`;
    if (k === 'textIncludes' && c.selector !== undefined && !isText(c.selector)) return `${at}: selector 에는 빈 값이 아닌 문자열을 넣으세요`;
    return null;
}

function listError(list, level, where) {
    for (let k = 0; k < list.length; k++) {
        const o = list[k];
        if (!isBrowserFlowAction(o)) continue;
        const at = where ? `${where}.${k}` : String(k);
        if (level >= BROWSER_FLOW_MAX_DEPTH) return `${at}: if·repeat 은 ${BROWSER_FLOW_MAX_DEPTH}단계까지만 겹칠 수 있습니다`;
        if (o.type === 'if') {
            const e = condError(o.cond, `${at}.cond`);
            if (e) return e;
            if (!Array.isArray(o.then)) return `${at}: if 에는 then 배열이 필요합니다`;
            if (o.else !== undefined && !Array.isArray(o.else)) return `${at}: else 는 배열이어야 합니다`;
            const inner = listError(o.then, level + 1, `${at}.then`) ?? (Array.isArray(o.else) ? listError(o.else, level + 1, `${at}.else`) : null);
            if (inner) return inner;
        } else {
            if (!Number.isInteger(o.times) || o.times < 1 || o.times > BROWSER_REPEAT_MAX) return `${at}: repeat 의 times 는 1~${BROWSER_REPEAT_MAX} 정수여야 합니다`;
            if (!Array.isArray(o.actions) || o.actions.length === 0) return `${at}: repeat 에는 비어 있지 않은 actions 배열이 필요합니다`;
            for (const key of ['until', 'while']) {
                const e = o[key] !== undefined ? condError(o[key], `${at}.${key}`) : null;
                if (e) return e;
            }
            const inner = listError(o.actions, level + 1, `${at}.actions`);
            if (inner) return inner;
        }
    }
    return null;
}

/** 제어 흐름 형태 검사 — 통과면 null, 아니면 이유 */
export function validateBrowserFlow(actions) {
    const e = listError(Array.isArray(actions) ? actions : [actions], 0, '');
    return e ? `browser 제어 흐름 오류 — 위치 ${e}` : null;
}

function walk(list, out) {
    for (const a of list) {
        if (!isBrowserFlowAction(a)) { out.push(a); continue; }
        if (a.type === 'if') { walk(a.then, out); if (Array.isArray(a.else)) walk(a.else, out); } else walk(a.actions, out);
    }
}

/** 모든 분기·반복 본문을 깊이 우선으로 펼친 단순 액션 목록. 형태가 어긋나면 던진다. */
export function flattenBrowserActions(actions) {
    const e = validateBrowserFlow(actions);
    if (e) throw new Error(e);
    const out = [];
    walk(Array.isArray(actions) ? actions : [actions], out);
    return out;
}

/** 조건을 페이지에서 평가할 식(문자열) — 검사를 통과한 조건만 받는다. 입력 칸 글은 현재 값(비밀번호는 빈 문자열, field-value.mjs). */
export function condExpression(c) {
    if (c.not !== undefined) return `!(${condExpression(c.not)})`;
    if (c.exists !== undefined) return `!!document.querySelector(${JSON.stringify(c.exists)})`;
    if (c.visible !== undefined) {
        return `((el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); `
            + `return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; })(document.querySelector(${JSON.stringify(c.visible)}))`;
    }
    if (c.textIncludes !== undefined) {
        const t = JSON.stringify(c.textIncludes);
        return c.selector !== undefined
            ? `((el) => !!el && String((${readTextOrValue.toString()})(el)).includes(${t}))(document.querySelector(${JSON.stringify(c.selector)}))`
            : `(document.body ? document.body.innerText : '').includes(${t})`;
    }
    return `location.href.includes(${JSON.stringify(c.urlIncludes)})`;
}

const limitError = (max) => `한 호출에서 실행할 수 있는 액션 수(${max}개)에 닿아 멈췄습니다 — repeat 의 times 나 본문을 줄이거나 호출을 나누세요`;
const message = (e) => (e instanceof Error ? e.message : String(e));

/**
 * 검사를 통과한 액션 배열을 실행한다. 단순 액션은 runSimple(action, i, step) 이 결과({ok,...})를 돌려주고, 조건은 evalCond(cond) 가 판정한다.
 * 결과: 단순 액션마다 1건(중첩이면 step — "2.then.0"·"3.r1.0"), 제어 액션은 {i,type:'if',ok,branch} · {i,type:'repeat',ok,rounds,stoppedBy}.
 * 단순 액션이 실패하거나, 조건 평가가 실패하거나, 실행한 단순 액션 수가 maxSimple 을 넘으려 하면 그 자리에서 멈춘다.
 */
export async function runBrowserFlow(actions, { runSimple, evalCond }, maxSimple) {
    const results = [];
    let executed = 0;
    const runList = async (list, top, prefix) => {
        for (let k = 0; k < list.length; k++) {
            const a = isObj(list[k]) ? list[k] : {};
            const i = top ?? k;
            const step = prefix === null ? undefined : `${prefix}.${k}`;
            const here = step ?? String(k);
            const at = step ? { step } : {};
            if (a.type === 'if') {
                const r = { i, type: 'if', ok: true, ...at };
                results.push(r);
                let c;
                try { c = await evalCond(a.cond); } catch (e) { r.ok = false; r.error = message(e); return false; }
                r.branch = c ? 'then' : Array.isArray(a.else) ? 'else' : 'none';
                const body = c ? a.then : a.else;
                if (Array.isArray(body) && !(await runList(body, i, `${here}.${r.branch}`))) { r.ok = false; return false; }
            } else if (a.type === 'repeat') {
                const r = { i, type: 'repeat', ok: true, rounds: 0, ...at };
                results.push(r);
                let stoppedBy = 'times';
                for (let round = 1; round <= a.times; round++) {
                    try {
                        if (a.while !== undefined && !(await evalCond(a.while))) { stoppedBy = 'while'; break; }
                    } catch (e) { r.ok = false; r.error = message(e); return false; }
                    r.rounds = round;
                    if (!(await runList(a.actions, i, `${here}.r${round}`))) { r.ok = false; return false; }
                    try {
                        if (a.until !== undefined && (await evalCond(a.until))) { stoppedBy = 'until'; break; }
                    } catch (e) { r.ok = false; r.error = message(e); return false; }
                }
                r.stoppedBy = stoppedBy;
            } else {
                if (executed >= maxSimple) { results.push({ i, type: a.type, ok: false, error: limitError(maxSimple), ...at }); return false; }
                executed++;
                const res = await runSimple(a, i, step);
                if (step) res.step = step;
                results.push(res);
                if (!res.ok) return false;
            }
        }
        return true;
    };
    await runList(Array.isArray(actions) ? actions : [], null, null);
    return results;
}
