/**
 * connectGlobalServer — 전역 서버 수동 연결이 DB 행의 sandbox_network 를 registry config 에 싣는다.
 *
 * 빠뜨리면 관리자가 호스트 실행(opt-out)으로 둔 전역 서버가 수동 연결 때 docker 기본('full')으로 뜬다.
 */
const mockConnectServer = jest.fn(async (_id: string, _config: unknown) => undefined);
const mockGetServerStatus = jest.fn((_id: string) => ({ status: 'connected' }));
const mockServerRow: Record<string, unknown> = {};

jest.mock('../index', () => ({
    getUnifiedMCPClient: () => ({
        getServerRegistry: () => ({ connectServer: mockConnectServer, getServerStatus: mockGetServerStatus }),
    }),
}));
jest.mock('../../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ getPool: () => ({}) }),
}));
jest.mock('../data/mcp-server-repository', () => ({
    McpServerRepository: class { getMcpServerById = jest.fn(async () => ({ ...mockServerRow })); },
}));
jest.mock('../data/mcp-catalog-repository', () => ({
    McpCatalogRepository: class { decryptEnvForSpawn = jest.fn(async () => ({})); },
}));

import { connectGlobalServer } from '../routes/mcp-global-connect';

const BASE_ROW = {
    id: 'mcp_global_1', name: 'global-host', transport_type: 'stdio', command: 'npx', args: ['-y', 'pkg'],
    env: null, url: null, enabled: true, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', user_id: null,
};

beforeEach(() => {
    mockConnectServer.mockClear();
    for (const k of Object.keys(mockServerRow)) delete mockServerRow[k];
});

describe('connectGlobalServer — sandbox_network 전달', () => {
    it("호스트 opt-out 전역 서버는 config 에 sandbox_network:'host' 를 싣는다", async () => {
        Object.assign(mockServerRow, BASE_ROW, { sandbox_network: 'host' });
        await expect(connectGlobalServer('mcp_global_1')).resolves.toEqual({ status: 'connected' });
        expect(mockConnectServer).toHaveBeenCalledTimes(1);
        expect(mockConnectServer.mock.calls[0]![1]).toEqual(expect.objectContaining({ id: 'mcp_global_1', sandbox_network: 'host' }));
    });

    it('sandbox_network 가 NULL 이면 undefined(외부 클라이언트 기본 full)로 둔다', async () => {
        Object.assign(mockServerRow, BASE_ROW, { sandbox_network: null });
        await connectGlobalServer('mcp_global_1');
        expect((mockConnectServer.mock.calls[0]![1] as { sandbox_network?: string }).sandbox_network).toBeUndefined();
    });
});
