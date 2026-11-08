/**
 * ExternalMCPClient — stdio spawn 전에 prepareSandboxConfig 결과를 buildSandboxedCommand 에 넘긴다
 * (사용자 MCP 서버 실행 격리 보강, 2026-11-08 점검).
 */
class FakeClient {
    onclose?: () => void;
    connect = jest.fn(async (_transport: unknown) => undefined);
    listTools = jest.fn(async () => ({ tools: [] }));
    close = jest.fn(async () => undefined);
}

const mockBuildSandboxedCommand = jest.fn((p: { command: string; args: string[] }, _cfg?: unknown) => ({ sandboxed: false, command: p.command, args: p.args }));
const mockPrepare = jest.fn();
const mockStdioCtor = jest.fn();

jest.mock('@modelcontextprotocol/client', () => ({
    Client: FakeClient,
    StreamableHTTPClientTransport: class {},
    SSEClientTransport: class {},
}));
jest.mock('@modelcontextprotocol/client/stdio', () => ({
    StdioClientTransport: class { stderr = null; constructor(o: unknown) { mockStdioCtor(o); } },
}));
jest.mock('../sandbox-docker', () => ({
    buildSandboxedCommand: (p: { command: string; args: string[] }, c?: unknown) => mockBuildSandboxedCommand(p, c),
}));
jest.mock('../sandbox-egress', () => ({ prepareSandboxConfig: (...a: unknown[]) => mockPrepare(...a) }));
jest.mock('../oauth-provider', () => ({ McpOAuthProvider: class {} }));
jest.mock('../../../security/ssrf-guard', () => ({ createPinnedFetch: () => fetch }));

import { ExternalMCPClient } from '../external-client';
import type { MCPServerConfig } from '../../../tool-contract/types';

const BASE = { name: 'x', transport_type: 'stdio', command: '/usr/bin/node', args: ['cli.js'] };

beforeEach(() => { mockBuildSandboxedCommand.mockClear(); mockPrepare.mockReset(); mockStdioCtor.mockClear(); });

describe('ExternalMCPClient — egress 설정 준비', () => {
    it('사용자 서버: prepareSandboxConfig({network:full, ownerScope:user}) 결과를 두 번째 인자로 넘긴다', async () => {
        const prepared = { marker: 'prepared' };
        mockPrepare.mockResolvedValue(prepared);
        await new ExternalMCPClient({ ...BASE, id: 'mcp_7_u', user_id: '7' } as unknown as MCPServerConfig).connect();
        expect(mockPrepare).toHaveBeenCalledWith({ network: 'full', ownerScope: 'user', bridgeAllowed: false });
        expect(mockBuildSandboxedCommand).toHaveBeenCalledTimes(1);
        expect(mockBuildSandboxedCommand.mock.calls[0][1]).toBe(prepared);
    });

    it('prepareSandboxConfig 가 거부하면 connect() 가 같은 오류로 reject 하고 transport 를 만들지 않는다', async () => {
        const refused = Object.assign(new Error('egress'), { code: 'MCP_SANDBOX_EGRESS_REQUIRED' });
        mockPrepare.mockRejectedValue(refused);
        await expect(new ExternalMCPClient({ ...BASE, id: 'mcp_7_u', user_id: '7' } as unknown as MCPServerConfig).connect()).rejects.toBe(refused);
        expect(mockBuildSandboxedCommand).not.toHaveBeenCalled();
        expect(mockStdioCtor).not.toHaveBeenCalled();
    });
});
