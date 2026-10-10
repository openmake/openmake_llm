/**
 * 서버 종료 때의 실행 중 작업 정리(services/agent-task/shutdown-drain).
 *
 * 종료로 끊긴 작업은 사용자 취소(cancelled)가 아니라 부팅 복구가 집는 표식(failed + 'server restarted')으로 남고,
 * 소유권을 반납한 뒤에야 정리 대기가 끝난다. 종료가 시작된 뒤의 실행 요청은 시작하지 않는다.
 */
/** 밖에서 끝낼 수 있는 promise */
function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}

const toolCallTurn = (name = 'web_search') => ({
    role: 'assistant',
    content: '계속합니다',
    tool_calls: [{ type: 'function', id: 'c1', function: { name, arguments: { query: 'x' } } }],
    metrics: { prompt_tokens: 5, completion_tokens: 0 },
});
const mockChat = jest.fn(async () => toolCallTurn());
jest.mock('../llm', () => {
    const client: Record<string, unknown> = { chat: mockChat };
    client.derive = jest.fn(() => client);
    return { createClient: jest.fn(() => client) };
});
jest.mock('../config/model-roles', () => ({
    ...jest.requireActual('../config/model-roles'),
    getModelForRole: () => 'test-model',
}));
jest.mock('../utils/event-bus', () => ({ emitAgentTaskProgress: jest.fn() }));
const sendPush = jest.fn().mockResolvedValue(undefined);
jest.mock('../services/PushService', () => ({ getPushService: () => ({ sendPush }) }));

const updateAgentTask = jest.fn().mockResolvedValue(undefined);
const addAgentTaskStep = jest.fn().mockResolvedValue(undefined);
let rowStatus = 'pending';
jest.mock('../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({
        getAgentTask: jest.fn(async () => ({ id: 't1', status: rowStatus })),
        updateAgentTask,
        addAgentTaskStep,
        deleteAgentTaskSteps: jest.fn().mockResolvedValue(undefined),
    }),
}));
const executeTool = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: '결과' }] });
jest.mock('../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({
        listLLMTools: jest.fn().mockResolvedValue([
            { type: 'function', function: { name: 'web_search', description: '', parameters: {} } },
            { type: 'function', function: { name: 'send_report', description: '', parameters: {} } },
        ]),
        listTools: jest.fn().mockResolvedValue([]),
        executeTool,
        getUserToolGroups: () => [],
        normalizeToolCall: (name: string, args: Record<string, unknown>) => ({ name, args }),
        callUserServerTool: jest.fn().mockResolvedValue(null),
        runWithUserInputContext: (_c: unknown, fn: () => unknown) => fn(),
        ensureUserToolsForTask: jest.fn().mockResolvedValue(undefined),
        onUserLogin: jest.fn(), onUserLogout: jest.fn(), onChatStart: jest.fn(), onChatEnd: jest.fn(),
        onServerReady: jest.fn(), shutdown: jest.fn(),
    }),
}));
jest.mock('../runtime-ports/skill-runtime', () => ({
    ...jest.requireActual('../runtime-ports/skill-runtime'),
    getSkillRuntime: () => ({
        buildManifestPrompt: jest.fn().mockResolvedValue(null),
        getActiveSkillBindings: jest.fn().mockResolvedValue([]),
        getSkillsForAgent: jest.fn().mockResolvedValue([]),
        buildSkillPrompt: jest.fn().mockResolvedValue(''),
        buildSkillPromptForIds: jest.fn().mockResolvedValue(''),
        searchActiveSkills: jest.fn().mockResolvedValue([]),
        applyCatalogToTools: async (tools: unknown) => tools,
        recordUsage: () => { /* no-op */ },
        isOfferEnabled: () => false,
    }),
}));

process.env.TASK_SANDBOX_ENABLED = 'false';

const leaseEnd = jest.fn(async () => undefined);
const beginTaskLease = jest.fn(async () => ({ acquired: true, end: leaseEnd }));
jest.mock('../services/agent-task/task-lease', () => ({ beginTaskLease: () => beginTaskLease() }));
const closeTask = jest.fn();
const clearAutoApprove = jest.fn();
jest.mock('../services/task-sandbox/approval-gate', () => ({
    ...jest.requireActual('../services/task-sandbox/approval-gate'),
    getApprovalRegistry: () => ({ closeTask, clearAutoApprove, setAutoApprove: jest.fn(), isAutoApprove: () => false, autoApproves: () => false, request: jest.fn() }),
}));

