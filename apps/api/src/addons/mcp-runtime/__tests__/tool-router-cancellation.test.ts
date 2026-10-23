/**
 * 취소와 장애 구분·타이머 소유(#1472) — 사용자/상위 중단은 서킷의 실패도 성공도 아니고, 진짜 타임아웃은 장애다.
 *
 * 계약:
 *  ① 이미 중단된 신호면 외부 호출을 시작하지 않는다(부작용 0) — 결과 분류는 'aborted'.
 *  ② 진행 중 중단된 호출은 몇 번이 반복돼도 서킷 실패·호출 수에 들어가지 않는다(서킷이 열리지 않는다).
 *  ③ 실제 오류·타임아웃은 종전처럼 실패로 센다.
 *  ④ 타임아웃이 나면 하위 호출이 받은 신호도 중단된다(관찰자만 끝나고 부작용이 계속 도는 일이 없다).
 *  ⑤ 성공·실패·중단·타임아웃 어느 경로든 타이머와 abort 리스너가 남지 않는다.
 */
import { getEventListeners } from 'events';
import { TOOL_CIRCUIT } from '../../../config/tool-health';
import { MCP_EXTERNAL_TOOL_LIMITS } from '../../../config/timeouts';
import { ToolRouter } from '../tool-router';
import { UserMCPPool } from '../user-pool';
import type { ExternalMCPClient } from '../external-client';
import { getCircuitSnapshot, __resetCircuitsForTest } from '../../../tool-contract/tool-health';
import type { MCPToolResult } from '../../../tool-contract/types';

const pool = new UserMCPPool();
jest.mock('../user-pool', () => ({ ...jest.requireActual('../user-pool'), getUserMCPPool: () => pool }));
jest.mock('../lifecycle-supervisor', () => ({ getLifecycleSupervisor: () => ({ ensureUserServers: jest.fn() }) }));

const mutable = TOOL_CIRCUIT as unknown as Record<string, unknown>;
const original = { ...TOOL_CIRCUIT };
const OK: MCPToolResult = { content: [{ type: 'text', text: 'ok' }] };

type Exec = (name: string, args: Record<string, unknown>, opts?: { signal?: AbortSignal }) => Promise<MCPToolResult>;

/** 받은 신호가 중단되면 거부하는 외부 실행기 — SDK callTool 이 중단에 반응하는 모양 */
const abortAware: Exec = (_n, _a, opts) => new Promise((_, reject) => {
    if (opts?.signal?.aborted) { reject(new Error('This operation was aborted')); return; }
    opts?.signal?.addEventListener('abort', () => reject(new Error('This operation was aborted')), { once: true });
});

/** 실행기가 불린 **뒤** 상위 신호를 끊는다 — 진행 중 중단을 결정적으로 재현한다. */
const abortWhileRunning = (ac: AbortController, inner: Exec = abortAware): Exec => (n, a, opts) => {
    const p = inner(n, a, opts);
    ac.abort();
    return p;
};

function routerWith(exec: Exec): ToolRouter {
    const router = new ToolRouter();
    router.registerExternalTools('srv-1', 'srv', [{ name: 'flaky', description: 't', inputSchema: { type: 'object', properties: {} } }], exec);
    return router;
}

/** setTimeout·setInterval 만 가짜로 — nextTick·microtask 까지 세면 타이머 수가 의미를 잃는다 */
const fakeTimers = (): void => { jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }); };

const textOf = (r: MCPToolResult): string => r.content.map((c) => ('text' in c ? c.text : '')).join('');

beforeEach(async () => {
    __resetCircuitsForTest();
    Object.assign(mutable, original, { ENABLED: true, FAILURE_THRESHOLD: 3, MIN_CALLS: 3, OPEN_MS: 60000 });
    await pool.closeAll();
});
afterEach(() => {
    Object.assign(mutable, original);
    jest.useRealTimers();
});

describe('ToolRouter — 취소는 장애가 아니다(#1472)', () => {
    it('이미 중단된 신호면 외부 실행기를 부르지 않고 aborted 로 돌려준다', async () => {
        const exec = jest.fn(async () => OK);
        const ac = new AbortController();
        ac.abort();

        const r = await routerWith(exec as Exec).executeTool('srv::flaky', {}, undefined, { signal: ac.signal });

        expect(exec).not.toHaveBeenCalled();
        expect(r.isError).toBe(true);
        expect(r.errorCategory).toBe('aborted');
        expect(getCircuitSnapshot()).toHaveLength(0);
    });

    it('진행 중 중단이 반복돼도 서킷이 열리지 않고 노출이 유지된다', async () => {
        let ac = new AbortController();
        const exec = jest.fn((n: string, a: Record<string, unknown>, opts?: { signal?: AbortSignal }) => abortWhileRunning(ac)(n, a, opts));
        const router = routerWith(exec);
        for (let i = 0; i < 6; i++) {
            ac = new AbortController();
            const r = await router.executeTool('srv::flaky', {}, undefined, { signal: ac.signal });
            expect(r.errorCategory).toBe('aborted');
        }
        expect(exec).toHaveBeenCalledTimes(6);
        expect(getCircuitSnapshot()).toHaveLength(0);
        expect((await router.getAllTools()).some((t) => t.name === 'srv::flaky')).toBe(true);
    });

    it('중단은 성공으로도 세지 않는다 — 기존 실패 이력을 지우거나 호출 수를 늘리지 않는다', async () => {
        let fail = true;
        const ac = new AbortController();
        const router = routerWith(async (n, a, opts) => {
            if (fail) throw new Error('upstream 502 bad gateway');
            return abortWhileRunning(ac)(n, a, opts);
        });
        await router.executeTool('srv::flaky', {});
        const before = getCircuitSnapshot()[0];
        expect(before).toMatchObject({ failuresInWindow: 1, callsInWindow: 1 });

        fail = false;
        await router.executeTool('srv::flaky', {}, undefined, { signal: ac.signal });

        expect(getCircuitSnapshot()[0]).toMatchObject({ failuresInWindow: 1, callsInWindow: 1, state: 'closed' });
    });

    it('신호가 살아 있는 실제 오류는 종전처럼 실패로 센다(중단 문구가 섞여도)', async () => {
        const router = routerWith(async () => ({ content: [{ type: 'text' as const, text: 'This operation was aborted by upstream' }], isError: true }));
        const ac = new AbortController();
        for (let i = 0; i < 3; i++) await router.executeTool('srv::flaky', {}, undefined, { signal: ac.signal });
        expect(getCircuitSnapshot()[0]).toMatchObject({ failuresInWindow: 3, state: 'open' });
    });
});

