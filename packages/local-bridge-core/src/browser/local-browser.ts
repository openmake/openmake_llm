/**
 * LocalBrowser — 사용자 PC 의 전용 프로필 Chrome 에서 브라우저 액션을 실행한다 (Companion P2, 2026-10-04).
 *
 * 서버 샌드박스의 브라우저 러너(infra/task-runtime/browser-runner.mjs)와 **같은 액션 형식·같은 결과 형식**을 쓴다 —
 * 서버의 `browser` 도구가 실행 위치만 바꿔 그대로 쓸 수 있어야 한다. 다른 점:
 *   - 호출이 끝나도 탭과 로그인 상태가 남는다(작업마다 탭 하나). 서버 러너는 호출마다 새 브라우저다.
 *   - 실행 직전에 **실제 탭의 주소**로 사이트 정책을 다시 판정한다(@openmake/config checkBrowserAction).
 *     서버가 본 주소와 다를 수 있다 — 리다이렉트, 페이지가 연 새 창, 사용자의 직접 조작.
 *   - 사용자가 넘겨받은 동안(setUserControl)에는 아무것도 실행하지 않는다. 한 번에 한 요청만 실행한다.
 *   - 쿠키·저장된 비밀번호·프로필 파일을 돌려주는 동작은 없다.
 *
 * 보안 불변식(변경 금지): http(s)·about:blank 밖으로 이동하지 않는다 · 사이트 정책 판정을 건너뛰는 경로가 없다 ·
 * 스크린샷·다운로드는 호출부가 준 폴더 안에만 쓴다 · 업로드는 승인된 호스트·파일 목록과 같고 호출부의 파일 검사를 통과한 것만 넣는다.
 */
import type { ChildProcess } from 'child_process';
import { browserHostOf, checkBrowserAction, parseBrowserSitePolicy, type BrowserSitePolicy, type BrowserUploadApproval } from '@openmake/config';
import {
    BROWSER_ACTION_TIMEOUT_MS, BROWSER_CLICK_SETTLE_MS, BROWSER_EXIT_WAIT_MS, BROWSER_DIALOG_MESSAGE_MAX, BROWSER_DIALOG_RECORD_MAX,
    BROWSER_EXTRACT_MAX_CHARS, BROWSER_INTERACTIVE_ROLES, BROWSER_MAX_ACTIONS, BROWSER_MAX_TABS, BROWSER_POLL_MS,
    BROWSER_SNAPSHOT_MAX_ELEMENTS, BROWSER_SNAPSHOT_NAME_MAX, BROWSER_WAIT_MAX_MS, BROWSER_FILL_ECHO_MAX_CHARS,
} from '../constants';
import { CdpClient } from './cdp';
import { launchChrome, readDevToolsEndpoint } from './chrome';
import { browserPolicyBlockOf, uploadRejectedPolicyBlock, userControlPolicyBlock } from './policy-block';
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

interface Action { type?: unknown; [k: string]: unknown }

interface DialogRecord { type: string; message: string; handled: 'accepted' | 'dismissed' }

interface Tab {
    targetId: string;
    sessionId: string;
    /** 이후 뜨는 confirm·prompt 를 수락할지 — dialog 액션이 바꾼다 */
    acceptDialogs: boolean;
    promptText?: string;
    dialogs: DialogRecord[];
    lastUsed: number;
}

const PAGE_ACTIONS = new Set(['click', 'fill', 'snapshot', 'smartClick', 'smartFill', 'press', 'waitFor', 'screenshot', 'extractText', 'extractHtml', 'uploadFile']);
const UPLOAD_UNSUPPORTED_ERROR = '이 실행 위치에서는 파일 업로드를 할 수 없습니다';
const BLANK_PAGE_ERROR = '빈 페이지(about:blank)에서 실행됨 — 먼저 goto 로 페이지를 여세요';
/** 페이지 안에서 도는 조각 — 요소의 현재 값. 입력 칸은 value, 편집 가능한 영역은 보이는 글. 비밀번호 칸과 없는 요소는 null. */
const FIELD_VALUE_JS = `(el) => { if (!el) return null; if (el instanceof HTMLInputElement && el.type === 'password') return null; return 'value' in el && typeof el.value === 'string' ? el.value : (el.isContentEditable ? el.innerText : null); }`;
/** 페이지 안에서 도는 조각 — el 이 값(value)을 가진 양식 요소인가. 이런 요소는 보이는 글(innerText)이 비어 있다. */
const FIELD_IS_FORM_JS = `(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)`;

