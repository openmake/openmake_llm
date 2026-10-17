/**
 * LocalBrowser 의 요청·결과 형식과 상수·순수 도우미 — local-browser.ts 에서 분리(파일 크기 가드).
 * 바깥에 드러나는 이름(BrowserSpec·BrowserRunOptions·BrowserActionResult·BrowserRunResult·
 * BROWSER_USER_CONTROL_ERROR·screenshotName)은 local-browser.ts 가 그대로 re-export 한다.
 */
import type { BrowserUploadApproval } from '@openmake/config';
import type { BrowserPolicyBlock } from '../types';

/** 서버가 보내는 브라우저 요청 본문 */
export interface BrowserSpec {
    actions?: unknown;
    /** 허용 목록(@openmake/config BrowserSitePolicy) — 없거나 형태가 어긋나면 빈 정책(쓰기는 전부 승인 대상) */
    sitePolicy?: unknown;
    /** 이번 호출에서 사용자가 승인한 호스트 */
    approvedHosts?: unknown;
    /** 이번 호출에서 사용자가 승인한 업로드({host, files}[]) — 그 호스트·그 파일 목록에만 쓴다 */
    approvedUploads?: unknown;
}

export interface BrowserRunOptions {
    /** 작업 id — 작업마다 탭을 따로 쓴다. 없으면 공용 탭 */
    taskId?: string;
    /** 스크린샷 저장 — 호출부가 허용 폴더 안의 경로로 풀어 쓴다(스코프 검사는 호출부 책임) */
    saveFile: (name: string, data: Buffer) => Promise<void>;
    /** 다운로드가 떨어질 폴더(절대 경로) — 허용 폴더 안 */
    downloadDir: string;
    /** 업로드할 파일 검사 — 폴더 기준 상대 경로 → 실제 경로, 걸리면 던진다(upload-files.ts). 없으면 업로드를 실행하지 않는다 */
    resolveUploadFiles?: (files: unknown) => Promise<string[]>;
}

export interface BrowserActionResult {
    i: number;
    type: unknown;
    ok: boolean;
    /** selector 없는 extractText·extractHtml 에서, 기다려도 문서가 아직 읽히는 중(readyState 'loading')이었다 — text·html 이 비었거나 일부일 수 있다 */
    loading?: boolean;
    [k: string]: unknown;
}

export interface BrowserRunResult {
    ok: boolean;
    finalUrl?: string;
    results: BrowserActionResult[];
    error?: string;
    /** 사용자가 브라우저를 넘겨받은 상태라 아무것도 실행하지 않고 거절했다 — 서버가 작업을 주차하는 근거(2026-10-05). */
    userControl?: true;
    /** 사이트 정책·사용자 제어로 막은 액션(서버 감사 기록용, 2026-10-06) — 막히면 거기서 멈추므로 한 호출에 하나다. */
    policyBlock?: BrowserPolicyBlock;
}

export interface Action { type?: unknown; [k: string]: unknown }

export interface DialogRecord { type: string; message: string; handled: 'accepted' | 'dismissed' }

export interface Tab {
    targetId: string;
    sessionId: string;
    /** 이후 뜨는 confirm·prompt 를 수락할지 — dialog 액션이 바꾼다 */
    acceptDialogs: boolean;
    promptText?: string;
    dialogs: DialogRecord[];
    lastUsed: number;
}

export const PAGE_ACTIONS = new Set(['click', 'fill', 'snapshot', 'smartClick', 'smartFill', 'press', 'waitFor', 'screenshot', 'extractText', 'extractHtml', 'uploadFile']);
export const UPLOAD_UNSUPPORTED_ERROR = '이 실행 위치에서는 파일 업로드를 할 수 없습니다';
export const UPLOAD_HOST_CHANGED_ERROR = '파일 칸을 기다리는 동안 다른 사이트로 이동해 업로드하지 않았습니다 — 현재 페이지를 다시 확인한 뒤 요청하세요';
export const BLANK_PAGE_ERROR = '빈 페이지(about:blank)에서 실행됨 — 먼저 goto 로 페이지를 여세요';
/** 페이지 안에서 도는 조각 — 요소의 현재 값. 입력 칸은 value, 편집 가능한 영역은 보이는 글. 비밀번호 칸과 없는 요소는 null. */
export const FIELD_VALUE_JS = `(el) => { if (!el) return null; if (el instanceof HTMLInputElement && el.type === 'password') return null; return 'value' in el && typeof el.value === 'string' ? el.value : (el.isContentEditable ? el.innerText : null); }`;
/** 페이지 안에서 도는 조각 — el 이 값(value)을 가진 양식 요소인가. 이런 요소는 보이는 글(innerText)이 비어 있다. */
export const FIELD_IS_FORM_JS = `(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)`;

