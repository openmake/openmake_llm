/**
 * 반복 가드의 실행 루프 연결 — 같은 호출이 연속 실패하면 결과에 안내가 붙고, 임계를 넘으면 실행하지 않는다.
 */
const steps: Array<{ content: string }> = [];
jest.mock('../../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ addAgentTaskStep: async (s: { content: string }) => { steps.push(s); }, updateAgentTask: async () => undefined }),
    getPool: () => ({}),
}));
jest.mock('../../PushService', () => ({ getPushService: () => ({ sendPush: async () => undefined }) }));
jest.mock('../../task-sandbox/tools', () => ({ TASK_TERMINATE_SENTINEL: '__TERMINATE__' }));
jest.mock('../../task-sandbox/approval-gate', () => ({ requiresApproval: () => false, getApprovalRegistry: () => ({ isAutoApprove: () => false }) }));
jest.mock('../../task-sandbox/planning', () => ({ currentPlanStepIndex: () => undefined }));
const runTool = jest.fn(async (): Promise<string> => 'Error: 404 not found');
jest.mock('../task-steps', () => ({ runTool: (...a: unknown[]) => runTool(...(a as [])), isSearchTool: () => false }));
jest.mock('../tool-args', () => ({ prepareToolArgs: (a: unknown) => a }));
jest.mock('../../tool-parallel', () => ({ ...jest.requireActual('../../tool-parallel'), prefetchReadOnlyCalls: async () => new Map() }));
jest.mock('../../../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../../../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({ runWithUserInputContext: (_c: unknown, fn: () => Promise<unknown>) => fn() }),
}));
jest.mock('../turn-reentry', () => ({ writeTurnCheckpoint: async () => undefined, markToolCallInFlight: async () => undefined }));
jest.mock('../../../data/repositories/agent-task-repository', () => ({ AgentTaskRepository: jest.fn(() => ({})) }));
// 임계값·플래그는 .env 에 좌우되므로 고정한다.
jest.mock('../../../config/runtime-limits', () => {
    const actual = jest.requireActual('../../../config/runtime-limits');
    return { ...actual, AGENT_TASK_LIMITS: { ...actual.AGENT_TASK_LIMITS, TOOL_LOOP_GUARD_ENABLED: true, TOOL_LOOP_WARN_FAILURES: 2, TOOL_LOOP_BLOCK_FAILURES: 4, TOOL_LOOP_WARN_SAME_RESULT: 3, TOOL_LOOP_BLOCK_SAME_RESULT: 5, REENTRY_UNKNOWN_OUTCOME_ENABLED: false, MIDTURN_CHECKPOINT_ENABLED: false } };
});

import { executeTurnToolCalls } from '../turn-executor';
import type { ChatMessage } from '../../../llm/types';

const ARGS = { url: 'https://example.com/missing' };
/** 같은 호출이 n번 연속 실패한 대화 + 이번 턴의 같은 호출(결과 없음). */
function run(priorFailures: number) {
    const conversation: ChatMessage[] = [{ role: 'user', content: 'g' }];
    for (let i = 0; i < priorFailures; i++) {
        conversation.push({ role: 'assistant', content: '', tool_calls: [{ id: `p${i}`, type: 'function', function: { name: 'web_fetch', arguments: ARGS } }] });
        conversation.push({ role: 'tool', content: 'Error: 404 not found', tool_name: 'web_fetch', tool_call_id: `p${i}` });
    }
    const toolCalls = [{ id: 'now', type: 'function' as const, function: { name: 'web_fetch', arguments: ARGS } }];
    conversation.push({ role: 'assistant', content: '', tool_calls: toolCalls });
    return executeTurnToolCalls({
        toolCalls, taskRuntime: null, sandboxCfg: { approvalPolicy: 'none', approvalTimeoutMs: 1000 },
        extraToolNames: new Set<string>(), mcp: {}, userCtx: { userId: 'u1' }, userId: 'u1', taskId: 't1', turn: 2,
        conversation, usedTools: new Set<string>(), signal: new AbortController().signal,
        stepNumber: 5, searchCalls: 0, browserCalls: 0, pausedMs: 0, approvalTimeouts: 0,
        getCurStatus: () => 'running', update: jest.fn(async () => undefined), emitStep: jest.fn(),
    } as unknown as Parameters<typeof executeTurnToolCalls>[0]).then(() => String(conversation[conversation.length - 1].content));
}

beforeEach(() => { jest.clearAllMocks(); steps.length = 0; });

describe('executeTurnToolCalls — 반복 가드', () => {
    it('처음 실패는 그대로 돌려준다', async () => {
        expect(await run(0)).toBe('Error: 404 not found');
        expect(runTool).toHaveBeenCalledTimes(1);
    });

    it('같은 호출이 두 번째로 실패하면 결과 뒤에 안내가 붙고, 스텝에도 남는다', async () => {
        const out = await run(1);
        expect(out).toContain('Error: 404 not found');
        expect(out).toContain('[반복 안내]');
        expect(out).toContain('2번');
        expect(steps[0].content).toContain('[반복 안내]');
        expect(runTool).toHaveBeenCalledTimes(1);
    });

    it('네 번 연속 실패한 뒤의 같은 호출은 실행하지 않는다', async () => {
        const out = await run(4);
        expect(runTool).not.toHaveBeenCalled();
        expect(out).toContain('실행하지 않았습니다');
        expect(steps[0].content).toContain('실행하지 않았습니다');
    });
});
