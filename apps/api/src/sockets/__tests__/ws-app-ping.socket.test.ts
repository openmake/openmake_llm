/**
 * 앱 수준 ping 이 실제 WebSocketHandler 경로에서 처리되는지 — 실제 ws 서버·클라이언트로 검증한다.
 *  - 인증이 끝나기 전에 보낸 ping 도(early buffer 재생) pong 을 받는다.
 *  - ping 은 메시지 빈도 제한·활동 갱신에 세지 않는다(주기 ping 이 사용자 메시지 한도를 깎지 않게).
 */
import { EventEmitter } from 'events';
import { WebSocketServer, WebSocket } from 'ws';
import { WS_LIMITS } from '../../config/timeouts';
import type { ClusterManager } from '../../cluster/manager';
import type { ExtendedWebSocket } from '../ws-types';

let releaseAuth: () => void = () => {};
jest.mock('../ws-auth', () => ({
    authenticateWebSocket: jest.fn(() => new Promise((resolve) => {
        releaseAuth = () => resolve({ userId: 'u-ping', userRole: 'user', authMethod: 'cookie' });
    })),
    refreshWebSocketAuthentication: jest.fn(),
}));
jest.mock('../../security/cors-policy', () => ({ isOriginAllowed: () => true }));
jest.mock('../../runtime-ports/tool-runtime', () => ({ getToolRuntime: () => ({ listTools: async () => [] }) }));
jest.mock('../ws-chat-handler', () => ({ handleChatMessage: jest.fn() }));
jest.mock('../../monitoring/analytics', () => ({
    getAnalyticsSystem: () => ({ startSession: jest.fn(), endSession: jest.fn(), incrementSessionQuery: jest.fn() }),
}));

const { WebSocketHandler } = require('../handler') as typeof import('../handler');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('WebSocketHandler 앱 수준 ping (실제 소켓)', () => {
    let wss: WebSocketServer;
    let handler: InstanceType<typeof WebSocketHandler>;
    let port: number;
    const serverSockets: ExtendedWebSocket[] = [];
    const clients: WebSocket[] = [];

    beforeEach(async () => {
        wss = new WebSocketServer({ port: 0 });
        await new Promise<void>((r) => wss.once('listening', r));
        port = (wss.address() as { port: number }).port;
        wss.on('connection', (ws) => serverSockets.push(ws as ExtendedWebSocket));
        const cluster = Object.assign(new EventEmitter(), {
            clusterName: 'test', getStats: () => ({}), getNodes: () => [],
        }) as unknown as ClusterManager;
        handler = new WebSocketHandler(wss, cluster);
    });
    afterEach(async () => {
        handler.stopHeartbeat();
        for (const c of clients) c.terminate();
        clients.length = 0; serverSockets.length = 0;
        await new Promise<void>((r) => wss.close(() => r()));
    });

    async function openClient(): Promise<{ client: WebSocket; received: Array<Record<string, unknown>> }> {
        const client = new WebSocket(`ws://127.0.0.1:${port}`);
        clients.push(client);
        const received: Array<Record<string, unknown>> = [];
        client.on('message', (d) => received.push(JSON.parse(d.toString())));
        await new Promise<void>((r, j) => { client.once('open', () => r()); client.once('error', j); });
        return { client, received };
    }
    async function until(cond: () => boolean): Promise<void> {
        for (let i = 0; i < 100 && !cond(); i++) await wait(10);
    }

    it('인증 전에 보낸 ping 도 인증 뒤 pong 으로 답한다', async () => {
        const { client, received } = await openClient();
        client.send(JSON.stringify({ type: 'ping', t: 42 }));
        await wait(30);
        expect(received.filter((m) => m.type === 'pong')).toEqual([]); // 아직 인증 중
        releaseAuth();
        await until(() => received.some((m) => m.type === 'pong'));
        expect(received.find((m) => m.type === 'pong')).toEqual({ type: 'pong', t: 42 });
    });

    it('ping 은 빈도 제한·활동 시각에 세지 않는다', async () => {
        const { client, received } = await openClient();
        releaseAuth();
        await until(() => received.some((m) => m.type === 'build_id'));
        const server = serverSockets[serverSockets.length - 1];
        const activityBefore = server._lastActivityAtMs;
        await wait(5);

        const N = WS_LIMITS.MESSAGE_RATE_MAX_PER_WINDOW + 5;
        for (let i = 0; i < N; i++) client.send(JSON.stringify({ type: 'ping', t: i }));
        await until(() => received.filter((m) => m.type === 'pong').length === N);

        expect(received.filter((m) => m.type === 'pong')).toHaveLength(N);
        expect(received.filter((m) => m.type === 'error')).toEqual([]);
        expect(server._messageTimestamps ?? []).toEqual([]);
        expect(server._messageCount).toBe(0);
        expect(server._lastActivityAtMs).toBe(activityBefore);
    });
});
