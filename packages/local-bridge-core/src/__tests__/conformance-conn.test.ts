/**
 * 연결 적합성 fixture(conformance/conn-*.json) TS 러너 — 같은 fixture 를 Rust 연결 크레이트(omk-bridge-conn)도 통과해야 한다.
 * 형식은 conformance/CONN.md. 기준은 TS 의 현재 동작이다. `conn-` 로 시작하는 파일은 이 러너 몫이고 코어 러너는 건너뛴다.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WebSocketServer, type WebSocket as ServerWs } from 'ws';
import * as constants from '../constants';
import * as endpoints from '../endpoints';
import { BridgeConnection, parseNotice, reconnectDelayMs } from '../connection';
import { BridgeCore } from '../core';
import type { BridgeMsg, BridgeNotice } from '../types';

const DIR = path.join(__dirname, '..', '..', 'conformance');
const HELPER = path.join(__dirname, '..', '..', '..', '..', 'apps', 'desktop-native', 'helper', 'src', 'helper.mjs');
const KNOWN_CONN_SUITES = ['conn-constants', 'conn-device-id', 'conn-endpoints', 'conn-frames', 'conn-notice', 'conn-reconnect-delay'];
/** conn-frames 한 사례의 실시간 한도 — hello 지연(300ms)과 루프백 왕복만 기다린다. */
const CASE_TIMEOUT_MS = 10_000;
const IO_DEADLINE_MS = 5_000;

type Obj = Record<string, unknown>;
const load = (suite: string): Obj => JSON.parse(fs.readFileSync(path.join(DIR, `${suite}.json`), 'utf8')) as Obj;

/** required 는 모두 있어야 하고, 그 밖의 키는 optional 만 쓸 수 있다. */
function shape(o: unknown, required: string[], optional: string[], at: string): void {
    const keys = o !== null && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : null;
    expect({ at, object: keys !== null }).toEqual({ at, object: true });
    expect({ at, missing: required.filter((k) => !keys!.includes(k)), unknown: keys!.filter((k) => !required.includes(k) && !optional.includes(k)) })
        .toEqual({ at, missing: [], unknown: [] });
}
/** 사례·단계 목록 — 0개면 실패한다. */
function nonEmpty(v: unknown, at: string): Obj[] {
    expect({ at, nonEmptyArray: Array.isArray(v) && v.length > 0 }).toEqual({ at, nonEmptyArray: true });
    return v as Obj[];
}
/** 묶음의 사례 — 비어 있지 않고, 키는 정해진 것만, id 는 겹치지 않는다. */
function group(doc: Obj, suite: string, name: string, required: string[], optional: string[] = []): Obj[] {
    const at = `${suite}/${name}`;
    const items = nonEmpty(doc[name], at);
    const ids = items.map((c) => c.id);
    expect({ at, duplicated: ids.filter((id, i) => ids.indexOf(id) !== i) }).toEqual({ at, duplicated: [] });
    for (const c of items) shape(c, required, optional, `${at}/${String(c.id)}`);
    return items;
}
const CASE = ['id', 'input', 'expect'];

