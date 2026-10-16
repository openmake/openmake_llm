/**
 * MCP SDK 의 same-origin 리다이렉트 정책이 createPinnedFetch 를 거쳐도 지켜지는지 — 실제 연결로 고정.
 * SDK 는 주입한 fetch 를 redirect:'manual' 로 부르고 3xx 를 직접 판단한다. safeFetch 가 그 값을 무시하고
 * 스스로 따라가면 외부 origin 으로 JSON-RPC 본문·mcp-session-id 가 다시 보내진다(2026-10-16 수정).
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createPinnedFetch } from '../ssrf-guard';

let serverA: http.Server;
let serverB: http.Server;
let portA = 0;
let portB = 0;
const hitsA: string[] = [];
const hitsB: string[] = [];
const before = process.env.SSRF_ALLOWED_HOSTS;

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
        let data = '';
        req.on('data', (c: Buffer) => { data += c.toString(); });
        req.on('end', () => resolve(data));
    });
}

async function listen(handler: http.RequestListener): Promise<{ server: http.Server; port: number }> {
    const server = http.createServer(handler);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    return { server, port: (server.address() as AddressInfo).port };
}

beforeAll(async () => {
    ({ server: serverB, port: portB } = await listen((req, res) => {
        hitsB.push(`${req.method} ${req.url}`);
        res.writeHead(500); res.end();
    }));
    ({ server: serverA, port: portA } = await listen(async (req, res) => {
        hitsA.push(`${req.method} ${req.url}`);
        if (req.url === '/cross') { res.writeHead(307, { location: `http://127.0.0.1:${portB}/mcp` }); res.end(); return; }
        if (req.url === '/same') { res.writeHead(307, { location: '/mcp2' }); res.end(); return; }
        if (req.url === '/mcp2' && req.method === 'POST') {
            const msg = JSON.parse(await readBody(req)) as { id?: number; params?: { protocolVersion?: string } };
            if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
                jsonrpc: '2.0',
                id: msg.id,
                result: { protocolVersion: msg.params?.protocolVersion, capabilities: {}, serverInfo: { name: 't', version: '1' } },
            }));
            return;
        }
        res.writeHead(405); res.end();
    }));
    process.env.SSRF_ALLOWED_HOSTS = `127.0.0.1:${portA},127.0.0.1:${portB}`;
});

afterAll(async () => {
    if (before === undefined) delete process.env.SSRF_ALLOWED_HOSTS; else process.env.SSRF_ALLOWED_HOSTS = before;
    await Promise.all([serverA, serverB].map((s) => new Promise<void>((r) => s.close(() => r()))));
});

function connect(path: string): { client: Client; done: Promise<void> } {
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${portA}${path}`), { fetch: createPinnedFetch() });
    const client = new Client({ name: 'redirect-test', version: '1.0.0' });
    return { client, done: client.connect(transport) };
}

test('다른 origin 으로의 307 은 따라가지 않는다 — 연결 실패, B 는 요청을 받지 않음', async () => {
    const { client, done } = connect('/cross');
    await expect(done).rejects.toThrow(/Redirect to .* not followed/);
    await client.close().catch(() => undefined);
    expect(hitsA).toContain('POST /cross');
    expect(hitsB).toEqual([]);
});

test('같은 origin 307 은 SDK 가 따라가 initialize 가 끝난다', async () => {
    const { client, done } = connect('/same');
    await expect(done).resolves.toBeUndefined();
    await client.close().catch(() => undefined);
    expect(hitsA).toContain('POST /mcp2');
    expect(hitsB).toEqual([]);
});
