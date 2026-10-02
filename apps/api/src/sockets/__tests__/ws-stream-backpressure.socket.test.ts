/**
 * 송신 백프레셔 — 실제 소켓으로 검증한다(가짜 ws 가 아니라 ws 서버·클라이언트).
 * 읽기를 멈춘 클라이언트에 토큰을 계속 보내면 서버 쪽 송신 버퍼(bufferedAmount)가 쌓인다. 임계를 넘으면
 * 그 소켓만 끊기고 생성은 이어지며, 새 소켓으로 다시 붙으면 본문 스냅샷으로 이어받는다.
 */
import { WebSocketServer, WebSocket } from 'ws';
import { InFlightStreamRegistry } from '../ws-stream-registry';
import type { ExtendedWebSocket } from '../ws-types';

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('InFlightStreamRegistry 송신 백프레셔 (실제 소켓)', () => {
    let wss: WebSocketServer;
    let port: number;
    const serverSockets: WebSocket[] = [];
    const clients: WebSocket[] = [];

    beforeEach(async () => {
        wss = new WebSocketServer({ port: 0 });
        await new Promise<void>((r) => wss.once('listening', r));
        port = (wss.address() as { port: number }).port;
        wss.on('connection', (ws) => serverSockets.push(ws));
    });
    afterEach(async () => {
        for (const c of clients) c.terminate();
        clients.length = 0; serverSockets.length = 0;
        await new Promise<void>((r) => wss.close(() => r()));
    });

    async function connect(): Promise<{ client: WebSocket; server: ExtendedWebSocket }> {
        const before = serverSockets.length;
        const client = new WebSocket(`ws://127.0.0.1:${port}`);
        clients.push(client);
        await new Promise<void>((r, j) => { client.once('open', () => r()); client.once('error', j); });
        while (serverSockets.length === before) await tick();
        const server = serverSockets[serverSockets.length - 1] as ExtendedWebSocket;
        server._authenticatedUserId = 'u1';
        server._abortController = null;
        return { client, server };
    }

    it('읽지 않는 클라이언트는 임계에서 끊기고, 생성은 유지되며, 재연결하면 본문 전체를 이어받는다', async () => {
        const THRESHOLD = 256 * 1024;
        const reg = new InFlightStreamRegistry(60_000, 60_000, 4 * 1024 * 1024, 2000, THRESHOLD);
        const { client, server } = await connect();
        // 클라이언트가 읽기를 멈춘다(탭이 얼었거나 네트워크가 막힌 상황)
        (client as unknown as { _socket: { pause(): void } })._socket.pause();
        let serverClosed = false;
        server.on('close', () => { serverClosed = true; });

        const ac = new AbortController();
        const entry = reg.open('u:u1', server, ac);
        const chunk = 'x'.repeat(16 * 1024);
        let sent = 0;
        let peakBuffered = 0;
        const MAX_CHUNKS = 4000; // 64MB — 백프레셔가 없으면 여기까지 전부 서버 메모리에 쌓인다
        while (entry.ws && sent < MAX_CHUNKS) {
            reg.send(entry, { type: 'token', token: chunk, messageId: 'm1' });
            sent += 1;
            peakBuffered = Math.max(peakBuffered, server.bufferedAmount);
            if (sent % 8 === 0) await tick();
        }

        expect(entry.ws).toBeNull();                 // 소켓이 스트림에서 분리됐다
        expect(sent).toBeLessThan(MAX_CHUNKS);       // 끝까지 쌓기 전에 끊었다
        expect(peakBuffered).toBeLessThan(THRESHOLD + 64 * 1024 * 16); // 버퍼는 임계 부근에서 멈췄다
        expect(ac.signal.aborted).toBe(false);       // 생성은 중단되지 않았다
        for (let i = 0; i < 50 && !serverClosed; i++) await new Promise((r) => setTimeout(r, 20));
        expect(serverClosed).toBe(true);

        // 끊긴 뒤에도 생성은 계속된다 — 이후 토큰은 스냅샷에 쌓인다
        reg.send(entry, { type: 'token', token: '끝' });

        const second = await connect();
        const received: Array<Record<string, unknown>> = [];
        second.client.on('message', (d) => received.push(JSON.parse(d.toString())));
        expect(reg.attach('u:u1', second.server)).toBe(true);
        for (let i = 0; i < 100 && received.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
        expect(received[0]).toMatchObject({ type: 'stream_resume', finished: false, messageId: 'm1' });
        expect(String(received[0].content)).toHaveLength(sent * chunk.length + 1);
        expect(String(received[0].content).endsWith('끝')).toBe(true);
    }, 30_000);

    it('정상적으로 읽는 클라이언트는 같은 양을 보내도 끊기지 않는다', async () => {
        const reg = new InFlightStreamRegistry(60_000, 60_000, 4 * 1024 * 1024, 2000, 256 * 1024);
        const { client, server } = await connect();
        let got = 0;
        client.on('message', () => { got += 1; });
        const entry = reg.open('u:u1', server, new AbortController());
        const chunk = 'x'.repeat(16 * 1024);
        for (let i = 0; i < 400; i++) { // 6.4MB — 임계(256KB)의 25배
            reg.send(entry, { type: 'token', token: chunk });
            await tick();
        }
        for (let i = 0; i < 100 && got < 400; i++) await new Promise((r) => setTimeout(r, 20));
        expect(entry.ws).toBe(server);
        expect(got).toBe(400);
    }, 30_000);
});