/** suite 마다 묶음 이름과 사례 키 — 두 러너가 같은 표를 쓴다(Rust tests/conformance.rs `shapes`). */
const SHAPES: Record<string, (doc: Obj) => void> = {
    'conn-constants': (doc) => shape(doc, ['suite', 'version', 'values'], [], 'conn-constants'),
    'conn-reconnect-delay': (doc) => {
        shape(doc, ['suite', 'version', 'cases'], [], 'conn-reconnect-delay');
        for (const c of group(doc, 'conn-reconnect-delay', 'cases', CASE)) shape(c.input, ['attempt', 'baseMs', 'maxMs', 'random'], [], `conn-reconnect-delay/cases/${String(c.id)}/input`);
    },
    'conn-notice': (doc) => {
        shape(doc, ['suite', 'version', 'cases', 'trim'], [], 'conn-notice');
        group(doc, 'conn-notice', 'cases', CASE);
        for (const c of group(doc, 'conn-notice', 'trim', CASE)) shape(c.input, ['s'], [], `conn-notice/trim/${String(c.id)}/input`);
    },
    'conn-endpoints': (doc) => {
        shape(doc, ['suite', 'version', 'normalize', 'plainRemoteHttp', 'resolve', 'discover'], [], 'conn-endpoints');
        for (const g of ['normalize', 'plainRemoteHttp']) for (const c of group(doc, 'conn-endpoints', g, CASE)) shape(c.input, ['address'], [], `conn-endpoints/${g}/${String(c.id)}/input`);
        for (const c of group(doc, 'conn-endpoints', 'resolve', CASE)) shape(c.input, ['address', 'config'], [], `conn-endpoints/resolve/${String(c.id)}/input`);
        for (const c of group(doc, 'conn-endpoints', 'discover', CASE)) {
            const at = `conn-endpoints/discover/${String(c.id)}`;
            shape(c.input, ['address', 'response'], [], `${at}/input`);
            const r = (c.input as Obj).response as Obj;
            shape(r, 'fail' in r ? ['fail'] : ['status', 'body'], [], `${at}/input/response`);
        }
    },
    'conn-device-id': (doc) => {
        shape(doc, ['suite', 'version', 'rootDeviceId', 'realpathSync', 'baseId'], [], 'conn-device-id');
        for (const c of group(doc, 'conn-device-id', 'rootDeviceId', CASE)) shape(c.input, ['base', 'root'], [], `conn-device-id/rootDeviceId/${String(c.id)}/input`);
        for (const c of group(doc, 'conn-device-id', 'realpathSync', [...CASE, 'setup'])) shape(c.input, ['path'], [], `conn-device-id/realpathSync/${String(c.id)}/input`);
        for (const c of group(doc, 'conn-device-id', 'baseId', ['id', 'setup', 'expect'])) {
            const e = c.expect as Obj;
            shape(e, 'generated' in e ? ['generated', 'written'] : ['id'], [], `conn-device-id/baseId/${String(c.id)}/expect`);
        }
    },
    'conn-frames': (doc) => {
        shape(doc, ['suite', 'version', 'cases'], [], 'conn-frames');
        for (const c of group(doc, 'conn-frames', 'cases', ['id', 'opts', 'steps', 'expect'], ['setup', 'root', 'after'])) {
            const at = `conn-frames/cases/${String(c.id)}`;
            shape(c.opts, ['deviceId', 'label'], ['hostId', 'reconnectMs', 'authRetryMs', 'shouldReconnect', 'headersError'], `${at}/opts`);
            shape(c.expect, ['frames', 'statuses', 'notices', 'delays'], [], `${at}/expect`);
            nonEmpty(c.steps, `${at}/steps`).forEach((s, n) => {
                const kind = Object.keys(s)[0];
                const forms: Record<string, string[]> = { server: ['server'], serverText: ['serverText'], serverBinary: ['serverBinary'], serverClose: ['serverClose'], serverDrop: ['serverDrop'], client: ['client', ...(s.client === 'browserControl' ? ['user'] : [])] };
                expect({ at: `${at}/steps/${n}`, known: kind in forms && (kind !== 'client' || s.client === 'browserControl' || s.client === 'disconnect') }).toEqual({ at: `${at}/steps/${n}`, known: true });
                shape(s, forms[kind], [], `${at}/steps/${n}`);
            });
            for (const a of (c.after ?? []) as Obj[]) shape(a, 'absent' in a ? ['absent'] : ['exists', 'content'], [], `${at}/after`);
        }
    },
};

describe('conn fixture 목록과 모양', () => {
    it('conn- 파일은 이 러너가 아는 suite 뿐이고, 파일 이름과 suite 이름이 같다', () => {
        const files = fs.readdirSync(DIR).filter((f) => f.startsWith('conn-') && f.endsWith('.json')).sort();
        expect(files.map((f) => f.replace(/\.json$/, ''))).toEqual(KNOWN_CONN_SUITES);
        for (const f of files) {
            const doc = load(f.replace(/\.json$/, ''));
            expect(`${String(doc.suite)}.json`).toBe(f);
            expect(doc.version).toBe(1);
        }
    });
    it.each(KNOWN_CONN_SUITES)('%s — 묶음 이름·사례 키·빈 목록·id 중복, divergence·rustExpect 없음', (suite) => {
        const text = fs.readFileSync(path.join(DIR, `${suite}.json`), 'utf8');
        expect({ suite, divergence: /"(divergence|rustExpect)"\s*:/.test(text) }).toEqual({ suite, divergence: false });
        SHAPES[suite](load(suite));
    });
});

