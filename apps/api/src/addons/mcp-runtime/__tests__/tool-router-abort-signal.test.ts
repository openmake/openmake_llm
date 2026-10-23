/**
 * 중단 신호 전달(2026-10-22 R4) — 중간 단계 회귀 가드.
 *
 * opts 가 모든 단계에서 선택 인자라, 리팩터링 중 한 단계에서 빠져도 타입 오류 없이 조용히 기능이 꺼진다.
 * mcpToolRuntime.executeTool → UnifiedMCPClient.executeToolWithContext → ToolRouter.executeTool →
 * (사용자 풀 client.callTool | server-registry 가 등록한 전역 실행기 → ExternalMCPClient.callTool) 까지
 * 같은 signal 이 닿는지 단계별로 고정한다.
 */
import { UserMCPPool } from '../user-pool';
import type { ExternalMCPClient } from '../external-client';
import type { MCPServerConfig } from '../../../tool-contract/types';

const pool = new UserMCPPool();
const globalClients: FakeGlobalClient[] = [];
class FakeGlobalClient {
    constructor(_cfg: unknown) { globalClients.push(this); }
    on = jest.fn();
    connect = jest.fn(async () => undefined);
    getTools = () => [{ name: 'echo', description: '', inputSchema: { type: 'object', properties: {} } }];
    callTool = jest.fn(async (..._a: unknown[]) => ({ content: [{ type: 'text', text: 'ok' }] }));
    disconnect = jest.fn(async () => undefined);
}

jest.mock('../user-pool', () => ({ ...jest.requireActual('../user-pool'), getUserMCPPool: () => pool }));
jest.mock('../lifecycle-supervisor', () => ({ getLifecycleSupervisor: () => ({ ensureUserServers: jest.fn() }) }));
jest.mock('../external-client', () => ({ ...jest.requireActual('../external-client'), ExternalMCPClient: FakeGlobalClient }));

import { ToolRouter } from '../tool-router';
import { MCPServerRegistry } from '../server-registry';
import { mcpToolRuntime } from '../runtime';
import { getUnifiedMCPClient } from '../index';

const USER = { userId: '3', role: 'user' as const };

function fakePoolClient() {
    return {
        getStatus: () => ({ serverId: 'mcp_3_od', serverName: 'open-design', status: 'connected', toolCount: 1 }),
        getTools: () => [{ name: 'list_projects', description: '', inputSchema: { type: 'object', properties: {} } }],
        getConfig: () => ({ id: 'mcp_3_od', name: 'open-design', transport_type: 'stdio' }),
        callTool: jest.fn(async (..._a: unknown[]) => ({ content: [{ type: 'text', text: 'ok' }] })),
        disconnect: jest.fn(async () => undefined),
    };
}

beforeEach(async () => {
    await pool.closeAll();
    globalClients.length = 0;
});

describe('ToolRouter — 중단 신호 전달', () => {
    // 라우터는 상위 신호와 마감을 묶은 신호를 넘긴다(#1472) — 동일 객체가 아니라 "상위 중단이 하위 신호에 닿는가"를 본다.
    it('사용자 풀 경로: client.callTool 이 받은 신호는 상위 중단을 따른다', async () => {
        const client = fakePoolClient();
        pool.add('3', 'mcp_3_od', client as unknown as ExternalMCPClient);
        const ac = new AbortController();

        const r = await new ToolRouter().executeTool('open-design::list_projects', {}, USER, { signal: ac.signal });

        expect(r.isError).toBeFalsy();
        expect(client.callTool).toHaveBeenCalledWith('list_projects', {}, { signal: expect.any(AbortSignal) });
        const passed = (client.callTool.mock.calls[0][2] as { signal: AbortSignal }).signal;
        expect(passed.aborted).toBe(false);
        ac.abort();
        expect(passed.aborted).toBe(true);
    });

    it('전역 경로: server-registry 가 등록한 실행기가 opts 를 ExternalMCPClient.callTool 까지 넘긴다', async () => {
        const router = new ToolRouter();
        const registry = new MCPServerRegistry(router);
        await registry.connectServer('srv1', { id: 'srv1', name: 'g', transport_type: 'stdio', command: 'node', args: [] } as unknown as MCPServerConfig);
        expect(globalClients).toHaveLength(1);
        const ac = new AbortController();

        const r = await router.executeTool('g::echo', {}, undefined, { signal: ac.signal });

        expect(r.isError).toBeFalsy();
        expect(globalClients[0].callTool).toHaveBeenCalledWith('echo', {}, { signal: expect.any(AbortSignal) });
        const passed = (globalClients[0].callTool.mock.calls[0][2] as { signal: AbortSignal }).signal;
        ac.abort();
        expect(passed.aborted).toBe(true);
    });

    it('전역 경로: opts 가 없어도 마감 신호를 넘긴다(타임아웃이 하위 호출을 끊는다) — 중단되지 않은 상태로', async () => {
        const router = new ToolRouter();
        const registry = new MCPServerRegistry(router);
        await registry.connectServer('srv1', { id: 'srv1', name: 'g', transport_type: 'stdio', command: 'node', args: [] } as unknown as MCPServerConfig);

        const r = await router.executeTool('g::echo', {}, undefined);

        expect(r.isError).toBeFalsy();
        const [name, args, opts] = globalClients[0].callTool.mock.calls[0] as [string, unknown, { signal: AbortSignal }];
        expect([name, args]).toEqual(['echo', {}]);
        expect(opts.signal.aborted).toBe(false);
    });
});

describe('mcpToolRuntime / UnifiedMCPClient — 중단 신호 전달', () => {
    afterEach(() => jest.restoreAllMocks());

    it('mcpToolRuntime.executeTool 은 opts 를 executeToolWithContext 로 넘긴다', async () => {
        const spy = jest.spyOn(getUnifiedMCPClient(), 'executeToolWithContext').mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
        const ac = new AbortController();

        await mcpToolRuntime.executeTool('srv::echo', {}, USER, { signal: ac.signal });

        expect(spy).toHaveBeenCalledWith('srv::echo', {}, USER, { signal: ac.signal });
    });

    it('executeToolWithContext 는 opts 를 ToolRouter.executeTool 로 넘긴다', async () => {
        const unified = getUnifiedMCPClient();
        const spy = jest.spyOn(unified.getToolRouter(), 'executeTool').mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
        const ac = new AbortController();

        await unified.executeToolWithContext('srv::echo', {}, USER, { signal: ac.signal });

        expect(spy).toHaveBeenCalledWith('srv::echo', {}, expect.objectContaining({ userId: '3' }), { signal: ac.signal });
    });
});
