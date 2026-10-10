/**
 * closeServerConnections — DashboardServer.stop() 이 쓰는 연결 정리. 실제 http·ws 서버로 확인한다.
 */
import { createServer, request, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import { WebSocket, WebSocketServer } from 'ws';
import { closeServerConnections } from '../graceful-shutdown';

function listen(server: HttpServer): Promise<number> {
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    });
}

describe('closeServerConnections', () => {
    it('응답이 끝나지 않는 요청이 있어도 유예 뒤 강제로 닫고 resolve 한다', async () => {
        let received!: () => void;
        const gotRequest = new Promise<void>((r) => { received = r; });
        // 응답을 끝내지 않는 핸들러 — 진행 중 요청
        const server = createServer(() => { received(); });
        const wss = new WebSocketServer({ server });
        const port = await listen(server);

        const clientError = new Promise<void>((resolve) => {
            const req = request({ host: '127.0.0.1', port, path: '/hang' });
            req.on('error', () => resolve());
            req.end();
        });
        await gotRequest;

        const startedAt = Date.now();
        await closeServerConnections(server, wss, 200);
        const elapsed = Date.now() - startedAt;

        expect(elapsed).toBeGreaterThanOrEqual(150);
        expect(elapsed).toBeLessThan(3000);
        expect(server.listening).toBe(false);
        await clientError;
    });

    it('유휴 keep-alive 연결은 유예를 기다리지 않고 바로 닫는다', async () => {
        const server = createServer((_req, res) => { res.end('ok'); });
        const wss = new WebSocketServer({ server });
        const port = await listen(server);

        // keep-alive 로 한 번 요청하고 소켓을 열어 둔다
        const { Agent } = await import('http');
        const agent = new Agent({ keepAlive: true });
        await new Promise<void>((resolve, reject) => {
            const req = request({ host: '127.0.0.1', port, path: '/', agent }, (res) => {
                res.resume();
                res.on('end', () => resolve());
            });
            req.on('error', reject);
            req.end();
        });

        const startedAt = Date.now();
        await closeServerConnections(server, wss, 5000);
        expect(Date.now() - startedAt).toBeLessThan(2000);
        agent.destroy();
    });

    it('열린 WebSocket 은 1001 로 닫는다', async () => {
        const server = createServer();
        const wss = new WebSocketServer({ server });
        const port = await listen(server);

        const client = new WebSocket(`ws://127.0.0.1:${port}`);
        await new Promise<void>((resolve, reject) => { client.on('open', () => resolve()); client.on('error', reject); });
        const closed = new Promise<number>((resolve) => { client.on('close', (code) => resolve(code)); });

        await closeServerConnections(server, wss, 5000);
        expect(await closed).toBe(1001);
        // 서버 쪽 소켓의 close 이벤트는 http 서버가 닫힌 직후에 온다
        for (let i = 0; i < 50 && wss.clients.size > 0; i++) await new Promise((r) => setTimeout(r, 10));
        expect(wss.clients.size).toBe(0);
    });

    it('listen 하지 않은 서버(EADDRINUSE 경로)도 reject 없이 끝난다', async () => {
        const server = createServer();
        const wss = new WebSocketServer({ server });
        await expect(closeServerConnections(server, wss, 5000)).resolves.toBeUndefined();
    });
});