describe('conn-constants', () => {
    const doc = load('conn-constants') as { values: Obj };
    const actual = (name: string): unknown => {
        const v = (constants as Obj)[name] ?? (endpoints as Obj)[name];
        return v instanceof RegExp ? { source: v.source, flags: v.flags } : v;
    };
    it.each(Object.entries(doc.values))('%s 가 TS export 와 같다', (name, value) => {
        expect(actual(name)).toEqual(value);
    });
});

describe('conn-reconnect-delay', () => {
    const doc = load('conn-reconnect-delay') as { cases: { id: string; input: { attempt: number; baseMs: number; maxMs: number; random: number }; expect: { ms: number } }[] };
    it.each(doc.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
        expect({ ms: reconnectDelayMs(c.input.attempt, c.input.baseMs, c.input.maxMs, () => c.input.random) }).toEqual(c.expect);
    });
});

describe('conn-notice', () => {
    const doc = load('conn-notice') as { cases: { id: string; input: BridgeMsg; expect: BridgeNotice | null }[]; trim: { id: string; input: { s: string }; expect: { s: string } }[] };
    it.each(doc.cases.map((c) => [c.id, c] as const))('cases/%s', (_id, c) => {
        expect(parseNotice(c.input)).toEqual(c.expect);
    });
    it.each(doc.trim.map((c) => [c.id, c] as const))('trim/%s', (_id, c) => {
        expect({ s: c.input.s.trim() }).toEqual(c.expect);
    });
});

describe('conn-endpoints', () => {
    const doc = load('conn-endpoints') as {
        normalize: { id: string; input: { address: string }; expect: { origin: string } | null }[];
        plainRemoteHttp: { id: string; input: { address: string }; expect: { value: boolean } }[];
        resolve: { id: string; input: { address: string; config: unknown }; expect: Obj }[];
        discover: { id: string; input: { address: string; response: { status: number; body: string } | { fail: true } }; expect: Obj }[];
    };
    it.each(doc.normalize.map((c) => [c.id, c] as const))('normalize/%s', (_id, c) => {
        const o = endpoints.normalizeServerAddress(c.input.address);
        expect(o === null ? null : { origin: o }).toEqual(c.expect);
    });
    it.each(doc.plainRemoteHttp.map((c) => [c.id, c] as const))('plainRemoteHttp/%s', (_id, c) => {
        expect({ value: endpoints.isPlainRemoteHttp(c.input.address) }).toEqual(c.expect);
    });
    it.each(doc.resolve.map((c) => [c.id, c] as const))('resolve/%s', (_id, c) => {
        let got: Obj;
        try { got = { ...endpoints.resolveEndpoints(c.input.address, c.input.config) }; } catch (e) { got = { error: (e as Error).message }; }
        expect(got).toEqual(c.expect);
    });
    it.each(doc.discover.map((c) => [c.id, c] as const))('discover/%s', async (_id, c) => {
        let url: string | null = null;
        const r = c.input.response;
        const fetchImpl = async (u: string): Promise<{ ok: boolean; json: () => Promise<unknown> }> => {
            url = u;
            if ('fail' in r) throw new Error('ECONNREFUSED');
            // fetch 의 res.json() 처럼 본문을 UTF-8 로 풀고(앞의 BOM 하나를 뗀다) JSON 으로 읽는다.
            return { ok: r.status >= 200 && r.status <= 299, json: async () => JSON.parse(new TextDecoder().decode(Buffer.from(r.body))) as unknown };
        };
        let got: Obj;
        try {
            const result = await endpoints.discoverEndpoints(c.input.address, fetchImpl);
            got = { url, result: { ...result } };
        } catch (e) { got = { error: (e as Error).message }; }
        expect(got).toEqual(c.expect);
    });
});

