/**
 * ToolRouter — 끊긴 사용자 MCP 서버 복구 후 실행 (2026-09-15).
 *
 * 배경: open-design MCP(stdio)가 30분 유휴 종료한 뒤 LLM 의 첫 도구 호출이 "Not connected" 로 실패했다.
 * 라우터는 끊긴 client 를 빼고, 풀에 없으면 supervisor 로 풀을 보장한 뒤 한 번만 다시 실행해야 한다.
 */
import { UserMCPPool } from '../user-pool';
import type { ExternalMCPClient } from '../external-client';
import type { MCPToolResult } from '../types';

const pool = new UserMCPPool();
const ensureUserServers = jest.fn<Promise<void>, [string, string?]>();

jest.mock('../user-pool', () => ({ ...jest.requireActual('../user-pool'), getUserMCPPool: () => pool }));
jest.mock('../lifecycle-supervisor', () => ({ getLifecycleSupervisor: () => ({ ensureUserServers }) }));

import { ToolRouter } from '../tool-router';

const USER = { userId: '3', role: 'user' as const };
const TOOL = 'open-design::list_projects';

function fakeClient(opts: { status?: string; result?: MCPToolResult } = {}) {
    const client = {
        status: opts.status ?? 'connected',
        getStatus() { return { serverId: 'mcp_3_od', serverName: 'open-design', status: this.status, toolCount: 1 }; },
        getTools: () => [{ name: 'list_projects', description: '', inputSchema: { type: 'object', properties: {} } }],
        getConfig: () => ({ id: 'mcp_3_od', name: 'open-design', transport_type: 'stdio' }),
        callTool: jest.fn(async () => opts.result ?? { content: [{ type: 'text', text: '{"projects":[]}' }] }),
        disconnect: jest.fn(async () => undefined),
    };
    return client;
}
const asClient = (c: ReturnType<typeof fakeClient>) => c as unknown as ExternalMCPClient;

beforeEach(async () => {
    await pool.closeAll();
    ensureUserServers.mockReset();
});

describe('ToolRouter.executeTool — 끊긴 사용자 MCP 복구', () => {
    it('유휴 종료로 풀에서 빠진 서버는 풀을 보장한 뒤 실행한다', async () => {
        const fresh = fakeClient();
        ensureUserServers.mockImplementation(async () => { pool.add('3', 'mcp_3_od', asClient(fresh)); });

        const r = await new ToolRouter().executeTool(TOOL, {}, USER);

        expect(r.isError).toBeFalsy();
        expect(ensureUserServers).toHaveBeenCalledWith('3', 'tool-call');
        expect(fresh.callTool).toHaveBeenCalledWith('list_projects', {});
    });

    it('풀에 남은 끊긴 client 는 호출하지 않고 빼낸 뒤 새 client 로 실행한다', async () => {
        const dead = fakeClient({ status: 'disconnected' });
        const fresh = fakeClient();
        pool.add('3', 'mcp_3_od', asClient(dead));
        ensureUserServers.mockImplementation(async () => { pool.add('3', 'mcp_3_od', asClient(fresh)); });

        const r = await new ToolRouter().executeTool(TOOL, {}, USER);

        expect(r.isError).toBeFalsy();
        expect(dead.callTool).not.toHaveBeenCalled();
        expect(dead.disconnect).toHaveBeenCalled();
        expect(fresh.callTool).toHaveBeenCalledTimes(1);
    });

    it('호출이 "Not connected" 로 실패하면 재기동 후 1회만 재시도한다', async () => {
        const stale = fakeClient({ result: { content: [{ type: 'text', text: '도구 실행 오류 (open-design::list_projects): Not connected' }], isError: true } });
        const fresh = fakeClient();
        pool.add('3', 'mcp_3_od', asClient(stale));
        ensureUserServers.mockImplementation(async () => { pool.add('3', 'mcp_3_od', asClient(fresh)); });

        const r = await new ToolRouter().executeTool(TOOL, {}, USER);

        expect(r.isError).toBeFalsy();
        expect(stale.callTool).toHaveBeenCalledTimes(1);
        expect(ensureUserServers).toHaveBeenCalledWith('3', 'tool-retry');
        expect(fresh.callTool).toHaveBeenCalledTimes(1);
    });

    it('재기동해도 서버가 없으면 not_found 로 끝난다 (무한 재시도 없음)', async () => {
        ensureUserServers.mockResolvedValue(undefined);

        const r = await new ToolRouter().executeTool(TOOL, {}, USER);

        expect(r.isError).toBe(true);
        expect(ensureUserServers).toHaveBeenCalledTimes(1);
    });
});
