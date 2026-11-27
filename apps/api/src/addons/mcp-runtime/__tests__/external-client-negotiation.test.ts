/**
 * 협상 관측 배선(MCP-1) — 연결 성공 뒤 관측기를 1회 부르고, 관측기가 실패해도 연결은 정상이다.
 * 연결 실패에는 부르지 않는다.
 */
import { PassThrough } from 'stream';

class FakeStdioTransport {
    stderr = new PassThrough();
    constructor(public params: unknown) {}
}
const connectImpl = jest.fn(async () => undefined);
class FakeClient {
    onclose?: () => void;
    constructor(_info: unknown, _opts: unknown) { /* noop */ }
    connect = connectImpl;
    listTools = jest.fn(async () => ({ tools: [{ name: 'read', inputSchema: { type: 'object' } }] }));
    close = jest.fn(async () => undefined);
    getServerCapabilities = () => ({ tools: {} });
    setRequestHandler(): void { /* noop */ }
}

const observe = jest.fn();
jest.mock('../negotiation-observer', () => ({ observeNegotiation: (...a: unknown[]) => observe(...a) }));
jest.mock('@modelcontextprotocol/client', () => ({ Client: FakeClient, StreamableHTTPClientTransport: class {}, SSEClientTransport: class {} }));
jest.mock('@modelcontextprotocol/client/stdio', () => ({ StdioClientTransport: FakeStdioTransport }));
jest.mock('../sandbox-egress', () => ({ prepareSandboxConfig: async () => undefined }));
jest.mock('../sandbox-docker', () => ({ buildSandboxedCommand: (p: { command: string; args: string[] }) => ({ sandboxed: false, command: p.command, args: p.args }) }));
jest.mock('../oauth-provider', () => ({ McpOAuthProvider: class {} }));
jest.mock('../../../security/ssrf-guard', () => ({ createPinnedFetch: () => fetch }));
jest.mock('../../../config/env', () => ({ getConfig: () => ({ mcpToolListStaleMs: 0 }) }));

import { ExternalMCPClient } from '../external-client';
import type { MCPServerConfig } from '../../../tool-contract/types';

const cfg = { id: 'mcp_1', name: 'fs', transport_type: 'stdio', command: '/usr/bin/node', args: ['cli.js'], sandbox_network: 'host' } as unknown as MCPServerConfig;

beforeEach(() => { observe.mockReset(); connectImpl.mockReset(); connectImpl.mockImplementation(async () => undefined); });

describe('ExternalMCPClient 협상 관측 배선', () => {
    it('연결 성공 뒤 서버 설정·SDK client·provider(stdio=없음)로 1회 부른다', async () => {
        observe.mockResolvedValue(undefined);
        const c = new ExternalMCPClient(cfg);
        await c.connect();
        expect(observe).toHaveBeenCalledTimes(1);
        const [config, client, auth] = observe.mock.calls[0];
        expect(config).toBe(cfg);
        expect(client).toBe(c.getSdkClient());
        expect(auth).toBeUndefined();
    });

    it('관측기가 reject 해도 연결·도구 목록은 정상', async () => {
        observe.mockRejectedValue(new Error('boom'));
        const c = new ExternalMCPClient(cfg);
        await expect(c.connect()).resolves.toBeUndefined();
        await new Promise(r => setImmediate(r));
        expect(c.getStatus().status).toBe('connected');
        expect(c.getStatus().toolCount).toBe(1);
    });

    it('연결 실패면 부르지 않는다', async () => {
        connectImpl.mockImplementation(async () => { throw new Error('refused'); });
        const c = new ExternalMCPClient(cfg);
        await expect(c.connect()).rejects.toThrow('refused');
        expect(observe).not.toHaveBeenCalled();
    });
});