/** 사례마다 새 임시 폴더(realpath). 이름 접두는 코어 러너와 같다. */
function tmpDir(): string {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-conformance-')));
}
type SetupItem = { dir?: string; file?: string; content?: string; contentB64?: string; symlink?: string; target?: string };
function applySetup(tmp: string, setup: SetupItem[]): void {
    for (const s of setup) {
        if (s.dir !== undefined) fs.mkdirSync(path.join(tmp, s.dir), { recursive: true });
        else if (s.file !== undefined) {
            const p = path.join(tmp, s.file);
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, s.contentB64 !== undefined ? Buffer.from(s.contentB64, 'base64') : (s.content ?? ''));
        } else if (s.symlink !== undefined) fs.symlinkSync(String(s.target).split('{{TMP}}').join(tmp), path.join(tmp, s.symlink));
        else throw new Error(`모르는 setup: ${JSON.stringify(s)}`);
    }
}
const fillTmp = (v: string, tmp: string): string => v.split('{{TMP}}').join(tmp);

describe('conn-device-id', () => {
    const doc = load('conn-device-id') as {
        rootDeviceId: { id: string; input: { base: string; root: string }; expect: { deviceId: string } }[];
        realpathSync: { id: string; setup: SetupItem[]; input: { path: string }; expect: { path: string } | { error: string } }[];
        baseId: { id: string; setup: SetupItem[]; expect: { id: string } | { generated: true; written: boolean } }[];
    };
    // 헬퍼(ESM, 가져오면 인자·환경을 읽고 폴더를 만든다)는 가져올 수 없다 — 아래 식들을 같은 글자로 실행하고, 헬퍼 소스에 그 식이 그대로 있는지 본다.
    it('helper.mjs 의 deviceId 식이 이 러너가 실행하는 식과 같은 글자다', () => {
        const src = fs.readFileSync(HELPER, 'utf8');
        for (const expr of [
            "try { return fs.readFileSync(p, 'utf8').trim(); } catch { /* 최초 생성 */ }",
            'const id = crypto.randomUUID();',
            'try { fs.writeFileSync(p, id); } catch { /* noop */ }',
            "return `${baseDeviceId()}-r-${crypto.createHash('sha256').update(root).digest('hex').slice(0, 12)}`;",
            "const p = path.join(SUPPORT_DIR, 'device-id');",
            'try { real = fs.realpathSync(folder); } catch (e) {',
        ]) expect({ expr, inHelper: src.includes(expr) }).toEqual({ expr, inHelper: true });
    });
    it.each(doc.rootDeviceId.map((c) => [c.id, c] as const))('rootDeviceId/%s', (_id, c) => {
        const deviceId = `${c.input.base}-r-${crypto.createHash('sha256').update(c.input.root).digest('hex').slice(0, 12)}`;
        expect({ deviceId }).toEqual(c.expect);
    });
    it.each(doc.realpathSync.map((c) => [c.id, c] as const))('realpathSync/%s', (_id, c) => {
        const tmp = tmpDir();
        try {
            applySetup(tmp, c.setup);
            let got: Obj;
            try { got = { path: fs.realpathSync(fillTmp(c.input.path, tmp)).split(tmp).join('{{TMP}}') }; } catch (e) { got = { error: (e as Error).message.split(tmp).join('{{TMP}}') }; }
            expect(got).toEqual(c.expect);
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    });
    it.each(doc.baseId.map((c) => [c.id, c] as const))('baseId/%s', (_id, c) => {
        const tmp = tmpDir();
        try {
            applySetup(tmp, c.setup);
            const p = path.join(tmp, 'support', 'device-id');
            let read: string | null = null;
            try { read = fs.readFileSync(p, 'utf8').trim(); } catch { /* 최초 생성 */ }
            if (read !== null) { expect({ id: read }).toEqual(c.expect); return; }
            const id = crypto.randomUUID();
            try { fs.writeFileSync(p, id); } catch { /* noop */ }
            expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
            let written = false;
            try { written = fs.readFileSync(p, 'utf8') === id; } catch { /* 없다 */ }
            expect({ generated: true, written }).toEqual(c.expect);
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    });
});

// ── conn-frames: 실 소켓 가짜 서버(connection.test.ts 의 FakeServer 방식) + 실제 코어. 시계는 진짜다.

interface FramesCase {
    id: string;
    setup?: SetupItem[];
    root?: string;
    opts: { deviceId: string; label: string; hostId?: string; reconnectMs?: number; authRetryMs?: number; shouldReconnect?: boolean; headersError?: string };
    steps: Obj[];
    expect: { frames: unknown[]; statuses: unknown[]; notices: unknown[]; delays: number[] };
    after?: ({ absent: string } | { exists: string; content: string })[];
}

class FakeServer {
    readonly frames: Obj[] = [];
    private wss!: WebSocketServer;
    private sockets: ServerWs[] = [];
    port = 0;
    connections = 0;
    async start(): Promise<void> {
        this.wss = new WebSocketServer({ port: 0 });
        await new Promise<void>((r) => this.wss.once('listening', r));
        this.port = (this.wss.address() as { port: number }).port;
        this.wss.on('connection', (ws) => {
            this.connections += 1;
            this.sockets.push(ws);
            ws.on('message', (d) => {
                const f = JSON.parse(d.toString()) as Obj;
                this.frames.push(f);
                if (f.type === 'bridge_hello') ws.send(JSON.stringify({ type: 'bridge_ready' }));
            });
        });
    }
    open(): boolean { return this.sockets.some((s) => s.readyState === s.OPEN); }
    send(data: string, binary = false): void { this.sockets[this.sockets.length - 1]?.send(binary ? Buffer.from(data) : data); }
    drop(): void { for (const s of this.sockets) s.terminate(); this.sockets = []; }
    close(code?: number, reason?: string): void { for (const s of this.sockets) { if (code === undefined) s.close(); else s.close(code, reason); } this.sockets = []; }
    async stop(): Promise<void> { this.drop(); await new Promise<void>((r) => this.wss.close(() => r())); }
}

async function until(what: string, cond: () => boolean): Promise<void> {
    const deadline = Date.now() + IO_DEADLINE_MS;
    while (!cond()) {
        if (Date.now() > deadline) throw new Error(`기다림 초과: ${what}`);
        await new Promise((r) => setTimeout(r, 2));
    }
}

/** 서버 프레임 안의 `{"{{NOW}}": 차이}` 를 지금 시각 + 차이로 바꾼다. */
function fillNow(v: unknown, now: number): unknown {
    if (Array.isArray(v)) return v.map((x) => fillNow(x, now));
    if (v && typeof v === 'object') {
        const o = v as Obj;
        if (Object.keys(o).length === 1 && '{{NOW}}' in o) return now + Number(o['{{NOW}}']);
        return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, fillNow(x, now)]));
    }
    return v;
}
/** 기대값의 자리표시를 채운다 — `{{CAPABILITIES}}` 는 이 구현의 능력 목록, `{{DURATION}}` 은 실제 값이 0 이상의 정수일 때만 그 값. */
function fillExpect(e: unknown, actual: unknown, caps: string[]): unknown {
    if (e === '{{CAPABILITIES}}') return caps;
    if (e === '{{DURATION}}') return Number.isInteger(actual) && (actual as number) >= 0 ? actual : '{{DURATION}} 이 0 이상의 정수가 아님';
    if (Array.isArray(e)) return e.map((x, i) => fillExpect(x, Array.isArray(actual) ? actual[i] : undefined, caps));
    if (e && typeof e === 'object') {
        const a = actual && typeof actual === 'object' ? (actual as Obj) : {};
        return Object.fromEntries(Object.entries(e as Obj).map(([k, x]) => [k, fillExpect(x, a[k], caps)]));
    }
    return e;
}
const SENTINEL_ID = '__conformance_end__';
const ENDING_CODES = new Set<string>(['reconnecting', 'idle', 'closed', ...constants.AUTH_CLOSE_REASONS]);

