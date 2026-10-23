/**
 * 샌드박스 OFF(legacy) 호스트 도구의 승인 경계(#1469) — 실행 위치와 무관하게 같은 ApprovalRegistry 를 거친다.
 * 승인 대기 → 승인 시 1회 실행, 거절·만료·중단은 실행 0회, 정책 none 바닥은 자동승인이 있어도 즉시 거절.
 * 읽기 선실행(prefetch)도 같은 게이트를 거치고 두 번 실행되지 않는다.
 */
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ addAgentTaskStep: async () => undefined, updateAgentTask: async () => undefined }), getPool: () => ({}) }));
jest.mock('../../PushService', () => ({ getPushService: () => ({ sendPush: async () => undefined }) }));
jest.mock('../../task-sandbox/tools', () => ({ TASK_TERMINATE_SENTINEL: '__TERMINATE__' }));
jest.mock('../../task-sandbox/planning', () => ({ currentPlanStepIndex: () => undefined }));
jest.mock('../../../security/security-audit', () => ({ auditSecurityEvent: jest.fn(async () => undefined) }));
let registry: import('../../task-sandbox/approval-gate').ApprovalRegistry;
jest.mock('../../task-sandbox/approval-gate', () => {
    const actual = jest.requireActual('../../task-sandbox/approval-gate');
    return { ...actual, getApprovalRegistry: () => registry };
});
const runTool = jest.fn(async (..._a: unknown[]): Promise<string> => '도구 결과');
jest.mock('../task-steps', () => ({ runTool: (...a: unknown[]) => runTool(...a), isSearchTool: () => false }));
jest.mock('../tool-args', () => ({ prepareToolArgs: (a: unknown) => a }));
jest.mock('../../../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../../../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({ runWithUserInputContext: (_c: unknown, fn: () => Promise<unknown>) => fn() }),
}));
jest.mock('../turn-reentry', () => ({ writeTurnCheckpoint: async () => undefined, markToolCallInFlight: async () => undefined }));
jest.mock('../tool-receipt', () => ({ ...jest.requireActual('../tool-receipt'), startReceipt: async () => 'k', finishReceipt: async () => undefined }));
jest.mock('../../../data/repositories/agent-task-repository', () => ({ AgentTaskRepository: jest.fn(() => ({ markParked: async () => undefined })) }));
jest.mock('../../../runtime-ports/skill-runtime', () => ({
    LOAD_SKILL_TOOL_NAME: 'load_skill',
    getSkillRuntime: () => ({ applyCatalogToTools: async (tools: unknown[]) => tools }),
}));

import { executeTurnToolCalls } from '../turn-executor';
import { assembleAgentTools } from '../tool-assembly';
import { ApprovalRegistry } from '../../task-sandbox/approval-gate';
import { getApprovalRejectedNotice } from '../../../prompts/agent-task-approval';
import type { ChatMessage, ToolDefinition } from '../../../llm/types';
import type { TaskSandboxApprovalPolicy, TaskSandboxConfig } from '../../../config/task-sandbox';

const tool = (name: string): ToolDefinition => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } }) as ToolDefinition;
const catalog = [tool('web_search'), tool('srv::create_item'), tool('srv::search_docs'), tool('mcp_call'), tool('ask_human')];
const legacyCfg = (approvalPolicy: TaskSandboxApprovalPolicy, approvalTimeoutMs = 60_000) =>
    ({ enabled: false, extraTools: [], internalOnly: false, approvalPolicy, approvalTimeoutMs }) as unknown as TaskSandboxConfig;

async function legacyInput(policy: TaskSandboxApprovalPolicy, calls: Array<{ id: string; name: string; args?: Record<string, unknown> }>, overrides: Record<string, unknown> = {}) {
    const sandboxCfg = legacyCfg(policy, (overrides.approvalTimeoutMs as number | undefined) ?? 60_000);
    const { extraToolNames } = await assembleAgentTools({ mcpTools: catalog, taskRuntime: null, sandboxCfg, goal: 'g' });
    const conversation: ChatMessage[] = [{ role: 'assistant', content: '', tool_calls: [] }];
    return {
        conversation,
        args: {
            toolCalls: calls.map((c) => ({ id: c.id, function: { name: c.name, arguments: c.args ?? {} } })),
            taskRuntime: null, sandboxCfg, extraToolNames, mcp: {}, userCtx: { userId: 'u1' }, userId: 'u1', taskId: 't1', turn: 1,
            conversation, usedTools: new Set<string>(), signal: new AbortController().signal,
            stepNumber: 1, searchCalls: 0, browserCalls: 0, pausedMs: 0, approvalTimeouts: 0,
            getCurStatus: () => 'running', update: jest.fn(async () => undefined), emitStep: jest.fn(), ...overrides,
        } as unknown as Parameters<typeof executeTurnToolCalls>[0],
    };
}

