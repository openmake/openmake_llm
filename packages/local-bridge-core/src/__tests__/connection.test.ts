/**
 * BridgeConnection — 가짜 WS 서버로 프로토콜 상태기계 검증 (축2 plan 의 '헤드리스 하네스').
 * hello 프레임·reqId 상관·durationMs·재연결·해제 시 일괄 승인 회수까지 실제 소켓으로 본다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WebSocketServer, type WebSocket as ServerWs } from 'ws';
import { BridgeConnection, parseNotice } from '../connection';
import { BridgeCore } from '../core';
import { BRIDGE_KINDS, EXPIRY_SKEW_TOLERANCE_MS, NOTICE_TOOL_NAME_MAX } from '../constants';
import type { BridgeNotice } from '../types';

interface Frame { type?: string; reqId?: string; result?: Record<string, unknown>; deviceId?: string; label?: string; folderName?: string }

/** 가짜 브리지 서버 — 받은 프레임을 쌓고, 테스트가 임의 프레임을 내려보낼 수 있다. */
class FakeServer {
    readonly received: Frame[] = [];
    private wss!: WebSocketServer;
    private sockets: ServerWs[] = [];
    private waiters: Array<{ pred: (f: Frame) => boolean; resolve: (f: Frame) => void }> = [];
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
                const f = JSON.parse(d.toString()) as Frame;
                this.received.push(f);
                this.waiters = this.waiters.filter((w) => (w.pred(f) ? (w.resolve(f), false) : true));
                if (f.type === 'bridge_hello') ws.send(JSON.stringify({ type: 'bridge_ready' }));
            });
        });
    }
    send(frame: Record<string, unknown>): void { this.sockets[this.sockets.length - 1]?.send(JSON.stringify(frame)); }
    dropAll(): void { for (const s of this.sockets) s.terminate(); this.sockets = []; }
    waitFor(pred: (f: Frame) => boolean, ms = 5000): Promise<Frame> {
        const hit = this.received.find(pred);
        if (hit) return Promise.resolve(hit);
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('frame timeout')), ms);
            this.waiters.push({ pred, resolve: (f) => { clearTimeout(t); resolve(f); } });
        });
    }
    async stop(): Promise<void> { this.dropAll(); await new Promise<void>((r) => this.wss.close(() => r())); }
}

