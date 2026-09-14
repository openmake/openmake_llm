/**
 * ExternalMCPClient 예기치 않은 transport 종료 감지 (2026-09-15).
 *
 * 배경: open-design MCP(stdio)는 30분 유휴 시 스스로 종료하는데, 클라이언트가 종료를 감지하지 못해
 * status 가 'connected' 로 남았다 — supervisor 가 구독하는 'exit' 가 한 번도 발행되지 않아 풀에서
 * 빠지지 않았고, 끊긴 뒤 첫 도구 호출이 "Not connected" 로 실패했다.
 */
import { PassThrough } from 'stream';

const clients: FakeClient[] = [];

class FakeStdioTransport {
    stderr = new PassThrough();
    constructor(public params: unknown) {}
}

class FakeClient {
    onclose?: () => void;
    constructor() { clients.push(this); }
    connect = jest.fn(async (_transport: unknown) => undefined);
    listTools = jest.fn(async () => ({ tools: [{ name: 'list_projects', inputSchema: { type: 'object' } }] }));
    callTool = jest.fn();
    ping = jest.fn();
    /** SDK 처럼 close() 가 onclose 를 부른다 */
    close = jest.fn(async () => { this.onclose?.(); });
}

jest.mock('@modelcontextprotocol/client', () => ({
    Client: FakeClient,
    StreamableHTTPClientTransport: class {},
    SSEClientTransport: class {},
}));
jest.mock('@modelcontextprotocol/client/stdio', () => ({ StdioClientTransport: FakeStdioTransport }));
jest.mock('../sandbox-docker', () => ({
    buildSandboxedCommand: (p: { command: string; args: string[] }) => ({ sandboxed: false, command: p.command, args: p.args }),
}));
jest.mock('../oauth-provider', () => ({ McpOAuthProvider: class {} }));
jest.mock('../../security/ssrf-guard', () => ({ createPinnedFetch: () => fetch }));

import { ExternalMCPClient } from '../external-client';
import type { MCPServerConfig } from '../types';

const config = {
    id: 'mcp_3_od', name: 'open-design', transport_type: 'stdio',
    command: '/usr/bin/node', args: ['cli.js', 'mcp'], sandbox_network: 'host',
} as unknown as MCPServerConfig;

async function connected() {
    const c = new ExternalMCPClient(config);
    await c.connect();
    const sdk = clients[clients.length - 1];
    const transport = sdk.connect.mock.calls[0][0] as unknown as FakeStdioTransport;
    return { c, sdk, transport };
}

beforeEach(() => { clients.length = 0; });

describe('ExternalMCPClient — transport 종료 감지', () => {
    it('자식이 스스로 끝나면 disconnected 로 내리고 stderr 끝부분을 사유로 exit 를 발행한다', async () => {
        const { c, sdk, transport } = await connected();
        expect(c.getStatus().status).toBe('connected');
        const exit = jest.fn();
        c.on('exit', exit);

        transport.stderr.write('idle for 30m, exiting\n');
        await new Promise((r) => setImmediate(r));
        sdk.onclose?.();

        expect(c.getStatus().status).toBe('disconnected');
        expect(c.getTools()).toEqual([]);
        expect(exit).toHaveBeenCalledTimes(1);
        expect(exit.mock.calls[0][2]).toContain('idle for 30m, exiting');
        expect(c.getStatus().error).toContain('transport closed');
    });

    it('의도한 disconnect() 는 exit 를 발행하지 않는다 (close 가 onclose 를 불러도)', async () => {
        const { c, sdk } = await connected();
        const exit = jest.fn();
        c.on('exit', exit);

        await c.disconnect();

        expect(sdk.close).toHaveBeenCalled();
        expect(exit).not.toHaveBeenCalled();
        expect(c.getStatus().status).toBe('disconnected');
    });

    it('끊긴 뒤 callTool 은 SDK 를 부르지 않고 미연결 오류를 돌려준다', async () => {
        const { c, sdk } = await connected();
        sdk.onclose?.();

        const r = await c.callTool('list_projects', {});

        expect(r.isError).toBe(true);
        expect(sdk.callTool).not.toHaveBeenCalled();
    });
});
