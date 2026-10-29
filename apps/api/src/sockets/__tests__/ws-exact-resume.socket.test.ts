/**
 * 정확 이어받기(2026-10-29) — 실제 WebSocketHandler 경로(인증 → init → resume/abort)를 실제 ws 서버·클라이언트로 검증한다.
 *  - init 이 새 기능(exactResume)을 알린다(클라이언트는 이 연결이 지원할 때만 exact resume 을 보낸다).
 *  - resume{exact:true} 는 등록된 streamId 와 정확히 같을 때만 붙는다. 다르거나 없으면 resume_none 이고
 *    같은 키로 생성 중인 다른 탭의 소켓·중단 컨트롤러는 그대로다.
 *  - exact 가 없으면 종전처럼 커서가 달라도 붙는다(구 클라이언트 호환).
 *  - aborted 는 중단한 스트림의 streamId 를 싣는다.
 * 생성 자체(handleChatMessage)는 막고 같은 규약으로 레지스트리에 등록만 한다 — 실제 등록 경로는 ws-chat-session-continuity 가 본다.
 */
import { EventEmitter } from 'events';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClusterManager } from '../../cluster/manager';
import type { ExtendedWebSocket, WSMessage } from '../ws-types';

const users: string[] = [];
jest.mock('../ws-auth', () => ({
    authenticateWebSocket: jest.fn(async () => ({ userId: users.shift() ?? 'u1', userRole: 'user', authMethod: 'cookie' })),
    refreshWebSocketAuthentication: jest.fn(),
}));
jest.mock('../../security/cors-policy', () => ({ isOriginAllowed: () => true }));
jest.mock('../../runtime-ports/tool-runtime', () => ({ getToolRuntime: () => ({ listTools: async () => [] }) }));
jest.mock('../../monitoring/analytics', () => ({
    getAnalyticsSystem: () => ({ startSession: jest.fn(), endSession: jest.fn(), incrementSessionQuery: jest.fn() }),
}));
const controllers: AbortController[] = [];
jest.mock('../ws-chat-handler', () => ({
    handleChatMessage: jest.fn(async (_ws: unknown, msg: WSMessage, ctx: { extWs: ExtendedWebSocket }) => {
        // ws-chat-handler 와 같은 순서: 소켓 컨트롤러 → 키 결정 → 등록(클라이언트 streamId 전달)
        const { getInFlightStreamRegistry, resolveStreamKey } = require('../ws-stream-registry'); // 핸들러와 같은 싱글턴
        const ac = new AbortController();
        controllers.push(ac);
        ctx.extWs._abortController = ac;
        getInFlightStreamRegistry().open(resolveStreamKey(ctx.extWs, msg.anonSessionId, msg.lane), ctx.extWs, ac, msg.streamId);
    }),
}));

const { WebSocketHandler } = require('../handler') as typeof import('../handler');
const { getInFlightStreamRegistry } = require('../ws-stream-registry') as typeof import('../ws-stream-registry');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const MINE = '3f2b9c1e-7d4a-4e21-9b6f-0c8d1e2f3a4b';
const OTHER = '11111111-2222-4333-8444-555555555555';