const toolResults = (conversation: ChatMessage[]) => conversation.filter((m) => m.role === 'tool').map((m) => m.content);
/** 새 승인 대기가 등록될 때까지 기다린다(최대 2초) — exclude 의 id 는 이미 본 대기라 건너뛴다. */
const waitForPending = async (exclude: ReadonlySet<string> = new Set()): Promise<Awaited<ReturnType<ApprovalRegistry['list']>>> => {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
        const p = (await registry.list('u1')).filter((x) => !exclude.has(x.approvalId));
        if (p.length > 0) return p;
        await new Promise((r) => setTimeout(r, 5));
    }
    return [];
};

beforeEach(() => { jest.clearAllMocks(); registry = new ApprovalRegistry(); });

describe('assembleAgentTools — legacy OFF 호스트 실행 집합', () => {
    it('샌드박스 OFF 는 모델에 보이는 모든 도구를 호스트 실행 도구로 표시한다', async () => {
        const r = await assembleAgentTools({ mcpTools: catalog, taskRuntime: null, sandboxCfg: legacyCfg('high-risk'), goal: 'g' });
        expect([...r.extraToolNames].sort()).toEqual(r.tools.map((t) => t.function.name).sort());
    });
});

describe('executeTurnToolCalls — legacy OFF 승인 경계', () => {
    it('high-risk: 외부 MCP 도구는 실행 전 승인을 기다리고, 승인하면 한 번 실행한다', async () => {
        const { args, conversation } = await legacyInput('high-risk', [{ id: 'c1', name: 'srv::create_item', args: { title: 'x' } }]);
        const done = executeTurnToolCalls(args);
        const pending = await waitForPending();
        expect(pending.map((p) => p.toolName)).toEqual(['srv::create_item']);
        expect(runTool).not.toHaveBeenCalled();
        await registry.approve(pending[0].approvalId, 'u1');
        await done;
        expect(runTool).toHaveBeenCalledTimes(1);
        expect(toolResults(conversation)).toEqual(['도구 결과']);
    });

    it('high-risk: 거절하면 실행하지 않고 거절 안내를 결과로 남긴다', async () => {
        const { args, conversation } = await legacyInput('high-risk', [{ id: 'c1', name: 'srv::create_item' }]);
        const done = executeTurnToolCalls(args);
        const pending = await waitForPending();
        await registry.reject(pending[0].approvalId, 'u1');
        await done;
        expect(runTool).not.toHaveBeenCalled();
        expect(toolResults(conversation)).toEqual([getApprovalRejectedNotice('srv::create_item', 'user', undefined)]);
    });

    it('high-risk: 무응답 만료는 실행 0회이고 만료 횟수를 센다', async () => {
        const { args } = await legacyInput('high-risk', [{ id: 'c1', name: 'srv::create_item' }], { approvalTimeoutMs: 20 });
        const out = await executeTurnToolCalls(args);
        expect(runTool).not.toHaveBeenCalled();
        expect(out.approvalTimeouts).toBe(1);
    });

    it('high-risk: 대기 중 중단되면 실행하지 않는다', async () => {
        const ac = new AbortController();
        const { args } = await legacyInput('high-risk', [{ id: 'c1', name: 'srv::create_item' }], { signal: ac.signal });
        const done = executeTurnToolCalls(args).catch((e: unknown) => e);
        await waitForPending();
        ac.abort();
        await done;
        expect(runTool).not.toHaveBeenCalled();
    });

    it('none: 바닥 호출(외부 MCP·mcp_call)은 자동승인이 켜져 있어도 묻지 않고 즉시 거절한다', async () => {
        registry.setAutoApprove('t1', true);
        const { args, conversation } = await legacyInput('none', [{ id: 'c1', name: 'srv::create_item' }, { id: 'c2', name: 'mcp_call', args: { server: 's', tool: 't' } }]);
        await executeTurnToolCalls(args);
        expect(runTool).not.toHaveBeenCalled();
        expect(await registry.list('u1')).toEqual([]);
        expect(toolResults(conversation)).toEqual([
            getApprovalRejectedNotice('srv::create_item', 'policy_floor', undefined),
            getApprovalRejectedNotice('mcp_call', 'policy_floor', undefined),
        ]);
    });

    it('none: 읽기 선실행 후보인 외부 MCP 조회도 바닥 거절된다(선실행이 게이트를 비켜 가지 않는다)', async () => {
        registry.setAutoApprove('t1', true);
        const { args } = await legacyInput('none', [{ id: 'c1', name: 'srv::search_docs', args: { q: 'a' } }, { id: 'c2', name: 'srv::search_docs', args: { q: 'b' } }]);
        await executeTurnToolCalls(args);
        expect(runTool).not.toHaveBeenCalled();
    });

    it('all + 자동승인: 읽기 선실행(병렬)은 같은 레지스트리를 거친 뒤 실행하고 호출마다 한 번만 실행한다', async () => {
        registry.setAutoApprove('t1', true);
        const events: string[] = [];
        const realRequest = registry.request.bind(registry);
        const request = jest.spyOn(registry, 'request').mockImplementation(async (req, opts) => {
            events.push(`request:${String(req.args.query)}`);
            return realRequest(req, opts);
        });
        // 두 호출이 모두 실행에 들어올 때까지 결과를 잡아 둔다 — 순차 실행이면 두 번째가 들어오지 못해 동시 진입이 1 에 머문다.
        let inFlight = 0; let maxInFlight = 0;
        let releaseAll!: () => void;
        const bothEntered = new Promise<void>((r) => { releaseAll = r; });
        runTool.mockImplementation(async (...a: unknown[]) => {
            events.push(`run:${String((a[2] as Record<string, unknown>).query)}`);
            inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
            if (inFlight === 2) releaseAll();
            await Promise.race([bothEntered, new Promise((r) => setTimeout(r, 200))]);
            inFlight--;
            return '도구 결과';
        });
        const { args, conversation } = await legacyInput('all', [{ id: 'c1', name: 'web_search', args: { query: 'a' } }, { id: 'c2', name: 'web_search', args: { query: 'b' } }]);
        await executeTurnToolCalls(args);
        expect(maxInFlight).toBe(2); // 선실행 경로로 병렬 실행됐다
        expect(runTool).toHaveBeenCalledTimes(2);
        expect(request).toHaveBeenCalledTimes(2);
        // 각 호출의 실행은 그 호출의 레지스트리 통과 뒤다(선실행이 게이트를 건너뛰지 않는다)
        for (const q of ['a', 'b']) expect(events.indexOf(`request:${q}`)).toBeLessThan(events.indexOf(`run:${q}`));
        expect(toolResults(conversation)).toEqual(['도구 결과', '도구 결과']);
    });

    it('all(자동승인 없음): 승인이 필요한 읽기 호출은 선실행하지 않고 순차로 승인을 기다린다', async () => {
        const ac = new AbortController();
        const { args } = await legacyInput('all', [{ id: 'c1', name: 'web_search', args: { query: 'a' } }, { id: 'c2', name: 'web_search', args: { query: 'b' } }], { signal: ac.signal });
        const done = executeTurnToolCalls(args).catch((e: unknown) => e);
        try {
            const first = await waitForPending();
            expect(first).toHaveLength(1); // 동시에 두 승인 창이 뜨지 않는다
            expect(runTool).not.toHaveBeenCalled();
            await registry.approve(first[0].approvalId, 'u1');
            const second = await waitForPending(new Set([first[0].approvalId]));
            expect(second).toHaveLength(1);
            expect(runTool).toHaveBeenCalledTimes(1);
            await registry.approve(second[0].approvalId, 'u1');
            await done;
            expect(runTool).toHaveBeenCalledTimes(2);
        } finally {
            ac.abort(); // 실패해도 남은 대기가 다음 테스트로 새지 않게
            await done;
        }
    });

    it('none: 바닥이 아닌 도구(web_search)와 제어 도구는 묻지 않고 종전대로 실행한다', async () => {
        const { args } = await legacyInput('none', [{ id: 'c1', name: 'web_search', args: { query: 'a' } }]);
        await executeTurnToolCalls(args);
        expect(runTool).toHaveBeenCalledTimes(1);
        const ctl = await legacyInput('all', [{ id: 'c2', name: 'ask_human', args: { question: 'q' } }]);
        await executeTurnToolCalls(ctl.args);
        expect(runTool).toHaveBeenCalledTimes(2);
        expect(await registry.list('u1')).toEqual([]);
    });
});

describe('executeTurnToolCalls — 노출 목록 밖 호스트 호출', () => {
    it('샌드박스 ON 이라도 집합 밖 외부 MCP 호출은 게이트를 거친다(none → 즉시 거절)', async () => {
        const taskRuntime = { isTaskTool: (n: string) => n === 'bash', getPlanSnapshot: () => [], executeTaskTool: jest.fn() };
        const { args } = await legacyInput('none', [{ id: 'c1', name: 'srv::create_item' }], { taskRuntime, extraToolNames: new Set<string>(['web_search']) });
        await executeTurnToolCalls(args);
        expect(runTool).not.toHaveBeenCalled();
        expect(taskRuntime.executeTaskTool).not.toHaveBeenCalled();
    });
});