export const BROWSER_USER_CONTROL_ERROR = '사용자가 브라우저를 직접 조작하는 중이라 실행하지 않았습니다. 사용자가 제어권을 돌려주면 현재 페이지를 다시 관찰(snapshot·extractText)한 뒤 이어가세요.';
const STOPPED_ERROR = '사용자가 브라우저 작업을 중지했습니다';
const DEFAULT_TAB = '_default';

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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 서버가 보낸 승인된 업로드 목록 — 형태가 어긋난 항목은 버린다. */
function parseApprovedUploads(raw: unknown): BrowserUploadApproval[] {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((u) => {
        const o = (u && typeof u === 'object' ? u : {}) as { host?: unknown; files?: unknown };
        return typeof o.host === 'string' && Array.isArray(o.files) && o.files.every((f) => typeof f === 'string')
            ? [{ host: o.host, files: o.files as string[] }] : [];
    });
}
const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

/** 스크린샷 파일 이름 — 서버 러너와 같은 규칙(컨테이너 표기·./ 접두를 벗기고 안전한 문자만). */
export function screenshotName(path: unknown, i: number): string {
    let name = str(path);
    if (name.startsWith('/workspace/')) name = name.slice('/workspace/'.length);
    return name.replace(/^(\.\/)+/, '').replace(/[^A-Za-z0-9._-]/g, '_') || `screenshot-${i}.png`;
}

export class LocalBrowser {
    private static readonly instances = new Map<string, LocalBrowser>();

    /** 프로필 디렉토리마다 하나 — 여러 연결 폴더(루트)가 같은 브라우저를 공유한다. */
    static forProfile(profileDir: string): LocalBrowser {
        let b = LocalBrowser.instances.get(profileDir);
        if (!b) { b = new LocalBrowser(profileDir); LocalBrowser.instances.set(profileDir, b); }
        return b;
    }

    private cdp: CdpClient | null = null;
    private proc: ChildProcess | null = null;
    private readonly tabs = new Map<string, Tab>();
    private userControl = false;
    /** 중지 요청마다 오른다 — 실행 중인 요청이 시작 때의 값과 달라지면 멈춘다 */
    private stopGeneration = 0;
    private chain: Promise<unknown> = Promise.resolve();

    private constructor(private readonly profileDir: string) {}

    /** 사용자가 브라우저를 넘겨받았는가 — 넘겨받은 동안에는 에이전트 요청을 실행하지 않는다. */
    get isUserControl(): boolean { return this.userControl; }

    /** 제어권 전환. 넘겨받을 때는 실행 중인 요청도 멈춘다. */
    setUserControl(on: boolean): void {
        this.userControl = on;
        if (on) this.stopGeneration++;
    }

    /** 실행 중인 요청을 멈춘다(다음 액션부터 실행하지 않는다). */
    requestStop(): void { this.stopGeneration++; }

    /** 요청 1건 실행 — 한 번에 하나씩(같은 세션에 두 실행 주체가 명령을 보내지 않는다). */
    run(spec: BrowserSpec, opts: BrowserRunOptions): Promise<BrowserRunResult> {
        const p = this.chain.then(() => this.runNow(spec, opts));
        this.chain = p.catch(() => undefined);
        return p;
    }

