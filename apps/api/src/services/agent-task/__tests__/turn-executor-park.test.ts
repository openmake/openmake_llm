/**
 * 턴 도구 실행 중 주차(F16.7) — ask_human(task 도구)·mcp_elicit(외부 도구) 모두 체크포인트(completedTurn = turn-1) +
 * paused + 주차 표식 후 AgentTaskParked 를 던지고, 질문 호출의 결과는 대화·스텝에 남기지 않는다.
 */
const addAgentTaskStep = jest.fn(async () => undefined);
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ addAgentTaskStep, updateAgentTask: async () => undefined }), getPool: () => ({}) }));
jest.mock('../../PushService', () => ({ getPushService: () => ({ sendPush: async () => undefined }) }));
jest.mock('../../task-sandbox/tools', () => ({ TASK_TERMINATE_SENTINEL: '__TERMINATE__' }));
const request = jest.fn();
const requiresApproval = jest.fn((..._a: unknown[]) => false);
jest.mock('../../task-sandbox/approval-gate', () => ({ requiresApproval: (...a: unknown[]) => requiresApproval(...a), getApprovalRegistry: () => ({ request, isAutoApprove: () => false }) }));
jest.mock('../../task-sandbox/planning', () => ({ currentPlanStepIndex: () => undefined }));
const runTool = jest.fn();
jest.mock('../task-steps', () => ({ runTool: (...a: unknown[]) => runTool(...a), isSearchTool: () => false }));
jest.mock('../tool-args', () => ({ prepareToolArgs: (a: unknown) => a }));
// 병렬 선실행은 기본으로 끈다 — mcp_elicit 제외 회귀만 실제 구현을 쓴다
let realPrefetch = false;
jest.mock('../../tool-parallel', () => {
    const actual = jest.requireActual('../../tool-parallel');
    return { ...actual, prefetchReadOnlyCalls: (...a: unknown[]) => (realPrefetch ? actual.prefetchReadOnlyCalls(...a) : Promise.resolve(new Map())) };
});
// 도구가 사용자에게 묻는 문맥(구 MCP elicitation)은 이제 도구 런타임 포트가 연다 — 그 문맥을 낚아챈다.
let elicitCtx: { ask(args: Record<string, unknown>): Promise<unknown> } | undefined;
jest.mock('../../../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../../../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({
        runWithUserInputContext: (ctx: typeof elicitCtx, fn: () => Promise<unknown>) => { elicitCtx = ctx; return fn(); },
    }),
}));
const writeTurnCheckpoint = jest.fn(async () => undefined);
const markToolCallInFlight = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../turn-reentry', () => ({ writeTurnCheckpoint: (...a: unknown[]) => writeTurnCheckpoint(...(a as [])), markToolCallInFlight: (...a: unknown[]) => markToolCallInFlight(...a) }));
const markParked = jest.fn(async () => undefined);
jest.mock('../../../data/repositories/agent-task-repository', () => ({ AgentTaskRepository: jest.fn().mockImplementation(() => ({ markParked })) }));

import { executeTurnToolCalls } from '../turn-executor';
import { AgentTaskParked } from '../types';
import type { ChatMessage } from '../../../llm/types';

function input(overrides: Record<string, unknown>) {
    const conversation: ChatMessage[] = [{ role: 'assistant', content: '', tool_calls: [] }];
    const update = jest.fn(async () => undefined);
    return {
        conversation, update,
        args: {
            toolCalls: [], taskRuntime: null, sandboxCfg: { approvalPolicy: 'none', approvalTimeoutMs: 1000 },
            extraToolNames: new Set<string>(), mcp: {}, userCtx: { userId: 'u1' }, userId: 'u1', taskId: 't1', turn: 4,
            conversation, usedTools: new Set<string>(), signal: new AbortController().signal,
            stepNumber: 10, searchCalls: 0, browserCalls: 0, pausedMs: 0, approvalTimeouts: 0,
            getCurStatus: () => 'paused', update, emitStep: jest.fn(), ...overrides,
        } as unknown as Parameters<typeof executeTurnToolCalls>[0],
    };
}

beforeEach(() => { jest.clearAllMocks(); elicitCtx = undefined; realPrefetch = false; });

