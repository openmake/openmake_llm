/**
 * REST 채팅 라우트 — 클라이언트가 응답 도중 끊으면 processChat 이 받은 abortSignal 이 aborted 가 되는지.
 *
 * Express 5 의 req 'close' 는 본문 소비 직후에 나서 끊김 신호로 쓸 수 없다(2026-10-09 안정화 점검).
 * 실제 http 서버를 띄우고 node:http 클라이언트로 중간에 destroy 한다. chat 라우트는 인증·rate limit
 * 미들웨어(DB·Redis 의존)를 빼고 라우터 스택의 마지막 핸들러만 올린다.
 */
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import type { ClusterManager } from '../../cluster/manager';

jest.mock('../../llm/client', () => ({
    createClient: jest.fn(() => ({ model: 'test-model', chat: jest.fn() })),
}));
jest.mock('../../chat/profile-resolver', () => ({
    ...jest.requireActual('../../chat/profile-resolver'),
    listAvailableModels: () => [{ id: 'test-model' }],
}));
jest.mock('../../data/repositories/oaicompat-session-repo', () => ({
    OpenAICompatSessionRepository: jest.fn().mockImplementation(() => ({
        findByKeyForUser: jest.fn().mockResolvedValue(undefined),
        findByKeyForAnon: jest.fn().mockResolvedValue(undefined),
        tagKey: jest.fn().mockResolvedValue(undefined),
    })),
}));

import chatRouter from '../../routes/chat.routes';
import openaiCompatRouter, { setClusterManager } from '../../routes/openai-compat.routes';
import { ChatRequestHandler } from '../../chat/request-handler';

type Layer = { route?: { path: string; stack: Array<{ handle: express.RequestHandler }> } };
const lastHandler = (path: string) => {
    const layer = (chatRouter as unknown as { stack: Layer[] }).stack.find((l) => l.route?.path === path);
    if (!layer?.route) throw new Error(`${path} 라우트를 찾지 못했다`);
    return layer.route.stack[layer.route.stack.length - 1].handle;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms = 1000) => {
    const end = Date.now() + ms;
    while (!cond() && Date.now() < end) await sleep(10);
};

describe('REST 채팅 — 클라이언트 끊김 시 processChat abortSignal', () => {
    let server: http.Server;
    let port: number;
    let spy: jest.SpyInstance;
    let received: { abortSignal?: AbortSignal } | undefined;
    const jsonSent = jest.fn();
    const errorForwarded = jest.fn();

    beforeAll((done) => {
        setClusterManager({} as unknown as ClusterManager);
        const app = express();
        app.use(express.json());
        app.use((req, res, next) => {
            const json = res.json.bind(res);
            res.json = (body?: unknown) => { jsonSent(body); return json(body); };
            next();
        });
        app.post('/api/chat', lastHandler('/'));
        app.post('/api/chat/stream', lastHandler('/stream'));
        app.use('/api/v1', openaiCompatRouter);
        app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
            errorForwarded(err);
            res.status(500).end();
        });
        server = app.listen(0, () => { port = (server.address() as AddressInfo).port; done(); });
    });
    afterAll((done) => { server.closeAllConnections(); server.close(() => done()); });

    beforeEach(() => {
        received = undefined;
        jsonSent.mockClear();
        errorForwarded.mockClear();
        // upstream 흉내: 신호가 abort 되면 AbortError 로 던지고, 아니면 끝나지 않는다.
        spy = jest.spyOn(ChatRequestHandler, 'processChat').mockImplementation(((params: { abortSignal?: AbortSignal }) => {
            received = params;
            return new Promise((_resolve, reject) => {
                const fail = () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
                if (params.abortSignal?.aborted) fail();
                else params.abortSignal?.addEventListener('abort', fail);
            });
        }) as never);
    });
    afterEach(() => spy.mockRestore());

    const post = (path: string, body: Record<string, unknown>) => {
        const req = http.request({ port, path, method: 'POST', headers: { 'content-type': 'application/json' }, agent: false });
        req.on('error', () => { /* destroy 로 인한 ECONNRESET 무시 */ });
        req.end(JSON.stringify(body));
        return req;
    };
    const chatBody = { message: 'hi', model: 'test-model', anonSessionId: 'anon-abort' };
    const compatBody = (stream: boolean) => ({ model: 'test-model', stream, messages: [{ role: 'user', content: '안녕' }] });

    /** processChat 이 불릴 때까지 기다렸다가 클라이언트를 끊고, 신호가 abort 될 때까지 기다린다. */
    const disconnectMidway = async (path: string, body: Record<string, unknown>) => {
        const req = post(path, body);
        await until(() => received !== undefined);
        expect(received).toBeDefined();
        await sleep(50); // 본문 소비 직후의 req 'close' 가 지나갈 시간
        expect(received?.abortSignal?.aborted).toBe(false);
        req.destroy();
        await until(() => received?.abortSignal?.aborted === true);
        await sleep(30); // 라우트의 catch 가 돌 시간
    };

    it('POST /api/chat/stream — 끊기면 aborted', async () => {
        await disconnectMidway('/api/chat/stream', chatBody);
        expect(received?.abortSignal?.aborted).toBe(true);
    });

    it('POST /api/chat — 끊기면 aborted 이고, 에러 응답·에러 전달 없이 조용히 끝난다', async () => {
        await disconnectMidway('/api/chat', chatBody);
        expect(received?.abortSignal?.aborted).toBe(true);
        expect(jsonSent).not.toHaveBeenCalled();
        expect(errorForwarded).not.toHaveBeenCalled();
    });

    it('POST /api/v1/chat/completions (stream) — 끊기면 aborted', async () => {
        await disconnectMidway('/api/v1/chat/completions', compatBody(true));
        expect(received?.abortSignal?.aborted).toBe(true);
    });

    it('POST /api/v1/chat/completions (비스트리밍) — 끊기면 aborted 이고 에러 응답을 쓰지 않는다', async () => {
        await disconnectMidway('/api/v1/chat/completions', compatBody(false));
        expect(received?.abortSignal?.aborted).toBe(true);
        expect(jsonSent).not.toHaveBeenCalled();
    });

    it('POST /api/chat — 정상 완료면 응답이 나가고 신호는 abort 되지 않는다', async () => {
        spy.mockImplementation((async (params: { abortSignal?: AbortSignal }) => {
            received = params;
            return { response: 'ok', sessionId: 's1', model: 'test-model', executionPlan: {} };
        }) as never);
        const status = await new Promise<number>((resolve) => {
            const req = post('/api/chat', chatBody);
            req.on('response', (resp) => { resp.resume(); resp.on('end', () => resolve(resp.statusCode ?? 0)); });
        });
        await sleep(100);
        expect(status).toBe(200);
        expect(received?.abortSignal?.aborted).toBe(false);
    });
});