import { AgentTaskService } from '../services/AgentTaskService';
import {
    drainAgentTasksForShutdown, beginAgentTaskShutdown, isAgentTaskShutdown, resetAgentTaskShutdownForTest,
} from '../services/agent-task/shutdown-drain';
import { cleanupTaskRun } from '../services/agent-task/run-cleanup';

type Update = { status?: string; error?: string | null; terminalNotifyPending?: boolean; totalTokens?: number };
const updates = (): Update[] => updateAgentTask.mock.calls.map(([, u]) => u as Update);
const statuses = (): Array<string | undefined> => updates().map((u) => u.status);
const waitFor = async (cond: () => boolean): Promise<void> => {
    for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setImmediate(r));
    if (!cond()) throw new Error('waitFor: 조건이 충족되지 않음');
};
const run = (maxTurns = 5): Promise<void> =>
    new AgentTaskService().execute({ taskId: 't1', userId: 'u1', goal: '작업', maxTurns } as never);

beforeEach(() => {
    jest.clearAllMocks();
    rowStatus = 'pending';
    mockChat.mockImplementation(async () => toolCallTurn());
    executeTool.mockResolvedValue({ content: [{ type: 'text', text: '결과' }] });
    resetAgentTaskShutdownForTest();
});

describe('종료 때 실행 중 작업 정리', () => {
    it('실행 중 작업을 멈추고 failed + server restarted 로 남긴다 — cancelled 가 아니다', async () => {
        const gate = deferred();
        mockChat.mockImplementationOnce(async () => { await gate.promise; return toolCallTurn(); });
        const done = run();
        await waitFor(() => mockChat.mock.calls.length === 1);

        const drained = drainAgentTasksForShutdown(5_000);
        gate.resolve(); // 중단 신호를 받은 LLM 호출이 돌아온다
        await expect(drained).resolves.toEqual({ aborted: 1, remaining: 0 });
        await done;

        expect(statuses()).not.toContain('cancelled');
        const last = updates().filter((u) => u.status).pop()!;
        expect(last).toMatchObject({ status: 'failed', error: 'server restarted', terminalNotifyPending: true, totalTokens: 5 });
        expect(mockChat).toHaveBeenCalledTimes(1); // 다음 턴으로 가지 않는다
        expect(sendPush).not.toHaveBeenCalled(); // 부팅 복구가 이어받을 작업 — 여기서 실패 알림을 보내지 않는다
    });

    it('정리 대기는 소유권 반납이 끝난 뒤에 풀린다', async () => {
        const gate = deferred();
        const leaseGate = deferred();
        mockChat.mockImplementationOnce(async () => { await gate.promise; return toolCallTurn(); });
        leaseEnd.mockImplementationOnce(async () => { await leaseGate.promise; });
        const done = run();
        await waitFor(() => mockChat.mock.calls.length === 1);

        let settled = false;
        const drained = drainAgentTasksForShutdown(5_000).then((r) => { settled = true; return r; });
        gate.resolve();
        await waitFor(() => leaseEnd.mock.calls.length === 1);
        expect(settled).toBe(false); // 서비스 레지스트리에서는 빠졌지만 종료 정리가 아직 돈다
        expect(AgentTaskService.isRunning('t1')).toBe(false);

        leaseGate.resolve();
        await expect(drained).resolves.toEqual({ aborted: 1, remaining: 0 });
        await done;
    });

    it('상한을 넘기면 끝나지 않은 작업을 두고 돌아온다', async () => {
        const gate = deferred();
        mockChat.mockImplementationOnce(async () => { await gate.promise; return toolCallTurn(); });
        const done = run();
        await waitFor(() => mockChat.mock.calls.length === 1);

        await expect(drainAgentTasksForShutdown(20)).resolves.toEqual({ aborted: 1, remaining: 1 });
        expect(statuses()).not.toContain('failed');

        gate.resolve();
        await done;
    });

    it('실행 중인 작업이 없으면 바로 끝난다', async () => {
        await expect(drainAgentTasksForShutdown(5_000)).resolves.toEqual({ aborted: 0, remaining: 0 });
        expect(isAgentTaskShutdown()).toBe(true);
    });

    it('종료로 끊긴 도구 호출의 결과는 저널에 남기지 않는다 — 재개 때 다시 판단한다', async () => {
        const toolGate = deferred();
        mockChat.mockImplementationOnce(async () => toolCallTurn('send_report'));
        executeTool.mockImplementationOnce(async () => { await toolGate.promise; return { content: [{ type: 'text', text: '중단됨' }] }; });
        const done = run();
        await waitFor(() => executeTool.mock.calls.length === 1);

        const drained = drainAgentTasksForShutdown(5_000);
        toolGate.resolve();
        await drained;
        await done;

        expect(addAgentTaskStep.mock.calls.map(([s]) => (s as { stepType: string }).stepType)).not.toContain('tool_result');
        expect(updates().filter((u) => u.status).pop()).toMatchObject({ status: 'failed', error: 'server restarted' });
    });
});