describe('executeTurnToolCalls — 주차', () => {
    it('ask_human(task 도구)이 주차되면 이미 끝난 호출은 남기고 질문 호출 앞에서 체크포인트·주차', async () => {
        const taskRuntime = {
            isTaskTool: () => true,
            executeTaskTool: jest.fn(async (name: string) => {
                if (name === 'ask_human') throw new AgentTaskParked();
                return 'ls 결과';
            }),
            getPlanSnapshot: () => [],
            notifyApprovalPending: jest.fn(),
        };
        const { args, conversation, update } = input({
            taskRuntime,
            toolCalls: [
                { id: 'c1', function: { name: 'bash', arguments: { command: 'ls' } } },
                { id: 'c2', function: { name: 'ask_human', arguments: { question: 'q' } } },
            ],
        });
        await expect(executeTurnToolCalls(args)).rejects.toBeInstanceOf(AgentTaskParked);
        expect(conversation.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual(['c1']);
        expect(addAgentTaskStep).toHaveBeenCalledTimes(1);
        expect(writeTurnCheckpoint).toHaveBeenCalledWith('t1', conversation, 3, taskRuntime);
        expect(update).toHaveBeenCalledWith({ status: 'paused' });
        expect(markParked).toHaveBeenCalledWith('t1');
    });

    it('mcp_elicit 이 주차되면 서버 응답(cancel)을 기록하지 않고 주차한다', async () => {
        request.mockResolvedValue({ decision: 'rejected', reason: 'parked', waitedMs: 7 });
        runTool.mockImplementation(async () => {
            await elicitCtx!.ask({ server: 'od', question: '이름?' });
            return 'Error: user cancelled';
        });
        const { args, conversation, update } = input({
            toolCalls: [{ id: 'c1', function: { name: 'od::create', arguments: {} } }],
        });
        await expect(executeTurnToolCalls(args)).rejects.toBeInstanceOf(AgentTaskParked);
        expect(request).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'mcp_elicit' }), expect.any(Object));
        expect(conversation.some((m) => m.role === 'tool')).toBe(false);
        expect(addAgentTaskStep).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalledWith({ status: 'running' });
        expect(markParked).toHaveBeenCalledWith('t1');
        // 실행 직전 남긴 표식은 주차 전에 지운다 — 재개 때 결과 불명이 아니라 다시 실행돼야 한다
        expect(markToolCallInFlight.mock.calls).toEqual([['t1', 'c1'], ['t1', null]]);
    });

    it('승인 필요 extra 도구가 주차되면 실행하지 않고 체크포인트·주차한다', async () => {
        requiresApproval.mockReturnValue(true);
        request.mockResolvedValue({ decision: 'rejected', reason: 'parked', waitedMs: 5 });
        const { args, conversation, update } = input({
            extraToolNames: new Set(['web_fetch']),
            toolCalls: [{ id: 'c1', function: { name: 'web_fetch', arguments: { url: 'https://x' } } }],
        });
        await expect(executeTurnToolCalls(args)).rejects.toBeInstanceOf(AgentTaskParked);
        expect(request).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'web_fetch' }), expect.objectContaining({ parkable: true }));
        expect(runTool).not.toHaveBeenCalled();
        expect(conversation.some((m) => m.role === 'tool')).toBe(false);
        expect(update).toHaveBeenCalledWith({ status: 'paused' });
        expect(markParked).toHaveBeenCalledWith('t1');
        requiresApproval.mockReturnValue(false);
    });

    it('주차 표식 기록이 실패하면 AgentTaskParked 대신 그 오류가 올라간다(표식 없는 paused 방지)', async () => {
        markParked.mockRejectedValueOnce(new Error('db down'));
        const taskRuntime = { isTaskTool: () => true, executeTaskTool: async () => { throw new AgentTaskParked(); }, getPlanSnapshot: () => [], notifyApprovalPending: jest.fn() };
        const { args } = input({ taskRuntime, toolCalls: [{ id: 'c1', function: { name: 'ask_human', arguments: {} } }] });
        await expect(executeTurnToolCalls(args)).rejects.toThrow('db down');
    });
});

/** 실제 승인 레지스트리(가짜 저장소·가짜 slots)로 위임 — 자리 없음 분기·mcp_elicit 제외를 턴 실행과 함께 본다. */
function realRegistry(room: boolean) {
    const { ApprovalRegistry } = jest.requireActual('../../task-sandbox/approval-gate') as typeof import('../../task-sandbox/approval-gate');
    const store = {
        insertPending: jest.fn(async () => undefined), markDecided: jest.fn(async (..._a: unknown[]): Promise<boolean> => true),
        listPending: jest.fn(async () => []), getPending: jest.fn(async () => undefined), takeoverForCall: jest.fn(async () => undefined),
        expirePendingForTask: jest.fn(async () => undefined), extendPending: jest.fn(async () => true),
    };
    const slots = { yieldSlot: jest.fn(), tryReclaimSlot: jest.fn(() => room), forceReclaimSlot: jest.fn(), resumeAfterRelease: jest.fn() };
    const reg = new ApprovalRegistry(store, slots);
    request.mockImplementation((i: Parameters<typeof reg.request>[0], o: Parameters<typeof reg.request>[1]) => reg.request(i, o));
    const cards: string[] = [];
    const waitCards = async (n: number) => {
        for (let i = 0; i < 50 && cards.length < n; i++) {
            await new Promise((r) => setImmediate(r));
            for (const p of await reg.list('u1')) if (!cards.includes(p.approvalId)) cards.push(p.approvalId);
        }
        expect(cards.length).toBeGreaterThanOrEqual(n);
        return cards;
    };
    return { reg, store, slots, waitCards };
}
function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

