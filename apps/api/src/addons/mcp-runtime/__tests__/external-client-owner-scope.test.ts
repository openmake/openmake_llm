/**
 * ExternalMCPClient — buildSandboxedCommand 의 ownerScope 파생(W3 S2).
 *
 * config.user_id 가 있으면 사용자 소유('user'), 없으면 관리자 전역('global')으로 샌드박스에 넘긴다.
 */
class FakeClient {
    onclose?: () => void;
    connect = jest.fn(async (_transport: unknown) => undefined);
    listTools = jest.fn(async () => ({ tools: [] }));
    close = jest.fn(async () => undefined);
}

const mockBuildSandboxedCommand = jest.fn((p: { command: string; args: string[] }) => ({ sandboxed: false, command: p.command, args: p.args }));

jest.mock('@modelcontextprotocol/client', () => ({
    Client: FakeClient,
    StreamableHTTPClientTransport: class {},
    SSEClientTransport: class {},
}));
jest.mock('@modelcontextprotocol/client/stdio', () => ({
    StdioClientTransport: class { stderr = null; },
}));
jest.mock('../sandbox-docker', () => ({
    buildSandboxedCommand: (p: { command: string; args: string[] }) => mockBuildSandboxedCommand(p),
}));
jest.mock('../oauth-provider', () => ({ McpOAuthProvider: class {} }));
jest.mock('../../../security/ssrf-guard', () => ({ createPinnedFetch: () => fetch }));

import { ExternalMCPClient } from '../external-client';
import type { MCPServerConfig } from '../../../tool-contract/types';

const BASE = { name: 'x', transport_type: 'stdio', command: '/usr/bin/node', args: ['cli.js'] };

beforeEach(() => { mockBuildSandboxedCommand.mockClear(); });

describe('ExternalMCPClient — 샌드박스 ownerScope', () => {
    it("user_id 가 있으면 ownerScope:'user'", async () => {
        await new ExternalMCPClient({ ...BASE, id: 'mcp_7_u', user_id: '7' } as unknown as MCPServerConfig).connect();
        expect(mockBuildSandboxedCommand).toHaveBeenCalledTimes(1);
        expect(mockBuildSandboxedCommand).toHaveBeenCalledWith(expect.objectContaining({ serverId: 'mcp_7_u', ownerScope: 'user' }));
    });

    it("user_id 가 없으면 ownerScope:'global'", async () => {
        await new ExternalMCPClient({ ...BASE, id: 'mcp_g' } as unknown as MCPServerConfig).connect();
        expect(mockBuildSandboxedCommand).toHaveBeenCalledWith(expect.objectContaining({ serverId: 'mcp_g', ownerScope: 'global' }));
    });
});
