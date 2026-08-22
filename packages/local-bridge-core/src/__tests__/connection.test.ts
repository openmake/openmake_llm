/**
 * BridgeConnection — 가짜 WS 서버로 프로토콜 상태기계 검증 (축2 plan 의 '헤드리스 하네스').
 * hello 프레임·reqId 상관·durationMs·재연결·해제 시 일괄 승인 회수까지 실제 소켓으로 본다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WebSocketServer, type WebSocket as ServerWs } from 'ws';
import { BridgeConnection } from '../connection';
import { BridgeCore } from '../core';

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
});
