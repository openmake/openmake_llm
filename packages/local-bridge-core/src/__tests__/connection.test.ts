/**
 * BridgeConnection — 가짜 WS 서버로 프로토콜 상태기계 검증 (축2 plan 의 '헤드리스 하네스').
 * hello 프레임·reqId 상관·durationMs·재연결·해제 시 일괄 승인 회수까지 실제 소켓으로 본다.
 */
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { WebSocket, WebSocketServer, type WebSocket as ServerWs } from 'ws';
import { BridgeConnection, parseNotice } from '../connection';
import { BridgeCore } from '../core';
import { AUTH_CLOSE_REASONS, AUTH_CLOSE_TEXT, BRIDGE_KINDS, EXPIRY_SKEW_TOLERANCE_MS, HELLO_DELAY_MS, NOTICE_TOOL_NAME_MAX } from '../constants';
import type { BridgeNotice } from '../types';

interface Frame { type?: string; reqId?: string; result?: Record<string, unknown>; deviceId?: string; label?: string; folderName?: string }

/** 가짜 브리지 서버 — 받은 프레임을 쌓고, 테스트가 임의 프레임을 내려보낼 수 있다. */
class FakeServer {
    readonly received: Frame[] = [];
    /** 연결별 받은 프레임 — 한 연결에 hello 가 몇 번 왔는지 따로 센다. */
    readonly receivedByConn: Frame[][] = [];
    private wss!: WebSocketServer;
    private sockets: ServerWs[] = [];
    private waiters: Array<{ pred: (f: Frame) => boolean; resolve: (f: Frame) => void }> = [];
    port = 0;
    connections = 0;

    /** autoPong=false 면 디바이스의 ping 에 응답하지 않는다 — 반쯤 죽은 연결 흉내. */
    constructor(private readonly autoPong = true) {}

