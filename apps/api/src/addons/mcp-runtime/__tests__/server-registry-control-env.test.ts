/**
 * 수동 MCP 서버 등록의 저장 시점 제어 env 거부(#1471 후속) — spawn 때 걷어내는 것과 별개로,
 * 제어 키(NODE_OPTIONS·GIT_DIR 등)를 가진 설정은 DB 에 쓰기 전에 거부한다. 오류에는 키 이름만 있고 값은 없다.
 * GIT_TOKEN 같은 자격증명 이름은 그대로 저장된다.
 */
const clientCtor = jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    getTools: jest.fn().mockReturnValue([]),
    disconnect: jest.fn().mockResolvedValue(undefined), getStatus: () => ({ serverId: 'mcp_1', serverName: 'srv', status: 'connected', toolCount: 0 }),
    callTool: jest.fn(),
}));
jest.mock('../external-client', () => ({ ExternalMCPClient: clientCtor }));

import { MCPServerRegistry } from '../server-registry';
import { McpCatalogInputError } from '../../../security/spawn-env-policy';
import type { MCPServerConfig } from '../../../tool-contract/types';

const SECRET = `v-${Math.random().toString(36).slice(2)}`;
const config = (env: Record<string, string>): MCPServerConfig => ({
    id: 'mcp_1', name: 'srv', transport_type: 'stdio', command: 'npx', args: ['-y', 'pkg'], env, enabled: true,
    created_at: '2026-01-01', updated_at: '2026-01-01',
} as MCPServerConfig);
const fakeDb = () => ({ createMcpServer: jest.fn(async () => ({})), deleteMcpServer: jest.fn(), getGlobalMcpServers: jest.fn(async () => []) });

describe('MCPServerRegistry.registerServer — 저장 전 제어 env 거부', () => {
    const registry = new MCPServerRegistry({ registerExternalTools: jest.fn(), unregisterExternalTools: jest.fn() } as never);
    beforeEach(() => clientCtor.mockClear());

    it.each(['GIT_DIR', 'GIT_CONFIG', 'NODE_OPTIONS', 'git_trace_setup'])('%s 가 있으면 DB 에 쓰지 않고 연결도 하지 않는다', async (k) => {
        const db = fakeDb();
        const err = await registry.registerServer(config({ [k]: SECRET, API_KEY: 'k' }), db as never).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(McpCatalogInputError);
        expect((err as Error).message).toContain(k);
        expect((err as Error).message).not.toContain(SECRET);
        expect(db.createMcpServer).not.toHaveBeenCalled();
        expect(clientCtor).not.toHaveBeenCalled();
    });

    it('GIT_TOKEN 등 자격증명 이름만 있으면 종전대로 저장한다', async () => {
        const db = fakeDb();
        await registry.registerServer(config({ GIT_TOKEN: SECRET, API_KEY: 'k' }), db as never);
        expect(db.createMcpServer).toHaveBeenCalledWith(expect.objectContaining({ env: { GIT_TOKEN: SECRET, API_KEY: 'k' } }));
    });
});