export const BROWSER_USER_CONTROL_ERROR = '사용자가 브라우저를 직접 조작하는 중이라 실행하지 않았습니다. 사용자가 제어권을 돌려주면 현재 페이지를 다시 관찰(snapshot·extractText)한 뒤 이어가세요.';
export const STOPPED_ERROR = '사용자가 브라우저 작업을 중지했습니다';
export const DEFAULT_TAB = '_default';

const KEYS: Readonly<Record<string, { key: string; code: string; keyCode: number; text?: string }>> = {
    Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
    Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
    Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
    Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
    Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
    ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
    ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    Home: { key: 'Home', code: 'Home', keyCode: 36 },
    End: { key: 'End', code: 'End', keyCode: 35 },
    PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
    PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
    Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
};
const MODIFIERS: Readonly<Record<string, number>> = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Command: 4, Shift: 8 };

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 서버가 보낸 승인된 업로드 목록 — 형태가 어긋난 항목은 버린다. */
export function parseApprovedUploads(raw: unknown): BrowserUploadApproval[] {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((u) => {
        const o = (u && typeof u === 'object' ? u : {}) as { host?: unknown; files?: unknown };
        return typeof o.host === 'string' && Array.isArray(o.files) && o.files.every((f) => typeof f === 'string')
            ? [{ host: o.host, files: o.files as string[] }] : [];
    });
}
export const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

/** 스크린샷 파일 이름 — 서버 러너와 같은 규칙(컨테이너 표기·./ 접두를 벗기고 안전한 문자만). */
export function screenshotName(path: unknown, i: number): string {
    let name = str(path);
    if (name.startsWith('/workspace/')) name = name.slice('/workspace/'.length);
    return name.replace(/^(\.\/)+/, '').replace(/[^A-Za-z0-9._-]/g, '_') || `screenshot-${i}.png`;
}

/** press 조합("Control+a")을 키 이벤트 값으로 — 모르는 키·조합 키면 던진다. */
export function keyEventOf(combo: string): {
    text: string | undefined;
    common: { key: string; code?: string; windowsVirtualKeyCode: number; modifiers: number };
} {
    const parts = combo.split('+').map((s) => s.trim()).filter(Boolean);
    const keyName = parts.pop();
    if (!keyName) throw new Error('press 액션에는 key 가 필요합니다');
    let modifiers = 0;
    for (const m of parts) {
        if (!(m in MODIFIERS)) throw new Error(`지원하지 않는 조합 키: ${m}`);
        modifiers |= MODIFIERS[m];
    }
    const def = KEYS[keyName] ?? ([...keyName].length === 1
        ? { key: keyName, code: '', keyCode: keyName.toUpperCase().charCodeAt(0), text: keyName }
        : null);
    if (!def) throw new Error(`지원하지 않는 키: ${keyName}`);
    // Control·Meta 조합은 글자를 넣지 않는다(단축키)
    const text = def.text && !(modifiers & (MODIFIERS.Control | MODIFIERS.Meta)) ? def.text : undefined;
    const common = { key: def.key, ...(def.code ? { code: def.code } : {}), windowsVirtualKeyCode: def.keyCode, modifiers };
    return { text, common };
}

/** 페이지 안에서 도는 조각 — click 대상 요소를 화면 가운데로 옮기고 중심 좌표를 돌려준다(없거나 크기 0 이면 null). sel 은 JSON 문자열. */
export const clickPointJs = (sel: string): string => `(() => {
                    const el = document.querySelector(${sel});
                    if (!el) return null;
                    el.scrollIntoView({ block: 'center', inline: 'center' });
                    const r = el.getBoundingClientRect();
                    return r.width === 0 && r.height === 0 ? null : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                })()`;

/** 페이지 안에서 도는 조각 — fill 대상에 초점을 주고 기존 내용을 선택한다. 'ok' · 'not-editable' · 없으면 null. sel 은 JSON 문자열. */
export const fillPrepareJs = (sel: string): string => `(() => {
                    const el = document.querySelector(${sel});
                    if (!el) return null;
                    const editable = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable;
                    if (!editable) return 'not-editable';
                    el.scrollIntoView({ block: 'center', inline: 'center' });
                    el.focus();
                    if (typeof el.select === 'function') el.select(); else getSelection().selectAllChildren(el);
                    return 'ok';
                })()`;