describe('종료 시작 뒤의 새 실행', () => {
    it('시작하지 않고, 잡아 둔 행(pending)을 부팅 복구가 집는 queued 로 돌려 둔다', async () => {
        beginAgentTaskShutdown();
        await run();
        expect(mockChat).not.toHaveBeenCalled();
        expect(beginTaskLease).not.toHaveBeenCalled();
        expect(updateAgentTask.mock.calls).toEqual([['t1', { status: 'queued' }]]);
        expect(AgentTaskService.isRunning('t1')).toBe(false);
    });

    it('이미 queued 인 행(큐 대기열에서 꺼낸 항목)은 건드리지 않는다', async () => {
        rowStatus = 'queued';
        beginAgentTaskShutdown();
        await run();
        expect(mockChat).not.toHaveBeenCalled();
        expect(updateAgentTask).not.toHaveBeenCalled();
    });
});

describe('사용자 취소 — 종전 동작 그대로', () => {
    it('cancel 은 cancelled + aborted 로 기록하고 승인을 닫는다', async () => {
        const gate = deferred();
        mockChat.mockImplementationOnce(async () => { await gate.promise; return toolCallTurn(); });
        const done = run();
        await waitFor(() => mockChat.mock.calls.length === 1);

        expect(AgentTaskService.cancel('t1')).toBe(true);
        gate.resolve();
        await done;

        const last = updates().filter((u) => u.status).pop()!;
        expect(last).toMatchObject({ status: 'cancelled', error: 'aborted' });
        expect(statuses()).not.toContain('failed');
        expect(closeTask).toHaveBeenCalledWith('t1');
        expect(leaseEnd).toHaveBeenCalledTimes(1);
    });

    it('먼저 취소된 작업은 뒤이은 종료 신호에도 cancelled 로 남는다', async () => {
        const gate = deferred();
        mockChat.mockImplementationOnce(async () => { await gate.promise; return toolCallTurn(); });
        const done = run();
        await waitFor(() => mockChat.mock.calls.length === 1);

        AgentTaskService.cancel('t1');
        const drained = drainAgentTasksForShutdown(5_000);
        gate.resolve();
        await drained;
        await done;

        expect(updates().filter((u) => u.status).pop()).toMatchObject({ status: 'cancelled', error: 'aborted' });
    });
});

describe('종료 정리(run-cleanup) — 종료로 끊긴 실행', () => {
    const runtime = (): { cleanup: jest.Mock } => ({ cleanup: jest.fn().mockResolvedValue(undefined) });

    it('작업 공간과 대기 중 승인을 남긴다(부팅 복구가 이어받는다) — 컨테이너만 내린다', async () => {
        const rt = runtime();
        await cleanupTaskRun({ taskId: 't1', taskRuntime: rt as never, status: 'running', parked: false, stepNumber: 0, interrupted: true });
        expect(rt.cleanup).toHaveBeenCalledWith(false);
        expect(closeTask).not.toHaveBeenCalled();
        expect(clearAutoApprove).toHaveBeenCalledWith('t1');
    });

    it('그 밖의 실패·취소는 종전대로 승인을 닫는다', async () => {
        await cleanupTaskRun({ taskId: 't1', taskRuntime: null, status: 'cancelled', parked: false, stepNumber: 0 });
        expect(closeTask).toHaveBeenCalledWith('t1');
    });
});
