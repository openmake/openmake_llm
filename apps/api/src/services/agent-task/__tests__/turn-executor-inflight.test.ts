/**
 * 실행 중 표식·결과 불명 처리 — 부작용 도구는 실행 직전 표식을 남기고 결과 스텝 뒤 지운다.
 * 재개 때 결과 불명으로 판정된 호출은 다시 실행하지 않고 안내를 도구 결과로 기록한다.
 */
const order: string[] = [];
const addAgentTaskStep = jest.fn(async () => { order.push('step'); });
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ addAgentTaskStep, updateAgentTask: async () => undefined }), getPool: () => ({}) }));
jest.mock('../../PushService', () => ({ getPushService: () => ({ sendPush: async () => undefined }) }));
jest.mock('../../task-sandbox/tools', () => ({ TASK_TERMINATE_SENTINEL: '__TERMINATE__' }));
jest.mock('../../task-sandbox/approval-gate', () => ({ requiresApproval: () => false, getApprovalRegistry: () => ({ request: jest.fn(), isAutoApprove: () => false }) }));
jest.mock('../../task-sandbox/planning', () => ({ currentPlanStepIndex: () => undefined }));
const runTool = jest.fn(async () => { order.push('run'); return '도구 결과'; });
jest.mock('../task-steps', () => ({ runTool: (...a: unknown[]) => runTool(...(a as [])), isSearchTool: () => false }));
jest.mock('../tool-args', () => ({ prepareToolArgs: (a: unknown) => a }));
jest.mock('../../tool-parallel', () => ({ prefetchReadOnlyCalls: async () => new Map() }));
jest.mock('../../../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../../../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({ runWithUserInputContext: (_c: unknown, fn: () => Promise<unknown>) => fn() }),
}));
const markToolCallInFlight = jest.fn(async (_taskId: string, id: string | null) => { order.push(id ? `mark:${id}` : 'clear'); });
jest.mock('../turn-reentry', () => ({
    writeTurnCheckpoint: async () => undefined,
    markToolCallInFlight: (...a: unknown[]) => markToolCallInFlight(...(a as [string, string | null])),
}));
jest.mock('../../../data/repositories/agent-task-repository', () => ({ AgentTaskRepository: jest.fn() }));

import { executeTurnToolCalls } from '../turn-executor';
import { getAgentTaskUnknownOutcomeNotice } from '../../../prompts/agent-task-prompt';
import type { ChatMessage } from '../../../llm/types';

function input(overrides: Record<string, unknown>) {
    const conversation: ChatMessage[] = [{ role: 'assistant', content: '', tool_calls: [] }];
    return {
        conversation,
        args: {
            toolCalls: [], taskRuntime: null, sandboxCfg: { approvalPolicy: 'none', approvalTimeoutMs: 1000 },
            extraToolNames: new Set<string>(), mcp: {}, userCtx: { userId: 'u1' }, userId: 'u1', taskId: 't1', turn: 2,
            conversation, usedTools: new Set<string>(), signal: new AbortController().signal,
            stepNumber: 5, searchCalls: 0, browserCalls: 0, pausedMs: 0, approvalTimeouts: 0,
            getCurStatus: () => 'running', update: jest.fn(async () => undefined), emitStep: jest.fn(), ...overrides,
        } as unknown as Parameters<typeof executeTurnToolCalls>[0],
    };
}

beforeEach(() => { jest.clearAllMocks(); order.length = 0; });

describe('executeTurnToolCalls — 실행 중 표식', () => {
    it('부작용 도구(외부 MCP)는 실행 전 표식 → 실행 → 스텝 기록 → 해제 순서', async () => {
        const { args } = input({ toolCalls: [{ id: 'c1', function: { name: 'od::create', arguments: {} } }] });
        await executeTurnToolCalls(args);
        expect(order).toEqual(['mark:c1', 'run', 'step', 'clear']);
    });

    it('읽기 전용 도구는 표식을 남기지 않는다', async () => {
        const { args } = input({ toolCalls: [{ id: 'c1', function: { name: 'mcp_read_resource', arguments: {} } }] });
        await executeTurnToolCalls(args);
        expect(order).toEqual(['run', 'step']);
    });

    it('task 도구는 runtime 의 onBeforeExecute 로 표식을 남긴다(승인 뒤)', async () => {
        const taskRuntime = {
            isTaskTool: () => true,
            executeTaskTool: jest.fn(async (_n: string, _a: unknown, opts: { onBeforeExecute?: () => Promise<void> }) => {
                await opts.onBeforeExecute?.();
                order.push('run');
                return 'ok';
            }),
            getPlanSnapshot: () => [], notifyApprovalPending: jest.fn(),
        };
        const { args } = input({ taskRuntime, toolCalls: [{ id: 'c1', function: { name: 'bash', arguments: { command: 'ls' } } }] });
        await executeTurnToolCalls(args);
        expect(order).toEqual(['mark:c1', 'run', 'step', 'clear']);
    });
});

describe('executeTurnToolCalls — 결과 불명 호출', () => {
    it('재개 때 결과 불명 호출은 실행하지 않고 안내를 결과로 기록한 뒤 표식을 지운다', async () => {
        const { args, conversation } = input({
            unknownOutcomeId: 'c1',
            toolCalls: [
                { id: 'c1', function: { name: 'od::create', arguments: {} } },
                { id: 'c2', function: { name: 'mcp_read_resource', arguments: {} } },
            ],
        });
        await executeTurnToolCalls(args);
        expect(runTool).toHaveBeenCalledTimes(1); // c2 만 실행
        const tools = conversation.filter((m) => m.role === 'tool');
        expect(tools[0]).toMatchObject({ tool_call_id: 'c1', content: getAgentTaskUnknownOutcomeNotice('od::create') });
        expect(tools[1]).toMatchObject({ tool_call_id: 'c2', content: '도구 결과' });
        expect(addAgentTaskStep).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: 'c1', content: getAgentTaskUnknownOutcomeNotice('od::create') }));
        expect(order).toEqual(['step', 'clear', 'run', 'step']);
    });
});