describe('WebSocketHandler 정확 이어받기 (실제 소켓)', () => {
    let wss: WebSocketServer;
    let handler: InstanceType<typeof WebSocketHandler>;
    let port: number;
    const serverSockets: ExtendedWebSocket[] = [];
    const clients: WebSocket[] = [];

    beforeEach(async () => {
        users.length = 0;
        controllers.length = 0;
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
        for (const ac of controllers) ac.abort();
        handler.stopHeartbeat();
        for (const c of clients) c.terminate();
        clients.length = 0; serverSockets.length = 0;
        await new Promise<void>((r) => wss.close(() => r()));
    });

    async function until(cond: () => boolean): Promise<void> {
        for (let i = 0; i < 100 && !cond(); i++) await wait(10);
    }
    async function openClient(userId = 'u1') {
        users.push(userId);
        const client = new WebSocket(`ws://127.0.0.1:${port}`);
        clients.push(client);
        const received: Array<Record<string, unknown>> = [];
        client.on('message', (d) => received.push(JSON.parse(d.toString())));
        await new Promise<void>((r, j) => { client.once('open', () => r()); client.once('error', j); });
        await until(() => received.some((m) => m.type === 'build_id'));
        const send = (m: Record<string, unknown>) => client.send(JSON.stringify(m));
        return { client, received, send, server: serverSockets[serverSockets.length - 1] };
    }
    /** 다른 탭(A)이 레인 a 에서 생성 중 */
    async function otherTabGenerating() {
        const a = await openClient('u1');
        a.send({ type: 'chat', message: 'q', lane: 'a', streamId: MINE });
        await until(() => a.server._abortController !== null);
        return a;
    }

    it('init 이 exactResume 지원을 알린다', async () => {
        const { received } = await openClient();
        expect(received.find((m) => m.type === 'init')).toMatchObject({ capabilities: { exactResume: true } });
    });

    it('exact: streamId 가 다르거나 없으면 resume_none 이고 다른 탭의 스트림·중단은 그대로다', async () => {
        const a = await otherTabGenerating();
        const ac = a.server._abortController;
        const b = await openClient('u1');
        b.send({ type: 'resume', lane: 'a', streamId: OTHER, afterSeq: 0, exact: true });
        b.send({ type: 'resume', lane: 'a', exact: true });
        b.send({ type: 'resume', lane: 'a', streamId: 'not-a-uuid', afterSeq: 0, exact: true });
        await until(() => b.received.filter((m) => m.type === 'resume_none').length === 3);
        expect(b.received.filter((m) => m.type === 'resume_none')).toEqual([
            { type: 'resume_none', streamId: OTHER }, { type: 'resume_none' }, { type: 'resume_none' },
        ]);
        expect(b.received.some((m) => m.type === 'stream_resume')).toBe(false);
        expect(b.server._abortController).toBeNull();
        b.send({ type: 'abort' }); // B 의 중단은 A 의 생성에 닿지 않는다
        await wait(30);
        expect(ac!.signal.aborted).toBe(false);
        expect(a.server._abortController).toBe(ac);

        a.send({ type: 'abort' });
        await until(() => a.received.some((m) => m.type === 'aborted'));
        expect(ac!.signal.aborted).toBe(true);
        expect(a.received.find((m) => m.type === 'aborted')).toMatchObject({ streamId: MINE });
    });

    it('exact: 정확히 같으면 새 소켓에 붙고, 그 뒤 abort 는 그 생성을 멈추며 streamId 를 싣는다', async () => {
        const a = await otherTabGenerating();
        const ac = a.server._abortController!;
        a.client.terminate(); // 첫 이벤트 전 끊김
        await until(() => a.server._abortController === null);
        const b = await openClient('u1');
        b.send({ type: 'resume', lane: 'a', streamId: MINE, afterSeq: 0, exact: true });
        await until(() => b.received.some((m) => m.type === 'stream_resume'));
        expect(b.received.find((m) => m.type === 'stream_resume')).toMatchObject({ streamId: MINE, finished: false });
        b.send({ type: 'abort' });
        await until(() => b.received.some((m) => m.type === 'aborted'));
        expect(ac.signal.aborted).toBe(true);
        expect(b.received.find((m) => m.type === 'aborted')).toMatchObject({ streamId: MINE });
        expect(getInFlightStreamRegistry().attach('u:u1#a', b.server, { streamId: MINE }, { exact: true })).toBe(false);
    });

    it('exact 는 사용자·레인 키를 넘지 않는다', async () => {
        const a = await otherTabGenerating();
        const other = await openClient('u2');
        other.send({ type: 'resume', lane: 'a', streamId: MINE, afterSeq: 0, exact: true });
        const lane = await openClient('u1');
        lane.send({ type: 'resume', lane: 'b', streamId: MINE, afterSeq: 0, exact: true });
        await until(() => other.received.some((m) => m.type === 'resume_none') && lane.received.some((m) => m.type === 'resume_none'));
        expect(other.received.some((m) => m.type === 'stream_resume')).toBe(false);
        expect(lane.received.some((m) => m.type === 'stream_resume')).toBe(false);
        expect(a.server._abortController).not.toBeNull();
    });

    it('exact 가 없으면 종전처럼 커서가 달라도 붙는다(구 클라이언트 호환)', async () => {
        await otherTabGenerating();
        const b = await openClient('u1');
        b.send({ type: 'resume', lane: 'a', streamId: OTHER, afterSeq: 0 });
        await until(() => b.received.some((m) => m.type === 'stream_resume'));
        expect(b.received.find((m) => m.type === 'stream_resume')).toMatchObject({ streamId: MINE });
        expect(b.received.some((m) => m.type === 'resume_none')).toBe(false);
    });
});
