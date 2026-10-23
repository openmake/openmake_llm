/**
 * 마지막 사용 시각(2026-10-23 R6) — 사용자 풀 유휴 회수의 입력. connect·callTool 이 갱신한다.
 */
import { PassThrough } from 'stream';

class FakeStdioTransport {
    stderr = new PassThrough();
    constructor(public params: unknown) {}
}
class FakeClient {
    onclose?: () => void;
    constructor(_info: unknown, _opts: unknown) { /* noop */ }
    connect = jest.fn(async () => undefined);
    listTools = jest.fn(async () => ({ tools: [] }));
    callTool = jest.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
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

const cfg = { id: 'mcp_1', name: 'fs', transport_type: 'stdio', command: '/usr/bin/node', args: ['cli.js'], sandbox_network: 'host' } as unknown as MCPServerConfig;

afterEach(() => { jest.restoreAllMocks(); });

describe('ExternalMCPClient.lastUsedAt', () => {
    it('(e) connect 때 찍히고 callTool 뒤 갱신된다', async () => {
        const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
        const c = new ExternalMCPClient(cfg);
        await c.connect();
        expect(c.lastUsedAt).toBe(1_000);

        now.mockReturnValue(5_000);
        await c.callTool('read', { path: '/x' });
        expect(c.lastUsedAt).toBe(5_000);
    });
});
