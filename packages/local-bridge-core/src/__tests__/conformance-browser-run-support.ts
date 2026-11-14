/**
 * conformance-browser-run.test.ts 의 도우미 — 테스트 파일이 아니다(jest testMatch 밖). `browser-run` 사례 하나를 돌린다:
 * 루프백에 가짜 CDP(`ws` 서버)를 띄우고 프로필에 `DevToolsActivePort` 를 써서 "떠 있는 Chrome 에 붙기" 길로 LocalBrowser 를 탄다
 * (모의 없음, Chrome 없음). 서버는 받은 명령마다 규칙 표(사례 `cdp` → `defaults`)에서 처음 맞는 규칙으로 답한다. 형식은 conformance/BROWSER.md.
 * Rust 러너(apps/openmake-code/crates/omk-bridge-core/tests/conformance_browser/run.rs)가 같은 규칙을 따로 적는다.
 */
import * as fs from 'fs';
import type { AddressInfo } from 'net';
import * as path from 'path';
import { WebSocketServer, type WebSocket } from 'ws';
import { LocalBrowser } from '../browser/local-browser';
import type { BrowserRunOptions } from '../browser/local-browser-defs';
import { resolveUploadFiles } from '../browser/upload-files';
import { applySetup, canonical, makeTmp, type FsSetup } from './conformance-browser-support';

export type Emit = { method: string; params?: unknown; session?: boolean | string };
export type Rule = { on: string; where?: unknown; match?: string; session?: boolean; reply?: unknown; error?: string; times?: number; emit?: Emit[] };
export type RunInput = {
    spec: Record<string, unknown>;
    opts: { taskId?: string; saveError?: string; upload?: boolean; place?: boolean };
    cdp: Rule[];
    sentDefaults?: boolean;
    userControl?: boolean;
};
export type Sent = { method: string; params: unknown; session: string | null };
export type RunOut = { stdout: string; sent: Sent[]; saved: Array<{ name: string; hex: string }>; unmatched: string[] };

export const RULE_KEYS = ['on', 'where', 'match', 'session', 'reply', 'error', 'times', 'emit'];
export const OPTS_KEYS = ['taskId', 'saveError', 'upload', 'place'];

/** want 가 got 의 부분인가 — 객체는 적힌 키만 재귀로, 그 밖은 값 전체가 같아야 한다. */
export function partial(want: unknown, got: unknown): boolean {
    if (want && typeof want === 'object' && !Array.isArray(want)) {
        if (!got || typeof got !== 'object' || Array.isArray(got)) return false;
        return Object.entries(want).every(([k, v]) => k in got && partial(v, (got as Record<string, unknown>)[k]));
    }
    return canonical(want) === canonical(got);
}

/** 규칙의 `match` — 평가 식·함수 선언 글자에 들어 있는가. */
function codeOf(params: unknown): string {
    const p = (params ?? {}) as Record<string, unknown>;
    const v = p.expression ?? p.functionDeclaration;
    return typeof v === 'string' ? v : '';
}

type Slot = { rule: Rule; left: number; isDefault: boolean };

function pick(slots: Slot[], method: string, params: unknown, session: string | null): Slot | undefined {
    return slots.find((s) => s.left > 0 && s.rule.on === method
        && (s.rule.where === undefined || partial(s.rule.where, params))
        && (s.rule.match === undefined || codeOf(params).includes(s.rule.match))
        && (s.rule.session === undefined || s.rule.session === (session !== null)));
}

const withSession = (o: Record<string, unknown>, session: string | null): string => JSON.stringify(session ? { ...o, sessionId: session } : o);

/** 사례 하나 — 결과 JSON 글자·받은 명령·저장 호출. 임시 폴더 경로는 `{{TMP}}` 로 바꿔 돌려준다. */
export async function runBrowserCase(defaults: Rule[], setup: FsSetup[], input: RunInput): Promise<RunOut> {
    const tmp = makeTmp();
    const profile = path.join(tmp, 'profile');
    const root = path.join(tmp, 'root');
    const slots: Slot[] = [...input.cdp.map((rule) => ({ rule, left: rule.times ?? Infinity, isDefault: false })),
        ...defaults.map((rule) => ({ rule, left: rule.times ?? Infinity, isDefault: true }))];
    const sent: Sent[] = [];
    const saved: RunOut['saved'] = [];
    const unmatched: string[] = [];
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0, perMessageDeflate: false });
    const onMessage = (ws: WebSocket, raw: string): void => {
        const m = JSON.parse(raw) as { id: number; method: string; params?: unknown; sessionId?: string };
        const session = m.sessionId ?? null;
        const params = m.params ?? {};
        const slot = pick(slots, m.method, params, session);
        if (!slot) unmatched.push(`${m.method} ${JSON.stringify(params)}`);
        if (!slot?.isDefault || input.sentDefaults) sent.push({ method: m.method, params, session });
        if (!slot) { ws.send(withSession({ id: m.id, error: { message: `규칙 없음: ${m.method}` } }, session)); return; }
        slot.left -= 1;
        // 이벤트를 답보다 먼저 보낸다 — 두 구현이 같은 순서로 받는다
        for (const e of slot.rule.emit ?? []) {
            const es = e.session === true ? session : typeof e.session === 'string' ? e.session : null;
            ws.send(withSession({ method: e.method, params: e.params ?? {} }, es));
        }
        ws.send(withSession(slot.rule.error !== undefined ? { id: m.id, error: { message: slot.rule.error } } : { id: m.id, result: slot.rule.reply ?? {} }, session));
    };
    server.on('connection', (ws) => ws.on('message', (d) => onMessage(ws, d.toString())));
    try {
        await new Promise<void>((resolve) => server.once('listening', () => resolve()));
        applySetup(tmp, setup);
        fs.mkdirSync(root, { recursive: true });
        fs.mkdirSync(profile, { recursive: true });
        fs.writeFileSync(path.join(profile, 'DevToolsActivePort'), `${(server.address() as AddressInfo).port}\n/devtools/browser/fake`);
        const browser = LocalBrowser.forProfile(profile);
        if (input.userControl) browser.setUserControl(true);
        const o = input.opts;
        const opts: BrowserRunOptions = {
            ...(o.taskId !== undefined ? { taskId: o.taskId } : {}),
            saveFile: async (name, data) => {
                saved.push({ name, hex: data.toString('hex') });
                if (o.saveError !== undefined) throw new Error(o.saveError);
            },
            ...(o.place ? { placeDownload: async (name: string) => name } : {}),
            ...(o.upload ? { resolveUploadFiles: (files: unknown) => resolveUploadFiles(root, files) } : {}),
        };
        let stdout: string;
        try {
            stdout = JSON.stringify(await browser.run(input.spec, opts));
        } finally {
            await browser.dispose();
        }
        const norm = <T>(v: T): T => JSON.parse(JSON.stringify(v).split(tmp).join('{{TMP}}')) as T;
        return { stdout: stdout.split(tmp).join('{{TMP}}'), sent: norm(sent), saved, unmatched };
    } finally {
        for (const c of server.clients) c.terminate();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}