describe('ToolRouter — 타임아웃은 장애이고 하위 호출도 끊는다(#1472)', () => {
    it('전역 경로: 타임아웃이면 실패로 세고, 실행기가 받은 신호가 중단된다', async () => {
        fakeTimers();
        let childSignal: AbortSignal | undefined;
        const router = routerWith((n, a, opts) => { childSignal = opts?.signal; return abortAware(n, a, opts); });

        const pending = router.executeTool('srv::flaky', {});
        await jest.advanceTimersByTimeAsync(MCP_EXTERNAL_TOOL_LIMITS.EXECUTION_TIMEOUT_MS + 1);
        const r = await pending;

        expect(r.errorCategory).toBe('timeout');
        expect(childSignal?.aborted).toBe(true);
        expect(getCircuitSnapshot()[0]).toMatchObject({ failuresInWindow: 1, lastCategory: 'timeout' });
        expect(jest.getTimerCount()).toBe(0);
    });

    it('사용자 풀 경로: 타임아웃이면 client.callTool 이 받은 신호가 중단되고 타이머가 남지 않는다', async () => {
        fakeTimers();
        let childSignal: AbortSignal | undefined;
        const client = {
            getStatus: () => ({ serverId: 'mcp_3_od', serverName: 'open-design', status: 'connected', toolCount: 1 }),
            getTools: () => [{ name: 'list_projects', description: '', inputSchema: { type: 'object', properties: {} } }],
            getConfig: () => ({ id: 'mcp_3_od', name: 'open-design', transport_type: 'stdio' }),
            isAwaitingInput: () => false,
            callTool: jest.fn((n: string, a: Record<string, unknown>, opts?: { signal?: AbortSignal }) => { childSignal = opts?.signal; return abortAware(n, a, opts); }),
            disconnect: jest.fn(async () => undefined),
        };
        pool.add('3', 'mcp_3_od', client as unknown as ExternalMCPClient);

        const pending = new ToolRouter().executeTool('open-design::list_projects', {}, { userId: '3', role: 'user' });
        await jest.advanceTimersByTimeAsync(MCP_EXTERNAL_TOOL_LIMITS.EXECUTION_TIMEOUT_MS + 1);
        const r = await pending;

        expect(r.errorCategory).toBe('timeout');
        expect(childSignal?.aborted).toBe(true);
        expect(jest.getTimerCount()).toBe(0);
    });
});

describe('ToolRouter — 모든 경로에서 타이머·리스너 정리(#1472)', () => {
    it.each([
        ['성공', (async () => OK) as Exec, false],
        ['실패', (async () => { throw new Error('upstream 502 bad gateway'); }) as Exec, false],
        ['중단', abortAware, true],
    ])('전역 경로 %s 뒤 타이머 0·abort 리스너 0', async (_label, exec, abortMidway) => {
        fakeTimers();
        const ac = new AbortController();
        const r = await routerWith(abortMidway ? abortWhileRunning(ac, exec) : exec).executeTool('srv::flaky', {}, undefined, { signal: ac.signal });
        expect(r.errorCategory).toBe(abortMidway ? 'aborted' : r.errorCategory);
        expect(jest.getTimerCount()).toBe(0);
        expect(getEventListeners(ac.signal, 'abort')).toHaveLength(0);
    });

    it('사용자 풀 경로 성공 뒤 타이머 0', async () => {
        fakeTimers();
        const client = {
            getStatus: () => ({ serverId: 'mcp_3_od', serverName: 'open-design', status: 'connected', toolCount: 1 }),
            getTools: () => [{ name: 'list_projects', description: '', inputSchema: { type: 'object', properties: {} } }],
            getConfig: () => ({ id: 'mcp_3_od', name: 'open-design', transport_type: 'stdio' }),
            callTool: jest.fn(async () => OK),
            disconnect: jest.fn(async () => undefined),
        };
        pool.add('3', 'mcp_3_od', client as unknown as ExternalMCPClient);
        const r = await new ToolRouter().executeTool('open-design::list_projects', {}, { userId: '3', role: 'user' });
        expect(textOf(r)).toBe('ok');
        expect(jest.getTimerCount()).toBe(0);
    });
});
