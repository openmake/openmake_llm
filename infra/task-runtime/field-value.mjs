/**
 * field-value — 입력 칸의 현재 값 읽기 (browser-runner 가 쓴다).
 *
 * 입력(fill·smartFill) 결과가 `{ok:true}` 뿐이면 모델은 값이 들어갔는지 알 수 없어 같은 입력을 되풀이했다.
 * 입력 칸의 extractText 도 보이는 글(innerText)이 비어 있어 빈 문자열이 돌아왔다(2026-10-05 로컬 브라우저에서 실측,
 * 서버 샌드박스 브라우저도 같은 구조). 입력 뒤에는 실제 값을 결과에 싣고, 입력 칸의 extractText 는 현재 값을 돌려준다.
 * 비밀번호 칸의 값은 싣지 않는다. 로컬 브라우저(packages/local-bridge-core 의 local-browser)와 같은 규칙이다.
 */

/** 입력 뒤 결과에 되돌려 주는 값의 길이 상한 — 모델이 "들어갔는지" 확인하는 용도라 앞부분이면 충분하다 */
export const FILL_ECHO_MAX_CHARS = 200;

/** 페이지 안에서 돈다 — 요소의 현재 값. 입력 칸은 value, 편집 가능한 영역은 보이는 글. 비밀번호 칸과 없는 요소는 null. */
export function readFieldValue(el) {
    if (!el) return null;
    if (el instanceof HTMLInputElement && el.type === 'password') return null;
    return 'value' in el && typeof el.value === 'string' ? el.value : (el.isContentEditable ? el.innerText : null);
}

/** 페이지 안에서 돈다 — 입력 칸이면 현재 값(비밀번호는 빈 문자열), 아니면 보이는 글. */
export function readTextOrValue(el) {
    const isForm = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
    if (!isForm) return el.innerText;
    return el instanceof HTMLInputElement && el.type === 'password' ? '' : el.value;
}

/** 입력 결과에 실을 조각 — 값을 읽었으면 `{ value }`, 못 읽었으면(비밀번호·읽기 실패) 빈 객체. 입력 자체는 이미 성공했으므로 실패를 던지지 않는다. */
export async function filledValue(locator) {
    try {
        const v = await locator.evaluate(readFieldValue, undefined, { timeout: 2000 });
        return typeof v === 'string' ? { value: v.slice(0, FILL_ECHO_MAX_CHARS) } : {};
    } catch {
        return {};
    }
}