    /** 작업이 끝났다 — 그 작업의 탭을 닫는다. */
    async closeTask(taskId: string | undefined): Promise<void> {
        const key = taskId || DEFAULT_TAB;
        const tab = this.tabs.get(key);
        if (!tab) return;
        this.tabs.delete(key);
        await this.cdp?.send('Target.closeTarget', { targetId: tab.targetId }).catch(() => undefined);
    }

    /** 연결을 닫고, 이 인스턴스가 띄운 Chrome 을 끈다(로그인 정보는 프로필 디렉토리에 남는다). */
    async dispose(): Promise<void> {
        this.tabs.clear();
        this.cdp?.close();
        this.cdp = null;
        const proc = this.proc;
        this.proc = null;
        LocalBrowser.instances.delete(this.profileDir);
        if (proc && proc.exitCode === null) {
            // 끝날 때까지 기다린다 — Chrome 이 프로필에 쓰는 도중에 호출부가 디렉토리를 정리하면 엇갈린다.
            await new Promise<void>((resolve) => {
                const timer = setTimeout(resolve, BROWSER_EXIT_WAIT_MS);
                proc.once('exit', () => { clearTimeout(timer); resolve(); });
                try { proc.kill(); } catch { clearTimeout(timer); resolve(); }
            });
        }
    }

    // ── 연결·탭 ────────────────────────────────────────────────

    private async connect(): Promise<CdpClient> {
        if (this.cdp?.isOpen) return this.cdp;
        this.tabs.clear();
        // 이미 떠 있는 전용 프로필 Chrome 이 있으면 거기에 붙는다(헬퍼만 다시 뜬 경우).
        const existing = readDevToolsEndpoint(this.profileDir);
        let cdp: CdpClient | null = null;
        if (existing) cdp = await CdpClient.connect(existing, 2000).catch(() => null);
        if (!cdp) {
            const launched = await launchChrome(this.profileDir);
            this.proc = launched.proc;
            // 호스트 프로세스가 끝나면 띄운 Chrome 도 끈다 — 자식 프로세스는 저절로 끝나지 않는다.
            const proc = launched.proc;
            process.once('exit', () => { try { proc.kill(); } catch { /* noop */ } });
            cdp = await CdpClient.connect(launched.wsUrl);
        }
        cdp.on('Page.javascriptDialogOpening', (params, sessionId) => { void this.onDialog(cdp!, params, sessionId); });
        this.cdp = cdp;
        return cdp;
    }

    private async onDialog(cdp: CdpClient, params: Record<string, unknown>, sessionId?: string): Promise<void> {
        const tab = [...this.tabs.values()].find((t) => t.sessionId === sessionId);
        const type = str(params.type);
        // alert 은 확인뿐이고 beforeunload 를 취소하면 이동이 막히므로 둘은 항상 받는다. 나머지는 dialog 액션이 정한다.
        const accept = type === 'alert' || type === 'beforeunload' || !!tab?.acceptDialogs;
        if (tab && tab.dialogs.length < BROWSER_DIALOG_RECORD_MAX) {
            tab.dialogs.push({ type, message: str(params.message).slice(0, BROWSER_DIALOG_MESSAGE_MAX), handled: accept ? 'accepted' : 'dismissed' });
        }
        await cdp.send('Page.handleJavaScriptDialog', {
            accept, ...(accept && type === 'prompt' && tab?.promptText !== undefined ? { promptText: tab.promptText } : {}),
        }, sessionId).catch(() => undefined);
    }

