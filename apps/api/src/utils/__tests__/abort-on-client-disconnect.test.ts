/**
 * abortOnClientDisconnect — 실제 http 서버(Express 5)에 node:http 클라이언트로 붙어 중간에 끊는 회귀 테스트.
 *
 * Express 5 에서 req 'close' 는 요청 본문을 다 읽은 직후에 난다(클라이언트가 붙어 있어도). 그래서 req 기준
 * 리스너는 "항상 abort" 이거나(동기 등록) "영영 안 불림"(await 뒤 등록)이 된다. 헬퍼는 res 기준으로 본다.
 */
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import { abortOnClientDisconnect } from '../abort-on-client-disconnect';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms = 1000) => {
    const end = Date.now() + ms;
    while (!cond() && Date.now() < end) await sleep(10);
};

describe('abortOnClientDisconnect (실제 http 서버)', () => {
    let server: http.Server;
    let port: number;
    let signal: AbortSignal | undefined;
    let reqCloseSeen = false;

    beforeAll((done) => {
        const app = express();
        app.use(express.json());
        // 스트리밍: 헤더·첫 청크를 보낸 뒤 응답을 끝내지 않고 기다린다.
        app.post('/stream', (req, res) => {
            signal = abortOnClientDisconnect(res);
            res.setHeader('Content-Type', 'text/event-stream');
            res.write('data: 1\n\n');
        });
        // 비스트리밍 대기: 아무것도 쓰지 않고 기다린다.
        app.post('/wait', (req, res) => {
            signal = abortOnClientDisconnect(res);
        });
        // 정상 완료(비스트리밍·스트리밍)
        app.post('/ok', async (req, res) => {
            signal = abortOnClientDisconnect(res);
            await sleep(30);
            res.json({ ok: true });
        });
        app.post('/ok-stream', async (req, res) => {
            signal = abortOnClientDisconnect(res);
            res.write('a');
            await sleep(30);
            res.end();
        });
        // 등록 전에 이미 끊김: 클라이언트가 끊긴 뒤에야 헬퍼를 부른다(인증·세션 조회 await 를 흉내).
        app.post('/late', async (req, res) => {
            req.on('close', () => { reqCloseSeen = true; });
            await sleep(200);
            signal = abortOnClientDisconnect(res);
        });
        server = app.listen(0, () => { port = (server.address() as AddressInfo).port; done(); });
    });

    afterAll((done) => { server.closeAllConnections(); server.close(() => done()); });
    beforeEach(() => { signal = undefined; reqCloseSeen = false; });

    const post = (path: string) => {
        const req = http.request({ port, path, method: 'POST', headers: { 'content-type': 'application/json' }, agent: false });
        req.on('error', () => { /* destroy 로 인한 ECONNRESET 무시 */ });
        req.end(JSON.stringify({ a: 1 }));
        return req;
    };
    const complete = (path: string) => new Promise<void>((resolve) => {
        const req = post(path);
        req.on('response', (resp) => { resp.resume(); resp.on('end', () => resolve()); });
    });

    it('스트리밍 중 클라이언트가 끊으면 abort 된다', async () => {
        const req = post('/stream');
        await new Promise((r) => req.on('response', r));
        expect(signal?.aborted).toBe(false);
        req.destroy();
        await until(() => signal?.aborted === true);
        expect(signal?.aborted).toBe(true);
    });

    it('비스트리밍 대기 중 클라이언트가 끊으면 abort 된다', async () => {
        const req = post('/wait');
        await until(() => signal !== undefined);
        await sleep(50); // 본문 소비 직후의 req 'close' 가 지나간 뒤에도 abort 되지 않아야 한다
        expect(signal?.aborted).toBe(false);
        req.destroy();
        await until(() => signal?.aborted === true);
        expect(signal?.aborted).toBe(true);
    });

    it.each(['/ok', '/ok-stream'])('정상 완료(%s)는 응답 종료·소켓 종료 뒤에도 abort 되지 않는다', async (path) => {
        await complete(path);
        await sleep(100); // agent:false → 응답 뒤 소켓이 닫히고 res 'close' 가 난다
        expect(signal).toBeDefined();
        expect(signal?.aborted).toBe(false);
    });

    it('헬퍼를 부르기 전에 이미 끊긴 연결이면 즉시 abort 된 신호를 준다', async () => {
        const req = post('/late');
        await sleep(50);
        req.destroy();
        await until(() => signal !== undefined);
        expect(reqCloseSeen).toBe(true);
        expect(signal?.aborted).toBe(true);
    });
});
