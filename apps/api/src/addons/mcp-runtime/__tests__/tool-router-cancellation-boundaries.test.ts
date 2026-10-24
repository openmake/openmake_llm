/**
 * 취소 경계(#1472 리뷰 보정) — 대기(await)가 끝날 때마다 호출자 중단을 다시 본다.
 *
 *  ① post 훅을 기다리는 동안 중단되면 성공 결과여도 aborted — 서킷 이력(호출·성공·실패)이 그대로다.
 *  ② pre 훅을 기다리는 동안 중단되면 외부 실행기를 부르지 않는다.
 *  ③ 사용자 풀 복구(풀 보장 대기) 중 중단되면 첫 호출도, 연결 끊김 뒤 재시도도 부르지 않는다.
 * 대기는 테스트가 쥔 deferred 로 고정한다(타이밍 의존 없음).
 */
import { TOOL_CIRCUIT } from '../../../config/tool-health';
import { ToolRouter } from '../tool-router';
import { UserMCPPool } from '../user-pool';
import type { ExternalMCPClient } from '../external-client';
import { getCircuitSnapshot, __resetCircuitsForTest } from '../../../tool-contract/tool-health';
import { __resetToolHooksForTest, registerToolHook } from '../../../tool-contract/tool-hooks';
import type { MCPToolResult } from '../../../tool-contract/types';

const pool = new UserMCPPool();
const ensureUserServers = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../user-pool', () => ({ ...jest.requireActual('../user-pool'), getUserMCPPool: () => pool }));
jest.mock('../lifecycle-supervisor', () => ({ getLifecycleSupervisor: () => ({ ensureUserServers: (...a: unknown[]) => ensureUserServers(...a) }) }));

const mutable = TOOL_CIRCUIT as unknown as Record<string, unknown>;
const original = { ...TOOL_CIRCUIT };
const OK: MCPToolResult = { content: [{ type: 'text', text: 'ok' }] };
const USER = { userId: '3', role: 'user' as const };

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
}

/** 대기 지점에 닿았음을 알리는 신호 — 그 뒤에 중단한다 */
function reached(): { wait: Promise<void>; hit: () => void } {
    let hit!: () => void;
    const wait = new Promise<void>((r) => { hit = r; });
    return { wait, hit };
}

beforeEach(async () => {
    __resetCircuitsForTest();
    __resetToolHooksForTest();
    Object.assign(mutable, original, { ENABLED: true, FAILURE_THRESHOLD: 3, MIN_CALLS: 3, OPEN_MS: 60000 });
    ensureUserServers.mockReset().mockResolvedValue(undefined);
    await pool.closeAll();
});
afterEach(() => { Object.assign(mutable, original); __resetToolHooksForTest(); });

describe('전역 경로 — 훅 대기 중 중단', () => {
    it('post 훅 대기 중 중단: 성공 결과여도 aborted, 서킷 이력은 그대로', async () => {
        let fail = true;
        const router = new ToolRouter();
        router.registerExternalTools('s', 'srv', [{ name: 't', description: '', inputSchema: { type: 'object', properties: {} } }], async () => {
            if (fail) throw new Error('upstream 502 bad gateway');
            return OK;
        });
        await router.executeTool('srv::t', {});
        expect(getCircuitSnapshot()[0]).toMatchObject({ failuresInWindow: 1, callsInWindow: 1 });

        fail = false;
        const gate = deferred();
        const at = reached();
        registerToolHook({ id: 'slow-post', post: async (r) => { at.hit(); await gate.promise; return r; } });
        const ac = new AbortController();
        const pending = router.executeTool('srv::t', {}, undefined, { signal: ac.signal });
        await at.wait;
        ac.abort();
        gate.resolve();
        const r = await pending;

        expect(r.errorCategory).toBe('aborted');
        expect(getCircuitSnapshot()[0]).toMatchObject({ failuresInWindow: 1, callsInWindow: 1, state: 'closed' });
    });

    it('post 훅 대기 중 중단: 오류 결과도 실패로 세지 않는다', async () => {
        const router = new ToolRouter();
        router.registerExternalTools('s', 'srv', [{ name: 't', description: '', inputSchema: { type: 'object', properties: {} } }],
            async () => ({ content: [{ type: 'text', text: 'upstream 502' }], isError: true }));
        const gate = deferred();
        const at = reached();
        registerToolHook({ id: 'slow-post', post: async (r) => { at.hit(); await gate.promise; return r; } });
        const ac = new AbortController();
        const pending = router.executeTool('srv::t', {}, undefined, { signal: ac.signal });
        await at.wait;
        ac.abort();
        gate.resolve();
        expect((await pending).errorCategory).toBe('aborted');
        expect(getCircuitSnapshot()).toHaveLength(0);
    });

    it('pre 훅 대기 중 중단: 외부 실행기를 부르지 않는다', async () => {
        const exec = jest.fn(async () => OK);
        const router = new ToolRouter();
        router.registerExternalTools('s', 'srv', [{ name: 't', description: '', inputSchema: { type: 'object', properties: {} } }], exec);
        const gate = deferred();
        const at = reached();
        registerToolHook({ id: 'slow-pre', pre: async () => { at.hit(); await gate.promise; } });
        const ac = new AbortController();
        const pending = router.executeTool('srv::t', {}, undefined, { signal: ac.signal });
        await at.wait;
        ac.abort();
        gate.resolve();
        const r = await pending;
        expect(exec).not.toHaveBeenCalled();
        expect(r.errorCategory).toBe('aborted');
        expect(getCircuitSnapshot()).toHaveLength(0);
    });
});

