/**
 * elicitation 광고·핸들러 배선(F13.10) — 플래그 ON + 사용자 풀 서버(user_id)만 광고하고, 도구 호출은 마감 연장 경로를 탄다.
 */
import { PassThrough } from 'stream';

const clients: FakeClient[] = [];
class FakeStdioTransport {
    stderr = new PassThrough();
    constructor(public params: unknown) {}
}
class FakeClient {
    onclose?: () => void;
    capabilities: unknown;
    handlers = new Map<string, (req: { params: unknown }) => Promise<unknown>>();
    constructor(_info: unknown, opts: { capabilities?: unknown }) {
        this.capabilities = opts.capabilities;
        clients.push(this);
    }
    connect = jest.fn(async () => undefined);
    listTools = jest.fn(async () => ({ tools: [] }));
    callTool = jest.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
    close = jest.fn(async () => undefined);
    setRequestHandler(method: string, h: (req: { params: unknown }) => Promise<unknown>) { this.handlers.set(method, h); }
}

jest.mock('@modelcontextprotocol/client', () => ({ Client: FakeClient, StreamableHTTPClientTransport: class {}, SSEClientTransport: class {} }));
jest.mock('@modelcontextprotocol/client/stdio', () => ({ StdioClientTransport: FakeStdioTransport }));
jest.mock('../sandbox-docker', () => ({ buildSandboxedCommand: (p: { command: string; args: string[] }) => ({ sandboxed: false, command: p.command, args: p.args }) }));
jest.mock('../oauth-provider', () => ({ McpOAuthProvider: class {} }));
jest.mock('../../../security/ssrf-guard', () => ({ createPinnedFetch: () => fetch }));
jest.mock('../../../config/env', () => ({ getConfig: () => ({ mcpToolListStaleMs: 0 }) }));

import type { MCPServerConfig } from '../../../tool-contract/types';
type ClientCtor = typeof import('../external-client').ExternalMCPClient;

const base = { id: 'mcp_3_od', name: 'open-design', transport_type: 'stdio', command: '/usr/bin/node', args: ['cli.js'], sandbox_network: 'host' };

function load(enabled: boolean): ClientCtor {
    let Ctor!: ClientCtor;
    const prev = process.env.MCP_ELICITATION_ENABLED;
    process.env.MCP_ELICITATION_ENABLED = enabled ? 'true' : 'false';
    jest.isolateModules(() => { Ctor = (require('../external-client') as typeof import('../external-client')).ExternalMCPClient; });
    process.env.MCP_ELICITATION_ENABLED = prev;
    return Ctor;
}

beforeEach(() => { clients.length = 0; });

describe('ExternalMCPClient — elicitation 배선', () => {
    it('플래그 OFF 면 사용자 풀 서버여도 광고·핸들러 없음, 호출은 옵션 없이', async () => {
        const c = new (load(false))({ ...base, user_id: '3' } as unknown as MCPServerConfig);
        await c.connect();
        const sdk = clients[0];
        expect(sdk.capabilities).toEqual({});
        expect(sdk.handlers.size).toBe(0);
        await c.callTool('t', {});
        expect(sdk.callTool).toHaveBeenCalledWith({ name: 't', arguments: {} });
        expect(c.isAwaitingInput()).toBe(false);
    });

    it('플래그 ON 이어도 전역 서버(user_id 없음)는 광고하지 않는다', async () => {
        const c = new (load(true))(base as unknown as MCPServerConfig);
        await c.connect();
        expect(clients[0].capabilities).toEqual({});
        expect(clients[0].handlers.size).toBe(0);
    });

    it('플래그 ON + 사용자 풀 서버는 form 을 광고하고, 문맥 없는 요청엔 decline, 호출엔 signal·timeout 을 넘긴다', async () => {
        const c = new (load(true))({ ...base, user_id: '3' } as unknown as MCPServerConfig);
        await c.connect();
        const sdk = clients[0];
        expect(sdk.capabilities).toEqual({ elicitation: { form: {} } });
        const handler = sdk.handlers.get('elicitation/create');
        expect(handler).toBeDefined();
        await expect(handler!({ params: { message: 'm', requestedSchema: { type: 'object', properties: {} } } })).resolves.toEqual({ action: 'decline' });
        await c.callTool('t', {});
        expect(sdk.callTool).toHaveBeenCalledWith({ name: 't', arguments: {} }, expect.objectContaining({ signal: expect.any(Object), timeout: expect.any(Number) }));
    });
});
