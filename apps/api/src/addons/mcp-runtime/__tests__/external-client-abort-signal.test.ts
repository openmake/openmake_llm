/**
 * 외부 MCP 호출의 중단 신호(2026-10-22 R4) — 에이전트 작업 루프의 signal 이 SDK callTool 옵션까지 내려가고,
 * 이미 중단됐으면 서버를 부르지 않으며, 호출 중 중단은 isError 결과로 돌아온다.
 */
import { PassThrough } from 'stream';

const clients: FakeClient[] = [];
class FakeStdioTransport {
    stderr = new PassThrough();
    constructor(public params: unknown) {}
}
class FakeClient {
    onclose?: () => void;
    constructor(_info: unknown, _opts: unknown) { clients.push(this); }
    connect = jest.fn(async () => undefined);
    listTools = jest.fn(async () => ({ tools: [] }));
    callTool = jest.fn(async (_params: unknown, _opts?: { signal?: AbortSignal }) => ({ content: [{ type: 'text', text: 'ok' }] }));
    close = jest.fn(async () => undefined);
    setRequestHandler(): void { /* noop */ }
}

jest.mock('@modelcontextprotocol/client', () => ({ Client: FakeClient, StreamableHTTPClientTransport: class {}, SSEClientTransport: class {} }));
jest.mock('@modelcontextprotocol/client/stdio', () => ({ StdioClientTransport: FakeStdioTransport }));
jest.mock('../sandbox-docker', () => ({ buildSandboxedCommand: (p: { command: string; args: string[] }) => ({ sandboxed: false, command: p.command, args: p.args }) }));
jest.mock('../oauth-provider', () => ({ McpOAuthProvider: class {} }));
jest.mock('../../../security/ssrf-guard', () => ({ createPinnedFetch: () => fetch }));
jest.mock('../../../config/env', () => ({ getConfig: () => ({ mcpToolListStaleMs: 0 }) }));

import { ExternalMCPClient } from '../external-client';
import type { MCPServerConfig } from '../../../tool-contract/types';

const cfg = { id: 'mcp_3_od', name: 'open-design', transport_type: 'stdio', command: '/usr/bin/node', args: ['cli.js'], sandbox_network: 'host' } as unknown as MCPServerConfig;

const textOf = (r: { content: Array<{ type: string; text?: string }> }): string => r.content.map(c => c.text ?? '').join('');

beforeEach(() => { clients.length = 0; });

describe('ExternalMCPClient — 중단 신호', () => {
    it('signal 을 주면 SDK callTool 옵션에 그 signal 이 들어간다', async () => {
        const c = new ExternalMCPClient(cfg);
        await c.connect();
        const ac = new AbortController();
        const r = await c.callTool('create', { title: 'a' }, { signal: ac.signal });
        expect(r.isError).toBeFalsy();
        expect(clients[0].callTool).toHaveBeenCalledTimes(1);
        expect(clients[0].callTool.mock.calls[0][1]).toEqual({ signal: ac.signal });
    });

    it('signal 이 없으면 종전 요청 그대로다(옵션 인자 없음)', async () => {
        const c = new ExternalMCPClient(cfg);
        await c.connect();
        await c.callTool('create', { title: 'a' });
        expect(clients[0].callTool.mock.calls[0]).toHaveLength(1);
    });

    it('이미 중단된 signal 이면 SDK 를 부르지 않고 isError', async () => {
        const c = new ExternalMCPClient(cfg);
        await c.connect();
        const ac = new AbortController();
        ac.abort();
        const r = await c.callTool('create', { title: 'a' }, { signal: ac.signal });
        expect(clients[0].callTool).not.toHaveBeenCalled();
        expect(r.isError).toBe(true);
        expect(textOf(r)).toContain('중단');
        expect(textOf(r)).toContain('open-design::create');
    });

    it('호출 중 abort 되면 SDK 거부가 isError 결과로 돌아온다', async () => {
        const c = new ExternalMCPClient(cfg);
        await c.connect();
        clients[0].callTool.mockImplementationOnce((_params, opts) => new Promise((_, reject) => {
            opts?.signal?.addEventListener('abort', () => reject(new Error('This operation was aborted')));
        }));
        const ac = new AbortController();
        const pending = c.callTool('create', { title: 'a' }, { signal: ac.signal });
        ac.abort();
        const r = await pending;
        expect(r.isError).toBe(true);
        expect(textOf(r)).toMatch(/중단|abort/);
    });
});
