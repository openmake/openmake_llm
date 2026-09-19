/**
 * 턴 도구 실행 중 주차(F16.7) — ask_human(task 도구)·mcp_elicit(외부 도구) 모두 체크포인트(completedTurn = turn-1) +
 * paused + 주차 표식 후 AgentTaskParked 를 던지고, 질문 호출의 결과는 대화·스텝에 남기지 않는다.
 */
const addAgentTaskStep = jest.fn(async () => undefined);
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ addAgentTaskStep, updateAgentTask: async () => undefined }), getPool: () => ({}) }));
jest.mock('../../PushService', () => ({ getPushService: () => ({ sendPush: async () => undefined }) }));
jest.mock('../../task-sandbox/tools', () => ({ TASK_TERMINATE_SENTINEL: '__TERMINATE__' }));
const request = jest.fn();
jest.mock('../../task-sandbox/approval-gate', () => ({ requiresApproval: () => false, getApprovalRegistry: () => ({ request, isAutoApprove: () => false }) }));
jest.mock('../../task-sandbox/planning', () => ({ currentPlanStepIndex: () => undefined }));
const runTool = jest.fn();
jest.mock('../task-steps', () => ({ runTool: (...a: unknown[]) => runTool(...a), isSearchTool: () => false }));
jest.mock('../tool-args', () => ({ prepareToolArgs: (a: unknown) => a }));
jest.mock('../../tool-parallel', () => ({ prefetchReadOnlyCalls: async () => new Map() }));
// 도구가 사용자에게 묻는 문맥(구 MCP elicitation)은 이제 도구 런타임 포트가 연다 — 그 문맥을 낚아챈다.
let elicitCtx: { ask(args: Record<string, unknown>): Promise<unknown> } | undefined;
jest.mock('../../../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../../../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({
        runWithUserInputContext: (ctx: typeof elicitCtx, fn: () => Promise<unknown>) => { elicitCtx = ctx; return fn(); },
    }),
}));
const writeTurnCheckpoint = jest.fn(async () => undefined);
jest.mock('../turn-reentry', () => ({ writeTurnCheckpoint: (...a: unknown[]) => writeTurnCheckpoint(...(a as [])) }));
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

beforeEach(() => { jest.clearAllMocks(); elicitCtx = undefined; });

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
    });

    it('주차 표식 기록이 실패하면 AgentTaskParked 대신 그 오류가 올라간다(표식 없는 paused 방지)', async () => {
        markParked.mockRejectedValueOnce(new Error('db down'));
        const taskRuntime = { isTaskTool: () => true, executeTaskTool: async () => { throw new AgentTaskParked(); }, getPlanSnapshot: () => [], notifyApprovalPending: jest.fn() };
        const { args } = input({ taskRuntime, toolCalls: [{ id: 'c1', function: { name: 'ask_human', arguments: {} } }] });
        await expect(executeTurnToolCalls(args)).rejects.toThrow('db down');
    });
});