describe('executeTurnToolCalls — 승인 대기 슬롯 양보(호스트 도구)', () => {
    afterEach(() => { requiresApproval.mockReturnValue(false); request.mockReset(); });
    const hostCall = { id: 'c1', function: { name: 'od::create_item', arguments: { title: 'x' } } };
    const allPolicy = { sandboxCfg: { approvalPolicy: 'all', approvalTimeoutMs: 60_000 } };

    it('결정 때 자리가 없으면 parked — 도구 실행 0회·실행 중 표식 0회·체크포인트·AgentTaskParked', async () => {
        requiresApproval.mockReturnValue(true);
        const r = realRegistry(false);
        const { args, conversation } = input({ ...allPolicy, toolCalls: [hostCall] });
        const run = executeTurnToolCalls(args);
        const [id] = await r.waitCards(1);
        await r.reg.approve(id);
        await expect(run).rejects.toBeInstanceOf(AgentTaskParked);
        expect(r.slots.yieldSlot).toHaveBeenCalledWith('t1');
        expect(r.store.markDecided).toHaveBeenCalledWith(id, 'approved', undefined, undefined, false);
        expect(r.slots.resumeAfterRelease).toHaveBeenCalledWith('t1');
        expect(runTool).not.toHaveBeenCalled();
        expect(markToolCallInFlight).not.toHaveBeenCalledWith('t1', 'c1');
        expect(writeTurnCheckpoint).toHaveBeenCalledWith('t1', conversation, 3, null);
        expect(markParked).toHaveBeenCalledWith('t1');
    });

    it.each([
        ['예외', (d: ReturnType<typeof deferred<boolean>>) => d.reject(new Error('db down'))],
        ['false', (d: ReturnType<typeof deferred<boolean>>) => d.resolve(false)],
    ] as const)('저장 대기 → 중단 → 저장 실패(%s) → 도구 실행 0회·실행 중 표식 0회', async (_n, fail) => {
        requiresApproval.mockReturnValue(true);
        const r = realRegistry(false);
        const save = deferred<boolean>();
        r.store.markDecided.mockReturnValueOnce(save.promise);
        const ac = new AbortController();
        const { args } = input({ ...allPolicy, toolCalls: [hostCall], signal: ac.signal });
        const run = executeTurnToolCalls(args).catch((e: unknown) => e);
        const [id] = await r.waitCards(1);
        await r.reg.approve(id);
        ac.abort();
        fail(save);
        await run;
        expect(runTool).not.toHaveBeenCalled();
        expect(markToolCallInFlight).not.toHaveBeenCalledWith('t1', 'c1');
        expect(r.slots.forceReclaimSlot).not.toHaveBeenCalled();
    });

    it('대조군: 중단 없이 저장 실패 → 상한을 넘겨 그 자리에서 실행(도구 1회)', async () => {
        requiresApproval.mockReturnValue(true);
        runTool.mockResolvedValue('ok');
        const r = realRegistry(false);
        r.store.markDecided.mockRejectedValueOnce(new Error('db down'));
        const { args } = input({ ...allPolicy, toolCalls: [hostCall] });
        const run = executeTurnToolCalls(args).catch((e: unknown) => e);
        const [id] = await r.waitCards(1);
        await r.reg.approve(id);
        await run;
        expect(r.slots.forceReclaimSlot).toHaveBeenCalledTimes(1);
        expect(runTool).toHaveBeenCalledTimes(1);
        expect(markToolCallInFlight).toHaveBeenCalledWith('t1', 'c1');
    });
});

describe('executeTurnToolCalls — mcp_elicit 은 슬롯을 양보하지 않는다', () => {
    afterEach(() => { request.mockReset(); });

    it('읽기 전용 외부 도구 2건이 동시에 입력을 요청해도 yieldSlot·tryReclaimSlot 0회, parkDeferred 로 요청', async () => {
        realPrefetch = true;
        const r = realRegistry(false);
        runTool.mockImplementation(async () => {
            const a = await elicitCtx!.ask({ server: 'od', question: '어느 쪽?' }) as { decision: string; text?: string };
            return `답: ${a.text ?? a.decision}`;
        });
        const { args } = input({
            toolCalls: [
                { id: 'c1', function: { name: 'od::search_a', arguments: {} } },
                { id: 'c2', function: { name: 'od::search_b', arguments: {} } },
            ],
        });
        const run = executeTurnToolCalls(args);
        const [first, second] = await r.waitCards(2);
        expect(request).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'mcp_elicit' }), expect.objectContaining({ parkable: true, parkDeferred: true }));
        await r.reg.answer(first, '왼쪽');
        await new Promise((res) => setImmediate(res));
        expect(r.slots.yieldSlot).not.toHaveBeenCalled();
        expect(r.slots.tryReclaimSlot).not.toHaveBeenCalled();
        await r.reg.answer(second, '오른쪽');
        await run;
        expect(runTool).toHaveBeenCalledTimes(2);
        expect(r.slots.yieldSlot).not.toHaveBeenCalled();
        expect(r.slots.tryReclaimSlot).not.toHaveBeenCalled();
        expect(r.store.markDecided).toHaveBeenCalledWith(first, 'approved', '왼쪽', undefined, true);
    });
});
