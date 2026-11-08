/**
 * ExternalMCPClient — 관리자 bridge 허용 옵션(2026-11-08 점검 후속)을 prepareSandboxConfig 와
 * buildSandboxedCommand 에 같은 값으로 넘긴다.
 */
class FakeClient {
    onclose?: () => void;
    connect = jest.fn(async (_transport: unknown) => undefined);
    listTools = jest.fn(async () => ({ tools: [] }));
    close = jest.fn(async () => undefined);
}

const mockBuildSandboxedCommand = jest.fn((p: { command: string; args: string[] }, _cfg?: unknown) => ({ sandboxed: false, command: p.command, args: p.args }));
const mockPrepare = jest.fn();

jest.mock('@modelcontextprotocol/client', () => ({
    Client: FakeClient,
    StreamableHTTPClientTransport: class {},
    SSEClientTransport: class {},
}));
jest.mock('@modelcontextprotocol/client/stdio', () => ({
    StdioClientTransport: class { stderr = null; },
}));
jest.mock('../sandbox-docker', () => ({
    buildSandboxedCommand: (p: { command: string; args: string[] }, c?: unknown) => mockBuildSandboxedCommand(p, c),
}));
jest.mock('../sandbox-egress', () => ({ prepareSandboxConfig: (...a: unknown[]) => mockPrepare(...a) }));
jest.mock('../oauth-provider', () => ({ McpOAuthProvider: class {} }));
jest.mock('../../../security/ssrf-guard', () => ({ createPinnedFetch: () => fetch }));

import { ExternalMCPClient } from '../external-client';
import type { MCPServerConfig } from '../../../tool-contract/types';

const BASE = { name: 'x', transport_type: 'stdio', command: '/usr/bin/node', args: ['cli.js'], id: 'mcp_7_u', user_id: '7' };

beforeEach(() => { mockBuildSandboxedCommand.mockClear(); mockPrepare.mockReset(); mockPrepare.mockResolvedValue(undefined); });

type BridgeArg = { bridgeAllowed?: boolean };

describe('ExternalMCPClient — bridge 허용 전달', () => {
    it('sandbox_bridge_allowed:true → 두 판정 모두 bridgeAllowed:true', async () => {
        await new ExternalMCPClient({ ...BASE, sandbox_bridge_allowed: true } as unknown as MCPServerConfig).connect();
        expect((mockPrepare.mock.calls[0][0] as BridgeArg).bridgeAllowed).toBe(true);
        expect((mockBuildSandboxedCommand.mock.calls[0][0] as BridgeArg).bridgeAllowed).toBe(true);
    });

    it.each([['미지정', {}], ['false', { sandbox_bridge_allowed: false }]])('%s → 두 판정 모두 bridgeAllowed 가 true 아님', async (_n, over) => {
        await new ExternalMCPClient({ ...BASE, ...over } as unknown as MCPServerConfig).connect();
        expect((mockPrepare.mock.calls[0][0] as BridgeArg).bridgeAllowed).not.toBe(true);
        expect((mockBuildSandboxedCommand.mock.calls[0][0] as BridgeArg).bridgeAllowed).not.toBe(true);
    });
});
