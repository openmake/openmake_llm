/**
 * 한 턴의 도구 호출 가드 — 인자 JSON 이 깨진 호출은 실행하지 않는다.
 */
const steps: Array<{ content: string; toolCallId?: string }> = [];
jest.mock('../../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ addAgentTaskStep: async (s: { content: string }) => { steps.push(s); }, updateAgentTask: async () => undefined }),
    getPool: () => ({}),
}));
jest.mock('../../PushService', () => ({ getPushService: () => ({ sendPush: async () => undefined }) }));
jest.mock('../../task-sandbox/tools', () => ({ TASK_TERMINATE_SENTINEL: '__TERMINATE__' }));
jest.mock('../../task-sandbox/approval-gate', () => ({ requiresApproval: () => false, getApprovalRegistry: () => ({ isAutoApprove: () => false }) }));
jest.mock('../../task-sandbox/planning', () => ({ currentPlanStepIndex: () => undefined }));
const runTool = jest.fn(async (_mcp: unknown, name: string, args: Record<string, unknown>): Promise<string> => `${name} 결과 ${JSON.stringify(args)}`);
jest.mock('../task-steps', () => ({ runTool: (...a: unknown[]) => runTool(...(a as [unknown, string, Record<string, unknown>])), isSearchTool: (n: string) => n.includes('search') }));
jest.mock('../tool-args', () => ({ prepareToolArgs: (a: unknown) => a }));
const prefetched: string[][] = [];
jest.mock('../../tool-parallel', () => ({
    prefetchReadOnlyCalls: async (calls: Array<{ id?: string }>) => { prefetched.push(calls.map((c) => String(c.id))); return new Map(); },
}));
jest.mock('../../../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../../../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({ runWithUserInputContext: (_c: unknown, fn: () => Promise<unknown>) => fn() }),
}));
jest.mock('../turn-reentry', () => ({ writeTurnCheckpoint: async () => undefined, markToolCallInFlight: async () => undefined }));
jest.mock('../../../data/repositories/agent-task-repository', () => ({ AgentTaskRepository: jest.fn(() => ({})) }));
jest.mock('../../../config/runtime-limits', () => {
    const actual = jest.requireActual('../../../config/runtime-limits');
    return { ...actual, AGENT_TASK_LIMITS: { ...actual.AGENT_TASK_LIMITS, TOOL_LOOP_GUARD_ENABLED: true, REENTRY_UNKNOWN_OUTCOME_ENABLED: false, MIDTURN_CHECKPOINT_ENABLED: false, TOOL_RESULT_WRAP_ENABLED: false } };
});

import { executeTurnToolCalls } from '../turn-executor';
import { AGENT_TASK_TURN_LOOP } from '../../../config/agent-task-turn-loop';
import type { ChatMessage, ToolCall } from '../../../llm/types';

const call = (id: string, name: string, args: Record<string, unknown>, extra: Partial<ToolCall> = {}): ToolCall =>
    ({ id, type: 'function', function: { name, arguments: args }, ...extra });

async function run(toolCalls: ToolCall[]) {
    const conversation: ChatMessage[] = [{ role: 'user', content: 'g' }, { role: 'assistant', content: '', tool_calls: toolCalls }];
    const usedTools = new Set<string>();
    const out = await executeTurnToolCalls({
        toolCalls, taskRuntime: null, sandboxCfg: { approvalPolicy: 'none', approvalTimeoutMs: 1000 },
        extraToolNames: new Set<string>(), mcp: {}, userCtx: { userId: 'u1' }, userId: 'u1', taskId: 't1', turn: 2,
        conversation, usedTools, signal: new AbortController().signal,
        stepNumber: 5, searchCalls: 0, browserCalls: 0, pausedMs: 0, approvalTimeouts: 0,
        getCurStatus: () => 'running', update: jest.fn(async () => undefined), emitStep: jest.fn(),
    } as unknown as Parameters<typeof executeTurnToolCalls>[0]);
    const results = conversation.filter((m) => m.role === 'tool').map((m) => ({ id: m.tool_call_id, content: String(m.content) }));
    return { out, results, usedTools };
}

const cfg = AGENT_TASK_TURN_LOOP as Record<string, unknown>;
beforeEach(() => { jest.clearAllMocks(); steps.length = 0; prefetched.length = 0; });

describe('executeTurnToolCalls — 인자 JSON 이 깨진 호출', () => {
    it('빈 인자로 실행하지 않고 오류 결과를 돌려준다(횟수·사용 도구에도 세지 않는다)', async () => {
        const { out, results, usedTools } = await run([call('a', 'web_search', {}, { argumentsInvalid: true })]);
        expect(runTool).not.toHaveBeenCalled();
        expect(results).toEqual([{ id: 'a', content: expect.stringContaining('올바른 JSON 이 아니') }]);
        expect(results[0].content.startsWith('Error:')).toBe(true);
        expect(steps[0]).toMatchObject({ toolCallId: 'a', content: expect.stringContaining('올바른 JSON 이 아니') });
        expect(out.searchCalls).toBe(0);
        expect(usedTools.size).toBe(0);
        expect(prefetched[0]).toEqual([]);
    });

    it('같은 응답의 정상 호출은 그대로 실행한다', async () => {
        const { results } = await run([call('a', 'bash', {}, { argumentsInvalid: true }), call('b', 'web_search', { query: 'x' })]);
        expect(runTool).toHaveBeenCalledTimes(1);
        expect(results.map((r) => r.id)).toEqual(['a', 'b']);
        expect(results[1].content).toContain('web_search 결과');
    });

    it('끄면 종전대로 빈 인자로 실행한다', async () => {
        cfg.REJECT_MALFORMED_TOOL_ARGS = false;
        try {
            await run([call('a', 'web_search', {}, { argumentsInvalid: true })]);
            expect(runTool).toHaveBeenCalledTimes(1);
        } finally { cfg.REJECT_MALFORMED_TOOL_ARGS = true; }
    });
});