    private async attach(cdp: CdpClient, targetId: string): Promise<string> {
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }) as { sessionId: string };
        await cdp.send('Page.enable', {}, sessionId);
        await cdp.send('Runtime.enable', {}, sessionId);
        await cdp.send('DOM.enable', {}, sessionId);
        return sessionId;
    }

    private async tabFor(cdp: CdpClient, taskId: string | undefined): Promise<Tab> {
        const key = taskId || DEFAULT_TAB;
        const found = this.tabs.get(key);
        if (found) { found.lastUsed = Date.now(); return found; }
        // 탭 수 상한 — 가장 오래 쓰지 않은 작업의 탭을 닫는다.
        while (this.tabs.size >= BROWSER_MAX_TABS) {
            const [oldKey, old] = [...this.tabs.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
            this.tabs.delete(oldKey);
            await cdp.send('Target.closeTarget', { targetId: old.targetId }).catch(() => undefined);
        }
        const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }) as { targetId: string };
        const tab: Tab = { targetId, sessionId: await this.attach(cdp, targetId), acceptDialogs: false, dialogs: [], lastUsed: Date.now() };
        this.tabs.set(key, tab);
        return tab;
    }

    /** 페이지가 새 창을 열었으면(target=_blank 등) 그 창으로 옮겨 간다 — 이후 액션과 사이트 판정이 실제로 보이는 페이지를 따른다. */
    private async followPopup(cdp: CdpClient, tab: Tab): Promise<void> {
        const { targetInfos } = await cdp.send('Target.getTargets') as { targetInfos: Array<{ targetId: string; type: string; openerId?: string }> };
        const popup = targetInfos.find((t) => t.type === 'page' && t.openerId === tab.targetId);
        if (!popup) return;
        const old = tab.targetId;
        tab.sessionId = await this.attach(cdp, popup.targetId);
        tab.targetId = popup.targetId;
        await cdp.send('Target.closeTarget', { targetId: old }).catch(() => undefined);
    }

    // ── 페이지 조작 도우미 ──────────────────────────────────────

    private async evaluate<T>(cdp: CdpClient, tab: Tab, expression: string): Promise<T> {
        const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, tab.sessionId) as {
            result?: { value?: T }; exceptionDetails?: { exception?: { description?: string }; text?: string };
        };
        if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? '페이지 스크립트 오류').split('\n')[0]);
        return r.result?.value as T;
    }

    private async currentUrl(cdp: CdpClient, tab: Tab): Promise<string> {
        return this.evaluate<string>(cdp, tab, 'location.href').catch(() => 'about:blank');
    }

    /** 조건이 참이 될 때까지 폴링 — 이동 중이라 평가가 실패하면 다시 시도한다. 시간 초과면 마지막 오류나 timeoutMessage 로 던진다. */
    private async poll<T>(fn: () => Promise<T | null>, timeoutMessage: string): Promise<T> {
        const deadline = Date.now() + BROWSER_ACTION_TIMEOUT_MS;
        let lastError: Error | null = null;
        for (;;) {
            try {
                const v = await fn();
                if (v !== null && v !== undefined) return v;
                lastError = null;
            } catch (e) {
                lastError = e instanceof Error ? e : new Error(String(e));
                // 셀렉터 문법 오류는 기다려도 풀리지 않는다
                if (/is not a valid selector|SyntaxError/i.test(lastError.message)) throw lastError;
            }
            if (Date.now() >= deadline) throw lastError ?? new Error(timeoutMessage);
            await sleep(BROWSER_POLL_MS);
        }
    }

    private async clickAt(cdp: CdpClient, tab: Tab, x: number, y: number): Promise<void> {
        const base = { x, y, button: 'left', clickCount: 1 };
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, tab.sessionId);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base }, tab.sessionId);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base }, tab.sessionId);
        // 누르기로 이동이 시작됐으면 문서가 읽힐 때까지 기다린다 — 다음 액션이 옛 페이지에서 돌지 않게.
        await sleep(BROWSER_CLICK_SETTLE_MS);
        await this.followPopup(cdp, tab);
        await this.poll(async () => ((await this.evaluate<string>(cdp, tab, 'document.readyState')) !== 'loading' ? true : null), '페이지 읽기 시간 초과');
    }

    private async typeText(cdp: CdpClient, tab: Tab, text: string): Promise<void> {
        if (text === '') {
            // 선택된 내용을 지운다(입력 비우기)
            for (const type of ['rawKeyDown', 'keyUp']) {
                await cdp.send('Input.dispatchKeyEvent', { type, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }, tab.sessionId);
            }
            return;
        }
        await cdp.send('Input.insertText', { text }, tab.sessionId);
    }

    private async press(cdp: CdpClient, tab: Tab, combo: string): Promise<void> {
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
        await cdp.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...common, ...(text ? { text } : {}) }, tab.sessionId);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common }, tab.sessionId);
        await sleep(BROWSER_CLICK_SETTLE_MS); // Enter 로 제출되는 폼 — 이동이 시작될 틈을 준다
        await this.poll(async () => ((await this.evaluate<string>(cdp, tab, 'document.readyState')) !== 'loading' ? true : null), '페이지 읽기 시간 초과');
    }

    private async goto(cdp: CdpClient, tab: Tab, url: string): Promise<void> {
        const loaded = cdp.waitFor('Page.domContentEventFired', (_p, sid) => sid === tab.sessionId, BROWSER_ACTION_TIMEOUT_MS);
        const r = await cdp.send('Page.navigate', { url }, tab.sessionId) as { errorText?: string; loaderId?: string };
        if (r.errorText) throw new Error(`이동하지 못했습니다: ${r.errorText}`);
        if (!r.loaderId) return; // 같은 문서 안 이동(#anchor)
        if (!(await loaded)) throw new Error('페이지 이동 시간 초과');
    }

    /**
     * 입력 뒤 결과에 실을 값 — 요소에 실제로 들어간 내용을 되돌려 준다. 결과가 ok 뿐이면 모델이 확인하려고 칸을 읽는데,
     * 타이핑한 값은 HTML 에 나타나지 않아 "안 들어갔다"고 보고 같은 입력을 되풀이했다(2026-10-05 실측, 승인도 그만큼 늘었다).
     * 비밀번호 칸은 싣지 않는다 — 결과는 모델 대화와 작업 기록에 남는다.
     */
    private echoed(value: unknown): { value?: string } {
        return typeof value === 'string' ? { value: value.slice(0, BROWSER_FILL_ECHO_MAX_CHARS) } : {};
    }

    /** 접근성 트리에서 상호작용 요소를 고른다 — snapshot·smartClick·smartFill 공용. */
    private async interactiveNodes(cdp: CdpClient, tab: Tab): Promise<Array<{ role: string; name: string; backendNodeId: number }>> {
        const { nodes } = await cdp.send('Accessibility.getFullAXTree', {}, tab.sessionId) as {
            nodes: Array<{ ignored?: boolean; role?: { value?: string }; name?: { value?: string }; backendDOMNodeId?: number }>;
        };
        const out: Array<{ role: string; name: string; backendNodeId: number }> = [];
        for (const n of nodes) {
            const role = str(n.role?.value);
            if (n.ignored || !BROWSER_INTERACTIVE_ROLES.includes(role) || typeof n.backendDOMNodeId !== 'number') continue;
            out.push({ role, name: str(n.name?.value).slice(0, BROWSER_SNAPSHOT_NAME_MAX), backendNodeId: n.backendDOMNodeId });
        }
        return out;
    }

    /** role·name(대소문자 무시 부분 일치)·nth 로 요소를 찾는다 — 나타날 때까지 기다린다. */
    private findByRole(cdp: CdpClient, tab: Tab, a: Action): Promise<number> {
        const role = str(a.role);
        const name = str(a.name).toLowerCase();
        const nth = Number(a.nth) || 0;
        return this.poll(async () => {
            const matches = (await this.interactiveNodes(cdp, tab)).filter((n) => n.role === role && n.name.toLowerCase().includes(name));
            return matches[nth]?.backendNodeId ?? null;
        }, `요소를 찾지 못했습니다: ${role} "${str(a.name)}"`);
    }

    private async centerOf(cdp: CdpClient, tab: Tab, backendNodeId: number): Promise<{ x: number; y: number }> {
        await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId }, tab.sessionId).catch(() => undefined);
        const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId }, tab.sessionId) as { model: { content: number[] } };
        const q = model.content;
        return { x: (q[0] + q[2] + q[4] + q[6]) / 4, y: (q[1] + q[3] + q[5] + q[7]) / 4 };
    }

    // ── 실행 ──────────────────────────────────────────────────

    private async runNow(spec: BrowserSpec, opts: BrowserRunOptions): Promise<BrowserRunResult> {
        if (this.userControl) {
            return { ok: false, results: [], error: BROWSER_USER_CONTROL_ERROR, userControl: true, policyBlock: userControlPolicyBlock(Array.isArray(spec.actions) ? spec.actions[0] : undefined) };
        }
        const actions = (Array.isArray(spec.actions) ? spec.actions : []).slice(0, BROWSER_MAX_ACTIONS) as Action[];
        const policy: BrowserSitePolicy = parseBrowserSitePolicy(spec.sitePolicy);
        const approvedHosts = Array.isArray(spec.approvedHosts) ? spec.approvedHosts.filter((h): h is string => typeof h === 'string') : [];
        const approvedUploads = parseApprovedUploads(spec.approvedUploads);
        const generation = this.stopGeneration;
        const results: BrowserActionResult[] = [];
        let policyBlock: BrowserPolicyBlock | undefined;
        let cdp: CdpClient;
        let tab: Tab;
        try {
            cdp = await this.connect();
            tab = await this.tabFor(cdp, opts.taskId);
            await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: opts.downloadDir }).catch(() => undefined);
        } catch (e) {
            return { ok: false, results, error: e instanceof Error ? e.message : String(e) };
        }
        try {
            for (let i = 0; i < actions.length; i++) {
                const a: Action = actions[i] && typeof actions[i] === 'object' ? actions[i] : {};
                tab.dialogs = [];
                let failed = false;
                try {
                    if (this.stopGeneration !== generation) {
                        if (this.userControl) policyBlock = userControlPolicyBlock(a);
                        throw new Error(this.userControl ? BROWSER_USER_CONTROL_ERROR : STOPPED_ERROR);
                    }
                    const url = await this.currentUrl(cdp, tab);
                    // 사이트 정책 — 실제 탭의 주소로 판정한다. 통과하지 못하면 실행하지 않는다.
                    const host = browserHostOf(url);
                    const denied = checkBrowserAction(a, host, policy, approvedHosts, approvedUploads);
                    if (denied) {
                        policyBlock = browserPolicyBlockOf(a, host, policy);
                        throw new Error(denied);
                    }
                    if (PAGE_ACTIONS.has(str(a.type)) && url === 'about:blank') throw new Error(BLANK_PAGE_ERROR);
                    // 업로드 — 승인을 통과한 뒤 파일을 검사한다(폴더 밖·숨김·크기·개수). 걸리면 감사 기록용 표식을 남긴다.
                    let uploadPaths: string[] = [];
                    if (a.type === 'uploadFile') {
                        if (!opts.resolveUploadFiles) throw new Error(UPLOAD_UNSUPPORTED_ERROR);
                        try { uploadPaths = await opts.resolveUploadFiles(a.files); } catch (e) { policyBlock = uploadRejectedPolicyBlock(host); throw e; }
                    }
                    results.push(await this.runAction(cdp, tab, a, i, opts, uploadPaths));
                } catch (e) {
                    results.push({ i, type: a.type, ok: false, error: e instanceof Error ? e.message : String(e) });
                    failed = true;
                }
                if (tab.dialogs.length) results[results.length - 1].dialogs = tab.dialogs;
                if (failed) break;
            }
            return { ok: results.every((r) => r.ok), finalUrl: await this.currentUrl(cdp, tab), results, ...(policyBlock ? { policyBlock } : {}) };
        } catch (e) {
            return { ok: false, results, error: e instanceof Error ? e.message : String(e), ...(policyBlock ? { policyBlock } : {}) };
        }
    }

    /** 파일 선택 칸(input[type=file])에 파일을 넣는다 — 페이지에는 사용자가 고른 것처럼 input·change 가 일어난다. */
    private async uploadFiles(cdp: CdpClient, tab: Tab, selector: string, paths: string[]): Promise<void> {
        const sel = JSON.stringify(selector);
        await this.poll(() => this.evaluate<boolean | null>(cdp, tab, `!!document.querySelector(${sel}) || null`), `요소를 찾지 못했습니다: ${selector}`);
        const { result } = await cdp.send('Runtime.evaluate', { expression: `document.querySelector(${sel})` }, tab.sessionId) as { result?: { objectId?: string } };
        if (!result?.objectId) throw new Error(`요소를 찾지 못했습니다: ${selector}`);
        const { result: kind } = await cdp.send('Runtime.callFunctionOn', {
            objectId: result.objectId, returnByValue: true,
            functionDeclaration: 'function () { return this instanceof HTMLInputElement && this.type === "file" ? (this.multiple ? "multiple" : "single") : "other"; }',
        }, tab.sessionId) as { result?: { value?: unknown } };
        if (kind?.value === 'other') throw new Error(`파일 선택 칸(input[type=file])이 아닙니다: ${selector}`);
        if (kind?.value === 'single' && paths.length > 1) throw new Error(`여러 파일을 받지 않는 칸입니다(multiple 아님): ${selector}`);
        await cdp.send('DOM.setFileInputFiles', { files: paths, objectId: result.objectId }, tab.sessionId);
    }

    private async runAction(cdp: CdpClient, tab: Tab, a: Action, i: number, opts: BrowserRunOptions, uploadPaths: string[]): Promise<BrowserActionResult> {
        const sel = JSON.stringify(str(a.selector));
        switch (a.type) {
            case 'goto':
                await this.goto(cdp, tab, str(a.url));
                return { i, type: a.type, ok: true, url: await this.currentUrl(cdp, tab) };
            case 'click': {
                const p = await this.poll(() => this.evaluate<{ x: number; y: number } | null>(cdp, tab, `(() => {
                    const el = document.querySelector(${sel});
                    if (!el) return null;
                    el.scrollIntoView({ block: 'center', inline: 'center' });
                    const r = el.getBoundingClientRect();
                    return r.width === 0 && r.height === 0 ? null : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                })()`), `요소를 찾지 못했습니다: ${str(a.selector)}`);
                await this.clickAt(cdp, tab, p.x, p.y);
                return { i, type: a.type, ok: true };
            }
            case 'fill': {
                // 요소에 초점을 주고 기존 내용을 선택한 뒤 입력한다 — input·textarea·contenteditable 공통.
                const kind = await this.poll(() => this.evaluate<string | null>(cdp, tab, `(() => {
                    const el = document.querySelector(${sel});
                    if (!el) return null;
                    const editable = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable;
                    if (!editable) return 'not-editable';
                    el.scrollIntoView({ block: 'center', inline: 'center' });
                    el.focus();
                    if (typeof el.select === 'function') el.select(); else getSelection().selectAllChildren(el);
                    return 'ok';
                })()`), `요소를 찾지 못했습니다: ${str(a.selector)}`);
                if (kind !== 'ok') throw new Error(`입력할 수 없는 요소입니다: ${str(a.selector)}`);
                await this.typeText(cdp, tab, str(a.text));
                const entered = await this.evaluate<string | null>(cdp, tab, `(${FIELD_VALUE_JS})(document.querySelector(${sel}))`);
                return { i, type: a.type, ok: true, ...this.echoed(entered) };
            }
            case 'snapshot': {
                const elements = (await this.interactiveNodes(cdp, tab)).slice(0, BROWSER_SNAPSHOT_MAX_ELEMENTS)
                    .map((n, index) => ({ index, role: n.role, name: n.name }));
                return { i, type: a.type, ok: true, elements };
            }
            case 'smartClick': {
                const p = await this.centerOf(cdp, tab, await this.findByRole(cdp, tab, a));
                await this.clickAt(cdp, tab, p.x, p.y);
                return { i, type: a.type, ok: true };
            }
            case 'smartFill': {
                const backendNodeId = await this.findByRole(cdp, tab, a);
                await cdp.send('DOM.focus', { backendNodeId }, tab.sessionId);
                const { object } = await cdp.send('DOM.resolveNode', { backendNodeId }, tab.sessionId) as { object: { objectId: string } };
                await cdp.send('Runtime.callFunctionOn', {
                    objectId: object.objectId,
                    functionDeclaration: 'function () { if (typeof this.select === "function") this.select(); else getSelection().selectAllChildren(this); }',
                }, tab.sessionId);
                await this.typeText(cdp, tab, str(a.text));
                const { result } = await cdp.send('Runtime.callFunctionOn', {
                    objectId: object.objectId, returnByValue: true,
                    functionDeclaration: `function () { return (${FIELD_VALUE_JS})(this); }`,
                }, tab.sessionId) as { result?: { value?: unknown } };
                return { i, type: a.type, ok: true, ...this.echoed(result?.value) };
            }
            case 'dialog':
                if (typeof a.accept !== 'boolean') throw new Error('dialog 액션에는 accept(true/false)가 필요합니다');
                tab.acceptDialogs = a.accept;
                tab.promptText = a.accept && a.promptText !== undefined && a.promptText !== null ? str(a.promptText) : undefined;
                return { i, type: a.type, ok: true };
            case 'press':
                await this.press(cdp, tab, str(a.key));
                return { i, type: a.type, ok: true };
            case 'wait':
                await sleep(Math.min(Math.max(Number(a.ms) || 0, 0), BROWSER_WAIT_MAX_MS));
                return { i, type: a.type, ok: true };
            case 'waitFor':
                await this.poll(async () => ((await this.evaluate<boolean>(cdp, tab, `!!document.querySelector(${sel})`)) ? true : null),
                    `요소가 나타나지 않았습니다: ${str(a.selector)}`);
                return { i, type: a.type, ok: true };
            case 'screenshot': {
                const name = screenshotName(a.path, i);
                const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!a.fullPage }, tab.sessionId) as { data: string };
                await opts.saveFile(name, Buffer.from(data, 'base64'));
                return { i, type: a.type, ok: true, path: name };
            }
            case 'extractText': {
                const text = await (a.selector
                    ? this.poll(() => this.evaluate<string | null>(cdp, tab, `(() => { const el = document.querySelector(${sel}); if (!el) return null; const v = (${FIELD_VALUE_JS})(el); return ${FIELD_IS_FORM_JS} ? (v ?? '') : el.innerText; })()`),
                        `요소를 찾지 못했습니다: ${str(a.selector)}`)
                    : this.evaluate<string>(cdp, tab, 'document.body ? document.body.innerText : ""'));
                return { i, type: a.type, ok: true, text: str(text).slice(0, BROWSER_EXTRACT_MAX_CHARS) };
            }
            case 'extractHtml': {
                const html = await (a.selector
                    ? this.poll(() => this.evaluate<string | null>(cdp, tab, `(() => { const el = document.querySelector(${sel}); return el ? el.innerHTML : null; })()`),
                        `요소를 찾지 못했습니다: ${str(a.selector)}`)
                    : this.evaluate<string>(cdp, tab, 'document.documentElement.outerHTML'));
                return { i, type: a.type, ok: true, html: str(html).slice(0, BROWSER_EXTRACT_MAX_CHARS) };
            }
            case 'uploadFile':
                await this.uploadFiles(cdp, tab, str(a.selector), uploadPaths);
                return { i, type: a.type, ok: true, files: (a.files as string[]) };
            default:
                // 모르는 액션은 사이트 정책에서 쓰기로 분류돼 이미 판정을 거쳤다 — 실행할 수 없으니 실패로 돌린다.
                throw new Error('알 수 없는 action');
        }
    }
}