describe('사용자 풀 경로 — 복구 대기 중 중단', () => {
    const client = (status: string, callTool: jest.Mock) => ({
        getStatus: () => ({ serverId: 'mcp_3_od', serverName: 'open-design', status, toolCount: 1 }),
        getTools: () => [{ name: 'list_projects', description: '', inputSchema: { type: 'object', properties: {} } }],
        getConfig: () => ({ id: 'mcp_3_od', name: 'open-design', transport_type: 'stdio' }),
        callTool,
        disconnect: jest.fn(async () => undefined),
    });

    it('끊긴 서버를 풀 보장으로 되살리는 동안 중단되면 새 client 를 부르지 않는다', async () => {
        const deadCall = jest.fn(async () => OK);
        pool.add('3', 'mcp_3_od', client('error', deadCall) as unknown as ExternalMCPClient);
        const freshCall = jest.fn(async () => OK);
        const gate = deferred();
        const at = reached();
        ensureUserServers.mockImplementation(async () => {
            at.hit();
            await gate.promise;
            pool.add('3', 'mcp_3_od', client('connected', freshCall) as unknown as ExternalMCPClient);
        });
        const ac = new AbortController();
        const pending = new ToolRouter().executeTool('open-design::list_projects', {}, USER, { signal: ac.signal });
        await at.wait;
        ac.abort();
        gate.resolve();
        const r = await pending;
        expect(deadCall).not.toHaveBeenCalled();
        expect(freshCall).not.toHaveBeenCalled();
        expect(r.errorCategory).toBe('aborted');
    });

    it('연결 끊김 재시도 준비(풀 보장) 중 중단되면 재시도를 부르지 않는다', async () => {
        const first = jest.fn(async () => ({ content: [{ type: 'text', text: 'Not connected' }], isError: true }));
        pool.add('3', 'mcp_3_od', client('connected', first) as unknown as ExternalMCPClient);
        const retryCall = jest.fn(async () => OK);
        const gate = deferred();
        const at = reached();
        ensureUserServers.mockImplementation(async () => {
            at.hit();
            await gate.promise;
            pool.add('3', 'mcp_3_od', client('connected', retryCall) as unknown as ExternalMCPClient);
        });
        const ac = new AbortController();
        const pending = new ToolRouter().executeTool('open-design::list_projects', {}, USER, { signal: ac.signal });
        await at.wait;
        ac.abort();
        gate.resolve();
        const r = await pending;
        expect(first).toHaveBeenCalledTimes(1);
        expect(retryCall).not.toHaveBeenCalled();
        expect(r.errorCategory).toBe('aborted');
    });

    it('중단이 없으면 종전대로 재시도한다(회귀)', async () => {
        const first = jest.fn(async () => ({ content: [{ type: 'text', text: 'Not connected' }], isError: true }));
        pool.add('3', 'mcp_3_od', client('connected', first) as unknown as ExternalMCPClient);
        const retryCall = jest.fn(async () => OK);
        ensureUserServers.mockImplementation(async () => { pool.add('3', 'mcp_3_od', client('connected', retryCall) as unknown as ExternalMCPClient); });
        const r = await new ToolRouter().executeTool('open-design::list_projects', {}, USER, { signal: new AbortController().signal });
        expect(retryCall).toHaveBeenCalledTimes(1);
        expect(r.isError).toBeFalsy();
    });
});