    async start(): Promise<void> {
        this.wss = new WebSocketServer({ port: 0, autoPong: this.autoPong });
        await new Promise<void>((r) => this.wss.once('listening', r));
        this.port = (this.wss.address() as { port: number }).port;
        this.wss.on('connection', (ws) => {
            this.connections += 1;
            this.sockets.push(ws);
            const mine: Frame[] = [];
            this.receivedByConn.push(mine);
            ws.on('message', (d) => {
                const f = JSON.parse(d.toString()) as Frame;
                this.received.push(f);
                mine.push(f);
                this.waiters = this.waiters.filter((w) => (w.pred(f) ? (w.resolve(f), false) : true));
                if (f.type === 'bridge_hello') ws.send(JSON.stringify({ type: 'bridge_ready' }));
            });
        });
    }
    send(frame: Record<string, unknown>): void { this.sockets[this.sockets.length - 1]?.send(JSON.stringify(frame)); }
    dropAll(): void { for (const s of this.sockets) s.terminate(); this.sockets = []; }
    /** 서버가 사유를 실어 닫는다(키 폐기·계정 비활성 등). */
    closeAll(code: number, reason: string): void { for (const s of this.sockets) s.close(code, reason); this.sockets = []; }
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

/** 실 소켓 왕복 대기 한도(실시간) — 루프백 왕복이라 보통 수 ms. 가짜 시간과 무관하게 벽시계로 잰다. */
const IO_DEADLINE_MS = 4000;

/** 실 I/O 가 끝나 조건이 설 때까지 이벤트 루프를 돌린다(가짜 시간은 움직이지 않는다). */
async function until(what: string, cond: () => boolean): Promise<void> {
    const deadline = performance.now() + IO_DEADLINE_MS;
    while (!cond()) {
        if (performance.now() > deadline) throw new Error(`기다림 초과: ${what}`);
        await new Promise((r) => setImmediate(r));
    }
}

/**
 * 연결 쪽 시간(setTimeout·setInterval·Date)만 가짜로 두고 run 을 돌린다 — 실 소켓 I/O 는 진짜로 두고 시간은
 * 테스트가 advanceTimersByTimeAsync 로만 민다. 부하 걸린 CI 에서도 결과가 벽시계 속도에 좌우되지 않는다(10-16 flaky).
 */
async function withFakeClock(run: () => Promise<void>): Promise<void> {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'performance'] });
    try { await run(); } finally { jest.useRealTimers(); }
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

    const socketOpen = (): boolean => conn?.socket()?.readyState === WebSocket.OPEN;
    const hellos = (): number => server.received.filter((f) => f.type === 'bridge_hello').length;
    /** (가짜 시계 안에서) n 번째 연결이 열리면 hello 지연을 밀고 그 연결의 hello 까지 기다린다. */
    async function openAndHello(n: number): Promise<void> {
        await until(`${n}번째 연결 open`, () => server.connections === n && socketOpen());
        await jest.advanceTimersByTimeAsync(HELLO_DELAY_MS);
        await until(`${n}번째 hello`, () => hellos() === n);
    }

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
        const RECONNECT_MS = 100;
        await withFakeClock(async () => {
            await makeConn(RECONNECT_MS).connect();
            await openAndHello(1);
            server.dropAll();
            await until('끊김', () => statuses.includes('끊김 — 재연결 대기'));
            await jest.advanceTimersByTimeAsync(RECONNECT_MS); // 첫 재연결 대기는 [reconnectMs/2, reconnectMs]
            await openAndHello(2);
            const before = server.connections;
            conn!.disconnect();
            await until('종료', () => statuses[statuses.length - 1] === '종료');
            await jest.advanceTimersByTimeAsync(RECONNECT_MS * 4); // 재연결 대기를 넉넉히 지난다
            expect(jest.getTimerCount()).toBe(0); // 걸린 재연결 타이머가 없다
            expect(conn!.socket()).toBeNull(); // connect() 가 다시 돌지 않았다
            expect(server.connections).toBe(before);
            expect(statuses[statuses.length - 1]).toBe('종료');
        });
    });

    it('서버가 아무 프레임도 보내지 않으면(반쯤 죽은 연결) 스스로 끊고 재연결한다', async () => {
        const PING_MS = 100;
        const TIMEOUT_MS = 500; // hello 지연보다 길게 — 첫 연결이 hello·ready 를 마친 뒤 침묵해야 '반쯤 죽은' 상황
        const RECONNECT_MS = 50;

        await server.stop();
        server = new FakeServer(false);
        await server.start();
        await withFakeClock(async () => {
            const core = new BridgeCore({ folder: base, confirm: async () => 'all', sandboxProfileDir: os.tmpdir() });
            conn = new BridgeConnection({
                serverUrl: `http://127.0.0.1:${server.port}`, core, deviceId: 'test-device-1', label: 'unit · test',
                headers: () => ({ Authorization: 'Bearer omk_test' }), onStatus: (s) => statuses.push(s),
                reconnectMs: RECONNECT_MS, livenessPingMs: PING_MS, livenessTimeoutMs: TIMEOUT_MS,
                random: () => 1, // 재연결 대기 = reconnectMs 그대로(흩기 없음)
            });
            // 1) 첫 연결 → hello → bridge_ready
            await conn.connect();
            await until('첫 연결 open', () => server.connections === 1 && socketOpen());
            await jest.advanceTimersByTimeAsync(HELLO_DELAY_MS);
            await until('첫 bridge_ready', () => hellos() === 1 && statuses.some((s) => s.startsWith('연결됨')));
            expect(statuses).not.toContain('끊김 — 재연결 대기');
            // 2) 서버는 소켓을 닫지 않고 침묵(ping 에도 무응답) — 무응답 한도를 넘기면 디바이스가 스스로 끊어야 한다.
            await jest.advanceTimersByTimeAsync(TIMEOUT_MS + 2 * PING_MS);
            await until('디바이스 쪽 끊김', () => statuses.includes('끊김 — 재연결 대기'));
            expect(server.connections).toBe(1);
            // 3) 재연결 대기 → 두 번째 연결 → hello 재전송
            await jest.advanceTimersByTimeAsync(RECONNECT_MS);
            await until('두 번째 연결 open', () => server.connections === 2 && socketOpen());
            await jest.advanceTimersByTimeAsync(HELLO_DELAY_MS);
            await until('두 번째 hello', () => hellos() === 2);
            expect(server.connections).toBe(2);
        });
    });

    it('hello 지연 전에 끊긴 소켓의 hello 타이머는 다음 소켓에 hello 를 보내지 않는다 (연결마다 hello 한 번)', async () => {
        const RECONNECT_MS = 50;
        const hellosOn = (i: number): number => (server.receivedByConn[i] ?? []).filter((f) => f.type === 'bridge_hello').length;
        await withFakeClock(async () => {
            const core = new BridgeCore({ folder: base, confirm: async () => 'all', sandboxProfileDir: os.tmpdir() });
            conn = new BridgeConnection({
                serverUrl: `http://127.0.0.1:${server.port}`, core, deviceId: 'test-device-1', label: 'unit · test',
                headers: () => ({ Authorization: 'Bearer omk_test' }), onStatus: (s) => statuses.push(s),
                reconnectMs: RECONNECT_MS, random: () => 1, // 재연결 대기 = reconnectMs 그대로
            });
            // 1) 첫 소켓이 열리자마자(hello 지연 전) 서버가 끊는다
            await conn.connect();
            await until('첫 연결 open', () => server.connections === 1 && socketOpen());
            server.dropAll();
            await until('첫 연결 끊김', () => statuses.includes('끊김 — 재연결 대기'));
            // 2) 재연결 → 두 번째 소켓 open
            await jest.advanceTimersByTimeAsync(RECONNECT_MS);
            await until('두 번째 연결 open', () => server.connections === 2 && socketOpen());
            // 3) 첫 소켓의 hello 시각과 두 번째 소켓의 hello 시각을 모두 지나도록 민다
            await jest.advanceTimersByTimeAsync(HELLO_DELAY_MS);
            await until('두 번째 연결 hello', () => hellosOn(1) >= 1);
            await jest.advanceTimersByTimeAsync(HELLO_DELAY_MS);
            await until('두 번째 연결 bridge_ready', () => statuses.some((s) => s.startsWith('연결됨')));
            // 늦게 도착하는 중복 프레임이 있으면 잡히도록 실 I/O 를 한 번 더 돌린다
            conn.socket()!.send(JSON.stringify({ type: 'probe' }));
            await until('probe 도착', () => (server.receivedByConn[1] ?? []).some((f) => f.type === 'probe'));
            expect(hellosOn(0)).toBe(0);
            expect(hellosOn(1)).toBe(1);
        });
    });

    it('정상 연결은 hello 지연이 지난 뒤 hello 를 한 번만 보낸다', async () => {
        await withFakeClock(async () => {
            await makeConn().connect();
            await until('연결 open', () => server.connections === 1 && socketOpen());
            await jest.advanceTimersByTimeAsync(HELLO_DELAY_MS - 1);
            conn!.socket()!.send(JSON.stringify({ type: 'probe' }));
            await until('probe 도착', () => server.received.some((f) => f.type === 'probe'));
            expect(server.received.filter((f) => f.type === 'bridge_hello')).toHaveLength(0); // 지연 전에는 보내지 않는다
            await jest.advanceTimersByTimeAsync(1);
            await until('hello', () => server.received.some((f) => f.type === 'bridge_hello'));
            await jest.advanceTimersByTimeAsync(HELLO_DELAY_MS * 3);
            await until('bridge_ready', () => statuses.some((s) => s.startsWith('연결됨')));
            expect(server.receivedByConn[0].filter((f) => f.type === 'bridge_hello')).toHaveLength(1);
        });
    });

    it('서버가 ping 에 응답하는 동안에는 연결을 유지한다', async () => {
        const PING_MS = 100;
        const TIMEOUT_MS = 500; // hello 지연보다 길게 — 반쯤 죽은 연결 테스트와 같은 설정
        await withFakeClock(async () => {
            const core = new BridgeCore({ folder: base, confirm: async () => 'all', sandboxProfileDir: os.tmpdir() });
            conn = new BridgeConnection({
                serverUrl: `http://127.0.0.1:${server.port}`, core, deviceId: 'test-device-1', label: 'unit · test',
                headers: () => ({ Authorization: 'Bearer omk_test' }), onStatus: (s) => statuses.push(s),
                reconnectMs: 50, livenessPingMs: PING_MS, livenessTimeoutMs: TIMEOUT_MS,
            });
            await conn.connect();
            await openAndHello(1);
            let pongs = 0;
            conn.socket()!.on('pong', () => { pongs += 1; });
            // ping 주기마다 한 칸씩 밀고 서버의 pong 이 실제로 돌아올 때까지 기다린다 — 무응답 한도의 3배를 지난다.
            const steps = (TIMEOUT_MS * 3) / PING_MS;
            for (let i = 0; i < steps; i += 1) {
                const seen = pongs;
                await jest.advanceTimersByTimeAsync(PING_MS);
                await until(`${i + 1}번째 pong`, () => pongs > seen);
            }
            expect(socketOpen()).toBe(true);
            expect(server.connections).toBe(1);
            expect(statuses).not.toContain('끊김 — 재연결 대기');
        });
    });

    it('접속 응답이 오지 않으면 시간 제한으로 끊고 다시 시도한다', async () => {
        // TCP 만 받고 업그레이드 응답을 하지 않는 서버
        const held: net.Socket[] = [];
        const silent = net.createServer((s) => { held.push(s); s.on('error', () => undefined); });
        await new Promise<void>((r) => silent.listen(0, '127.0.0.1', () => r()));
        const port = (silent.address() as net.AddressInfo).port;
        const core = new BridgeCore({ folder: base, confirm: async () => 'all', sandboxProfileDir: os.tmpdir() });
        conn = new BridgeConnection({
            serverUrl: `http://127.0.0.1:${port}`, core, deviceId: 'test-device-1', label: 'unit · test',
            headers: () => ({ Authorization: 'Bearer omk_test' }), onStatus: (s) => statuses.push(s),
            reconnectMs: 50, handshakeTimeoutMs: 100,
        });
        try {
            await conn.connect();
            const deadline = Date.now() + 4000;
            while (held.length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
            expect(held.length).toBeGreaterThanOrEqual(2);
            expect(statuses).toContain('끊김 — 재연결 대기');
        } finally {
            conn.disconnect(); conn = null;
            for (const s of held) s.destroy();
            await new Promise<void>((r) => silent.close(() => r()));
        }
    });

    it('headers() 실패는 상태만 알리고 재연결하지 않는다 (데스크톱 토큰 부재 의미 보존)', async () => {
        const core = new BridgeCore({ folder: base, confirm: async () => 'no', sandboxProfileDir: os.tmpdir() });
        conn = new BridgeConnection({
            serverUrl: `http://127.0.0.1:${server.port}`, core, deviceId: 'd', label: 'l',
            headers: () => { throw new Error('로그인 필요 — 앱에서 로그인 후 다시 연결'); },
            onStatus: (s) => statuses.push(s),
            reconnectMs: 50,
        });
        await withFakeClock(async () => {
            await conn!.connect();
            await jest.advanceTimersByTimeAsync(50 * 4); // 재연결 간격(50)을 넉넉히 지난다
            expect(jest.getTimerCount()).toBe(0); // 재연결 타이머를 걸지 않았다
            expect(conn!.socket()).toBeNull(); // 소켓을 만들지 않았다
            expect(server.connections).toBe(0);
            expect(statuses).toContain('로그인 필요 — 앱에서 로그인 후 다시 연결');
        });
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

    it('hello 에 authClose 를 싣는다 — 서버가 인증 실패를 사유와 함께 닫아도 된다는 표시', async () => {
        await makeConn().connect();
        const hello = await server.waitFor((f) => f.type === 'bridge_hello') as Frame & { authClose?: boolean };
        expect(hello.authClose).toBe(true);
    });

    /** 닫는 사유 검증용 연결 — 상태 코드와 재연결 대기를 기록한다. */
    function authConn(codes: Array<[string, string | undefined]>, delays: number[]): BridgeConnection {
        const core = new BridgeCore({ folder: base, confirm: async () => 'no', sandboxProfileDir: os.tmpdir() });
        conn = new BridgeConnection({
            serverUrl: `http://127.0.0.1:${server.port}`, core, deviceId: 'test-device-a', label: 'unit · auth',
            headers: () => ({ Authorization: 'Bearer omk_test' }),
            onStatus: (s, code, arg) => { statuses.push(s); if (code) codes.push([code, arg]); },
            reconnectMs: 100, authRetryMs: 7777, random: () => 1,
            onReconnectScheduled: (ms) => delays.push(ms),
        });
        return conn;
    }
    /** 가짜 시계 안에서 부른다 — 연결·hello·ready 뒤 서버가 code/reason 으로 닫고, 재연결 대기가 걸릴 때까지 기다린다. */
    async function closedWith(code: number, reason: string): Promise<{ codes: Array<[string, string | undefined]>; delays: number[] }> {
        const codes: Array<[string, string | undefined]> = [];
        const delays: number[] = [];
        await authConn(codes, delays).connect();
        await openAndHello(1);
        await until('bridge_ready', () => statuses.some((s) => s.startsWith('연결됨')));
        server.closeAll(code, reason);
        await until('재연결 대기 걸림', () => delays.length > 0);
        return { codes, delays };
    }

    it.each([...AUTH_CLOSE_REASONS])('인증 사유(%s)로 닫히면 그 사유를 상태 코드로 알리고 긴 간격으로만 다시 시도한다', async (reason) => {
        await withFakeClock(async () => {
            const { codes, delays } = await closedWith(1008, reason);
            expect(codes[codes.length - 1]).toEqual([reason, undefined]);
            expect(statuses[statuses.length - 1]).toBe(AUTH_CLOSE_TEXT[reason]);
            expect(delays).toEqual([7777]);
        });
    });

    it('인증이 아닌 1008 사유(기기 상한)는 종전대로 재연결 대기', async () => {
        await withFakeClock(async () => {
            const { codes, delays } = await closedWith(1008, 'bridge_device_limit');
            expect(codes[codes.length - 1]).toEqual(['reconnecting', undefined]);
            expect(delays).toEqual([100]);
        });
    });

    it('인증을 확인하지 못함(1013 auth_unavailable)은 일시적 실패라 종전대로 재연결 대기', async () => {
        await withFakeClock(async () => {
            const { codes, delays } = await closedWith(1013, 'auth_unavailable');
            expect(codes[codes.length - 1]).toEqual(['reconnecting', undefined]);
            expect(delays).toEqual([100]);
        });
    });

    it('인증 사유로 닫힌 뒤 disconnect() 하면 기다리던 재시도도 취소된다', async () => {
        const AUTH_RETRY_MS = 7777; // authConn 의 authRetryMs
        await withFakeClock(async () => {
            await closedWith(1008, 'api_key_revoked');
            const before = server.connections;
            conn!.disconnect();
            await jest.advanceTimersByTimeAsync(AUTH_RETRY_MS * 2); // 인증 재시도 대기를 넉넉히 지난다
            expect(jest.getTimerCount()).toBe(0);
            expect(conn!.socket()).toBeNull();
            expect(server.connections).toBe(before);
        });
    });
});
