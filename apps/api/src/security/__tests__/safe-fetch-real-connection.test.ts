/**
 * safeFetch 실제 연결 — fetch 를 mock 하지 않고 로컬 HTTP 서버에 붙는다.
 * 종전 테스트는 global fetch 를 mock 해서, undici 8 업그레이드로 Node 내장 fetch 와 npm undici Agent 가 어긋나
 * 모든 연결이 UND_ERR_INVALID_ARG 로 실패한 운영 결함(2026-09-23)을 잡지 못했다.
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { safeFetch } from '../ssrf-guard';

let server: http.Server;
let port = 0;
const before = process.env.SSRF_ALLOWED_HOSTS;

beforeAll(async () => {
    server = http.createServer((req, res) => {
        if (req.url === '/redirect') { res.writeHead(302, { location: '/ok' }); res.end(); return; }
        res.writeHead(200, { 'content-type': 'application/json', 'x-seen-auth': String(req.headers.authorization ?? '') });
        res.end(JSON.stringify({ path: req.url }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as AddressInfo).port;
    process.env.SSRF_ALLOWED_HOSTS = `127.0.0.1:${port}`;
});
afterAll(async () => {
    if (before === undefined) delete process.env.SSRF_ALLOWED_HOSTS; else process.env.SSRF_ALLOWED_HOSTS = before;
    await new Promise<void>((r) => server.close(() => r()));
});

test('고정 IP dispatcher 로 실제 연결이 성립하고 본문·헤더를 읽는다', async () => {
    const r = await safeFetch(`http://127.0.0.1:${port}/ok`, { headers: { authorization: 'Bearer t' } });
    expect(r.status).toBe(200);
    expect(r.headers.get('x-seen-auth')).toBe('Bearer t');
    expect(await r.json()).toEqual({ path: '/ok' });
});

test('같은 origin 리다이렉트를 따라간다', async () => {
    const r = await safeFetch(`http://127.0.0.1:${port}/redirect`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ path: '/ok' });
});

test('허용 목록 밖 사설 주소는 연결 전에 차단', async () => {
    await expect(safeFetch('http://127.0.0.1:1/x')).rejects.toThrow(/SSRF blocked/);
});