async function runFramesCase(c: FramesCase): Promise<void> {
    const tmp = tmpDir();
    const server = new FakeServer();
    await server.start();
    let conn: BridgeConnection | null = null;
    try {
        const rootRel = c.root ?? 'root';
        fs.mkdirSync(path.join(tmp, rootRel), { recursive: true });
        applySetup(tmp, c.setup ?? []);
        const core = new BridgeCore({ folder: path.join(tmp, rootRel), confirm: async () => 'no', sandboxProfileDir: tmp });
        const statuses: [string, string | null, string | null][] = [];
        const notices: BridgeNotice[] = [];
        const delays: number[] = [];
        const { opts } = c;
        conn = new BridgeConnection({
            serverUrl: `http://127.0.0.1:${server.port}`, core, deviceId: opts.deviceId, label: opts.label,
            ...(opts.hostId !== undefined ? { hostId: opts.hostId } : {}),
            headers: () => { if (opts.headersError !== undefined) throw new Error(opts.headersError); return { Authorization: 'Bearer omk_test' }; },
            onStatus: (s, code, arg) => statuses.push([s, code ?? null, arg ?? null]),
            onNotice: (n) => notices.push(n),
            onReconnectScheduled: (ms) => delays.push(ms),
            ...(opts.shouldReconnect === false ? { shouldReconnect: () => false } : {}),
            ...(opts.reconnectMs !== undefined ? { reconnectMs: opts.reconnectMs } : {}),
            ...(opts.authRetryMs !== undefined ? { authRetryMs: opts.authRetryMs } : {}),
            random: () => 1,
        });
        await conn.connect();
        if (opts.headersError === undefined) await until('연결됨', () => statuses.some(([, code]) => code === 'connected'));
        let live = opts.headersError === undefined;
        const count = (type: string): number => server.frames.filter((f) => f.type === type).length;
        const waitEnding = async (what: string): Promise<void> => {
            const from = statuses.length;
            await until(what, () => statuses.slice(from).some(([, code]) => code !== null && ENDING_CODES.has(code)));
            live = false;
        };
        for (const s of c.steps) {
            const now = Date.now();
            if ('server' in s) {
                const f = fillNow(s.server, now) as Obj;
                const before = count('bridge_result');
                server.send(JSON.stringify(f));
                if (f.type === 'bridge_exec' && live) await until(`결과 ${String(f.reqId)}`, () => count('bridge_result') > before);
            } else if ('serverText' in s) server.send(String(s.serverText));
            else if ('serverBinary' in s) {
                const before = count('bridge_result');
                server.send(String(s.serverBinary), true);
                if ((JSON.parse(String(s.serverBinary)) as Obj).type === 'bridge_exec') await until('바이너리 결과', () => count('bridge_result') > before);
            } else if ('serverClose' in s) {
                const sc = s.serverClose as { code?: number; reason?: string };
                const p = waitEnding('닫힘 처리');
                server.close(sc.code, sc.reason);
                await p;
            } else if ('serverDrop' in s) {
                const p = waitEnding('끊김 처리');
                server.drop();
                await p;
            } else if (s.client === 'browserControl') {
                const before = count('bridge_event');
                conn.notifyBrowserControl(Boolean(s.user));
                if (live) await until('bridge_event', () => count('bridge_event') > before);
            } else if (s.client === 'disconnect') {
                const wasLive = live;
                const p = wasLive ? waitEnding('종료') : Promise.resolve();
                conn.disconnect();
                await p;
            } else throw new Error(`모르는 단계: ${JSON.stringify(s)}`);
        }
        if (live && server.open()) {
            // 끝 표지 — 만료된 요청은 코어 없이 바로 거절되므로, 그 응답이 오면 앞 프레임의 처리가 끝났다.
            const before = server.frames.length;
            server.send(JSON.stringify({ type: 'bridge_exec', kind: 'read', path: 'x', reqId: SENTINEL_ID, expiresAt: Date.now() - constants.EXPIRY_SKEW_TOLERANCE_MS - 60_000 }));
            await until('끝 표지 응답', () => server.frames.slice(before).some((f) => f.reqId === SENTINEL_ID));
        }
        const frames = server.frames.filter((f) => f.reqId !== SENTINEL_ID);
        const caps = core.capabilities();
        expect({ frames, statuses, notices, delays }).toEqual(fillExpect(c.expect, { frames, statuses, notices, delays }, caps));
        expect(opts.headersError === undefined ? server.connections : 0).toBe(server.connections);
        for (const a of c.after ?? []) {
            if ('absent' in a) expect({ absent: a.absent, exists: fs.existsSync(path.join(tmp, a.absent)) }).toEqual({ absent: a.absent, exists: false });
            else expect({ exists: a.exists, content: fs.readFileSync(path.join(tmp, a.exists), 'utf8') }).toEqual({ exists: a.exists, content: a.content });
        }
    } finally {
        conn?.disconnect();
        await server.stop();
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

describe('conn-frames', () => {
    const doc = load('conn-frames') as { cases: FramesCase[] };
    it.each(doc.cases.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
        await runFramesCase(c);
    }, CASE_TIMEOUT_MS);
});