describe('BridgeConnection (가짜 WS 서버)', () => {
    let server: FakeServer;
    let base: string;
    let conn: BridgeConnection | null = null;
    const statuses: string[] = [];

    beforeEach(async () => {
        server = new FakeServer();
        await server.start();
        base = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-conn-'));
        fs.writeFileSync(path.join(base, 'f.txt'), 'data');
        statuses.length = 0;
    });
    afterEach(async () => { conn?.disconnect(); conn = null; await server.stop(); });

    function makeConn(reconnectMs = 100): BridgeConnection {
        const core = new BridgeCore({
            folder: base,
            confirm: async () => 'all',
            sandboxProfileDir: os.tmpdir(),
        });
        conn = new BridgeConnection({
            serverUrl: `http://127.0.0.1:${server.port}`,
            core,
            deviceId: 'test-device-1',
            label: 'unit · test',
            headers: () => ({ Authorization: 'Bearer omk_test' }),
            onStatus: (s) => statuses.push(s),
            reconnectMs,
        });
        return conn;
    }

    it('hello 프레임(deviceId/label/folderName) → bridge_ready → 연결됨 상태', async () => {
        await makeConn().connect();
        const hello = await server.waitFor((f) => f.type === 'bridge_hello');
        expect(hello).toMatchObject({ deviceId: 'test-device-1', label: 'unit · test', folderName: path.basename(base) });
        await new Promise((r) => setTimeout(r, 50));
        expect(statuses.some((s) => s.startsWith('연결됨'))).toBe(true);
    });

    it('hello 프레임에 지원 요청 종류와 PC 식별자를 싣는다', async () => {
        const core = new BridgeCore({ folder: base, confirm: async () => 'all', sandboxProfileDir: os.tmpdir() });
        conn = new BridgeConnection({
            serverUrl: `http://127.0.0.1:${server.port}`, core, deviceId: 'pc-1-r-abc', hostId: 'pc-1', label: 'unit · test',
            headers: () => ({ Authorization: 'Bearer omk_test' }),
        });
        await conn.connect();
        const hello = await server.waitFor((f) => f.type === 'bridge_hello') as Frame & { capabilities?: string[]; hostId?: string };
        expect(hello.hostId).toBe('pc-1');
        expect(hello.capabilities).toEqual([...BRIDGE_KINDS]);
    });

    it('hostId 를 주지 않으면 hello 에 싣지 않는다 (서버가 deviceId 로 본다)', async () => {
        await makeConn().connect();
        const hello = await server.waitFor((f) => f.type === 'bridge_hello') as Frame & { hostId?: string };
        expect('hostId' in hello).toBe(false);
    });

    it('만료된 요청은 실행하지 않고 거절한다', async () => {
        await makeConn().connect();
        await server.waitFor((f) => f.type === 'bridge_hello');
        server.send({ type: 'bridge_exec', kind: 'write', path: 'late.txt', contentB64: Buffer.from('x').toString('base64'), reqId: 'r-late', expiresAt: Date.now() - EXPIRY_SKEW_TOLERANCE_MS - 1000 });
        const res = await server.waitFor((f) => f.type === 'bridge_result' && f.reqId === 'r-late');
        expect(res.result).toMatchObject({ ok: false, rejected: 'expired' });
        expect(fs.existsSync(path.join(base, 'late.txt'))).toBe(false);
    });

    it('같은 reqId 가 다시 오면 두 번 실행하지 않는다', async () => {
        await makeConn().connect();
        await server.waitFor((f) => f.type === 'bridge_hello');
        server.send({ type: 'bridge_exec', kind: 'write', path: 'once.txt', contentB64: Buffer.from('first').toString('base64'), reqId: 'r-dup' });
        await server.waitFor((f) => f.type === 'bridge_result' && f.reqId === 'r-dup');
        server.send({ type: 'bridge_exec', kind: 'write', path: 'once.txt', contentB64: Buffer.from('second').toString('base64'), reqId: 'r-dup' });
        const res = await server.waitFor((f) => f.type === 'bridge_result' && f.reqId === 'r-dup' && f.result?.ok === false);
        expect(res.result).toMatchObject({ ok: false, rejected: 'duplicate' });
        expect(fs.readFileSync(path.join(base, 'once.txt'), 'utf8')).toBe('first');
    });

    it('bridge_exec → 코어 실행 → 같은 reqId 의 bridge_result(durationMs 포함)', async () => {
        await makeConn().connect();
        await server.waitFor((f) => f.type === 'bridge_hello');
        server.send({ type: 'bridge_exec', kind: 'read', path: 'f.txt', reqId: 'r-42' });
        const res = await server.waitFor((f) => f.type === 'bridge_result' && f.reqId === 'r-42');
        expect(res.result).toMatchObject({ ok: true, content: 'data' });
        expect(typeof res.result!.durationMs).toBe('number');
    });

    it('코어 throw(스코프 밖)는 error 결과로 변환되어 응답한다 — 요청 유실 없음', async () => {
        await makeConn().connect();
        await server.waitFor((f) => f.type === 'bridge_hello');
        server.send({ type: 'bridge_exec', kind: 'read', path: '../../etc/hosts', reqId: 'r-esc' });
        const res = await server.waitFor((f) => f.type === 'bridge_result' && f.reqId === 'r-esc');
        expect(res.result).toMatchObject({ ok: false });
        expect(String(res.result!.error)).toContain('스코프 밖');
    });

    it('잘못된 JSON·모르는 type 프레임은 무시한다', async () => {
        await makeConn().connect();
        await server.waitFor((f) => f.type === 'bridge_hello');
        server.send({ type: 'mystery' });
        server.send({ type: 'bridge_exec', kind: 'read', path: 'f.txt', reqId: 'after' });
        const res = await server.waitFor((f) => f.type === 'bridge_result' && f.reqId === 'after');
        expect(res.result).toMatchObject({ ok: true }); // 이후 프레임 정상 처리 = 앞 프레임에 안 죽음
    });

    it('서버가 끊으면 재연결하고(hello 재전송), disconnect() 후에는 재연결하지 않는다', async () => {
        await makeConn().connect();
        await server.waitFor((f) => f.type === 'bridge_hello');
        server.dropAll();
        await server.waitFor((f) => f.type === 'bridge_hello' && server.connections >= 2, 8000);
        expect(server.connections).toBeGreaterThanOrEqual(2);
        const before = server.connections;
        conn!.disconnect();
        await new Promise((r) => setTimeout(r, 400)); // reconnectMs(100) 의 4배 대기
        expect(server.connections).toBe(before);
        expect(statuses[statuses.length - 1]).toBe('종료');
    });

    it('headers() 실패는 상태만 알리고 재연결하지 않는다 (데스크톱 토큰 부재 의미 보존)', async () => {
        const core = new BridgeCore({ folder: base, confirm: async () => 'no', sandboxProfileDir: os.tmpdir() });
        conn = new BridgeConnection({
            serverUrl: `http://127.0.0.1:${server.port}`, core, deviceId: 'd', label: 'l',
            headers: () => { throw new Error('로그인 필요 — 앱에서 로그인 후 다시 연결'); },
            onStatus: (s) => statuses.push(s),
            reconnectMs: 50,
        });
        await conn.connect();
        await new Promise((r) => setTimeout(r, 300));
        expect(server.connections).toBe(0);
        expect(statuses).toContain('로그인 필요 — 앱에서 로그인 후 다시 연결');
    });

    /** 알림·상태 코드 검증용 연결 — onNotice·onStatus(code, arg) 를 기록한다. */
    function noticeConn(notices: BridgeNotice[], codes: Array<[string, string | undefined]> = []): BridgeConnection {
        const core = new BridgeCore({ folder: base, confirm: async () => 'no', sandboxProfileDir: os.tmpdir() });
        conn = new BridgeConnection({
            serverUrl: `http://127.0.0.1:${server.port}`, core, deviceId: 'test-device-n', label: 'unit · notice',
            headers: () => ({ Authorization: 'Bearer omk_test' }),
            onStatus: (s, code, arg) => { statuses.push(s); if (code) codes.push([code, arg]); },
            onNotice: (n) => notices.push(n),
            reconnectMs: 100,
        });
        return conn;
    }

    it('bridge_notice(approval_pending)는 검증 후 onNotice 로 넘기고 서버로 아무 프레임도 보내지 않는다', async () => {
        const notices: BridgeNotice[] = [];
        await noticeConn(notices).connect();
        await server.waitFor((f) => f.type === 'bridge_hello');
        await new Promise((r) => setTimeout(r, 50));
        const before = server.received.length;
        server.send({ type: 'bridge_notice', notice: 'approval_pending', taskId: 'task-aaaaaaaa-0001', toolName: 'file_ops' });
        await new Promise((r) => setTimeout(r, 150));
        expect(notices).toEqual([{ notice: 'approval_pending', taskId: 'task-aaaaaaaa-0001', toolName: 'file_ops' }]);
        expect(server.received.length).toBe(before); // 단방향 — 응답·실행 없음
    });

    it('notifyBrowserControl 은 bridge_event(browser_control) 단방향 프레임을 보낸다', async () => {
        await noticeConn([]).connect();
        await server.waitFor((f) => f.type === 'bridge_hello');
        await new Promise((r) => setTimeout(r, 50));
        conn!.notifyBrowserControl(false);
        const f = await server.waitFor((x) => x.type === 'bridge_event');
        expect(f).toEqual({ type: 'bridge_event', kind: 'browser_control', user: false });
    });

    it('연결 전 notifyBrowserControl 은 아무것도 하지 않는다(던지지 않는다)', () => {
        expect(() => noticeConn([]).notifyBrowserControl(true)).not.toThrow();
    });

    it('종류·taskId·toolName 이 부적합한 알림은 버린다', async () => {
        const notices: BridgeNotice[] = [];
        await noticeConn(notices).connect();
        await server.waitFor((f) => f.type === 'bridge_hello');
        server.send({ type: 'bridge_notice', notice: 'run_command', taskId: 'task-aaaaaaaa-0001', toolName: 'x' });
        server.send({ type: 'bridge_notice', notice: 'approval_pending', taskId: '../../etc', toolName: 'x' });
        server.send({ type: 'bridge_notice', notice: 'approval_pending', taskId: 'task-aaaaaaaa-0001' });
        server.send({ type: 'bridge_notice', notice: 'approval_pending', taskId: 'task-aaaaaaaa-0001', toolName: '   ' });
        await new Promise((r) => setTimeout(r, 150));
        expect(notices).toEqual([]);
    });

    it('도구 이름은 제어문자를 걷어내고 길이를 자른다 (서버 발 텍스트는 표시 전용)', () => {
        const nul = String.fromCharCode(0);
        const lf = String.fromCharCode(10);
        const n = parseNotice({ type: 'bridge_notice', notice: 'approval_pending', taskId: 'task-aaaaaaaa-0001', toolName: `ask${nul}_human${lf}` });
        expect(n?.toolName).toBe('ask_human');
        const long = 'a'.repeat(NOTICE_TOOL_NAME_MAX + 50);
        expect(parseNotice({ type: 'bridge_notice', notice: 'approval_pending', taskId: 'task-aaaaaaaa-0001', toolName: long })?.toolName)
            .toHaveLength(NOTICE_TOOL_NAME_MAX);
    });

    it('상태 알림에 코드와 치환값을 함께 준다 — 호스트 다국어 표시용', async () => {
        const codes: Array<[string, string | undefined]> = [];
        await noticeConn([], codes).connect();
        await server.waitFor((f) => f.type === 'bridge_hello');
        await new Promise((r) => setTimeout(r, 50));
        expect(codes).toEqual(expect.arrayContaining([['connecting', undefined], ['connected', path.basename(fs.realpathSync(base))]]));
        conn!.disconnect();
        await new Promise((r) => setTimeout(r, 100));
        expect(codes[codes.length - 1]).toEqual(['closed', undefined]);
    });
});
