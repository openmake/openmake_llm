/**
 * 외부 MCP 호출의 멱등 키 — 호출 문맥에 키가 있으면 `_meta["openmake/idempotencyKey"]` 로 싣고, 없으면 종전 요청 그대로다.
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
import { runWithToolCallContext } from '../../../utils/tool-call-context';
import { MCP_IDEMPOTENCY_META_KEY } from '../../../config/runtime-limits';
import type { MCPServerConfig } from '../../../tool-contract/types';

const cfg = { id: 'mcp_3_od', name: 'open-design', transport_type: 'stdio', command: '/usr/bin/node', args: ['cli.js'], sandbox_network: 'host' } as unknown as MCPServerConfig;

beforeEach(() => { clients.length = 0; });

describe('ExternalMCPClient — 멱등 키', () => {
    it('호출 문맥에 키가 있으면 _meta 에 싣는다', async () => {
        const c = new ExternalMCPClient(cfg);
        await c.connect();
        await runWithToolCallContext({ idempotencyKey: 'k-123' }, () => c.callTool('create', { title: 'a' }));
        expect(clients[0].callTool).toHaveBeenCalledWith({ name: 'create', arguments: { title: 'a' }, _meta: { [MCP_IDEMPOTENCY_META_KEY]: 'k-123' } });
    });

    it('문맥이 없으면 종전 요청 그대로다', async () => {
        const c = new ExternalMCPClient(cfg);
        await c.connect();
        await c.callTool('create', { title: 'a' });
        expect(clients[0].callTool).toHaveBeenCalledWith({ name: 'create', arguments: { title: 'a' } });
    });
});
