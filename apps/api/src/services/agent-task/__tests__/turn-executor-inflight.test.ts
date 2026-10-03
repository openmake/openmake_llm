/**
 * 실행 중 표식·결과 불명 처리 — 부작용 도구는 실행 직전 표식을 남기고 결과 스텝 뒤 지운다.
 * 재개 때 결과 불명으로 판정된 호출은 다시 실행하지 않고 안내를 도구 결과로 기록한다.
 */
const order: string[] = [];
const addAgentTaskStep = jest.fn(async () => { order.push('step'); });
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ addAgentTaskStep, updateAgentTask: async () => undefined }), getPool: () => ({}) }));
jest.mock('../../PushService', () => ({ getPushService: () => ({ sendPush: async () => undefined }) }));
jest.mock('../../task-sandbox/tools', () => ({ TASK_TERMINATE_SENTINEL: '__TERMINATE__' }));
const approvalRequest = jest.fn();
jest.mock('../../task-sandbox/approval-gate', () => ({ requiresApproval: () => false, getApprovalRegistry: () => ({ request: (...a: unknown[]) => approvalRequest(...a), isAutoApprove: () => false }) }));
jest.mock('../../task-sandbox/planning', () => ({ currentPlanStepIndex: () => undefined }));
const keysSeen: Array<string | undefined> = [];
const runTool = jest.fn(async (): Promise<string> => { order.push('run'); keysSeen.push(getToolCallIdempotencyKey()); return '도구 결과'; });
jest.mock('../task-steps', () => ({ runTool: (...a: unknown[]) => runTool(...(a as [])), isSearchTool: () => false }));
jest.mock('../tool-args', () => ({ prepareToolArgs: (a: unknown) => a }));
jest.mock('../../tool-parallel', () => ({ ...jest.requireActual('../../tool-parallel'), prefetchReadOnlyCalls: async () => new Map() }));
jest.mock('../../../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../../../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({ runWithUserInputContext: (_c: unknown, fn: () => Promise<unknown>) => fn() }),
}));
const markToolCallInFlight = jest.fn(async (_taskId: string, id: string | null) => { order.push(id ? `mark:${id}` : 'clear'); });
jest.mock('../turn-reentry', () => ({
    writeTurnCheckpoint: async () => undefined,
    markToolCallInFlight: (...a: unknown[]) => markToolCallInFlight(...(a as [string, string | null])),
}));
const startReceipt = jest.fn(async (taskId: string, id: string) => { order.push(`receipt:${id}`); return `key-${taskId}-${id}`; });
const finishReceipt = jest.fn(async (_t: string, id: string, status: string) => { order.push(`receipt:${id}:${status}`); });
jest.mock('../tool-receipt', () => ({
    ...jest.requireActual('../tool-receipt'),
    startReceipt: (...a: unknown[]) => startReceipt(...(a as [string, string])),
    finishReceipt: (...a: unknown[]) => finishReceipt(...(a as [string, string, string])),
}));
const markParked = jest.fn(async () => undefined);
jest.mock('../../../data/repositories/agent-task-repository', () => ({ AgentTaskRepository: jest.fn(() => ({ markParked })) }));

import { executeTurnToolCalls } from '../turn-executor';
import { AgentTaskParked } from '../types';
import { getToolCallIdempotencyKey } from '../../../utils/tool-call-context';
import { AGENT_TASK_LIMITS } from '../../../config/runtime-limits';
import { getAgentTaskUnknownOutcomeNotice, getAgentTaskUnknownOutcomeDeclinedNotice, getAgentTaskUnknownOutcomeAnswerNotice } from '../../../prompts/agent-task-prompt';
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

beforeEach(() => { jest.clearAllMocks(); order.length = 0; keysSeen.length = 0; });

describe('executeTurnToolCalls — 실행 중 표식', () => {
    it('부작용 도구(외부 MCP)는 실행 전 표식 → 실행 → 스텝 기록 → 해제 순서', async () => {
        const { args } = input({ toolCalls: [{ id: 'c1', function: { name: 'od::create', arguments: {} } }] });
        await executeTurnToolCalls(args);
        expect(order.filter((o) => !o.startsWith('receipt'))).toEqual(['mark:c1', 'run', 'step', 'clear']);
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
    const calls = [
        { id: 'c1', function: { name: 'od::create', arguments: { title: 'a' } } },
        { id: 'c2', function: { name: 'mcp_read_resource', arguments: {} } },
    ];
    const toolMessages = (conversation: ChatMessage[]) => conversation.filter((m) => m.role === 'tool');

    it('사용자에게 묻는다 — 질문 채널(ask_human)로, 주차 가능한 대기로', async () => {
        approvalRequest.mockResolvedValue({ decision: 'rejected', reason: 'timeout', waitedMs: 7 });
        const { args } = input({ unknownOutcomeId: 'c1', toolCalls: calls });
        const out = await executeTurnToolCalls(args);
        expect(approvalRequest).toHaveBeenCalledTimes(1);
        const [req, opts] = approvalRequest.mock.calls[0] as [{ taskId: string; toolName: string; args: Record<string, unknown> }, { parkable?: boolean }];
        expect(req).toMatchObject({ taskId: 't1', toolName: 'ask_human', args: { toolName: 'od::create', toolCallId: 'c1' } });
        expect(String(req.args.question)).toContain('od::create');
        expect(opts.parkable).toBe(true);
        expect(out.pausedMs).toBe(7); // 대기 시간은 총 예산에서 뺀다
    });

    it('무응답(만료)이면 실행하지 않고 안내를 결과로 기록한 뒤 표식을 지운다', async () => {
        approvalRequest.mockResolvedValue({ decision: 'rejected', reason: 'timeout', waitedMs: 0 });
        const { args, conversation } = input({ unknownOutcomeId: 'c1', toolCalls: calls });
        await executeTurnToolCalls(args);
        expect(runTool).toHaveBeenCalledTimes(1); // c2 만 실행
        expect(toolMessages(conversation)[0]).toMatchObject({ tool_call_id: 'c1', content: getAgentTaskUnknownOutcomeNotice('od::create') });
        expect(toolMessages(conversation)[1]).toMatchObject({ tool_call_id: 'c2', content: '도구 결과' });
        expect(addAgentTaskStep).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: 'c1', content: getAgentTaskUnknownOutcomeNotice('od::create') }));
        expect(order.filter((o) => !o.startsWith('receipt'))).toEqual(['step', 'clear', 'run', 'step']);
    });

    it('승인하면 같은 호출을 다시 실행한다', async () => {
        approvalRequest.mockResolvedValue({ decision: 'approved', waitedMs: 0 });
        const { args, conversation } = input({ unknownOutcomeId: 'c1', toolCalls: calls });
        await executeTurnToolCalls(args);
        expect(runTool).toHaveBeenCalledTimes(2);
        expect(toolMessages(conversation)[0]).toMatchObject({ tool_call_id: 'c1', content: '도구 결과' });
        expect(order.filter((o) => !o.startsWith('receipt'))).toEqual(['mark:c1', 'run', 'step', 'clear', 'run', 'step']);
    });

    it('거절하면 다시 실행하지 않고, 사용자가 거절했다는 안내를 결과로 준다', async () => {
        approvalRequest.mockResolvedValue({ decision: 'rejected', reason: 'user', waitedMs: 0 });
        const { args, conversation } = input({ unknownOutcomeId: 'c1', toolCalls: calls });
        await executeTurnToolCalls(args);
        expect(runTool).toHaveBeenCalledTimes(1);
        expect(toolMessages(conversation)[0].content).toBe(getAgentTaskUnknownOutcomeDeclinedNotice('od::create'));
    });

    it('텍스트로 답하면 다시 실행하지 않고 답변을 모델에 전한다', async () => {
        approvalRequest.mockResolvedValue({ decision: 'approved', text: ' 이미 만들어졌어 ', waitedMs: 0 });
        const { args, conversation } = input({ unknownOutcomeId: 'c1', toolCalls: calls });
        await executeTurnToolCalls(args);
        expect(runTool).toHaveBeenCalledTimes(1);
        expect(toolMessages(conversation)[0].content).toBe(getAgentTaskUnknownOutcomeAnswerNotice('od::create', '이미 만들어졌어'));
    });

    it('유예가 지나 주차되면 표식을 지우지 않는다 — 재개 때 다시 묻고 결정을 이어받는다', async () => {
        approvalRequest.mockResolvedValue({ decision: 'rejected', reason: 'parked', waitedMs: 0 });
        const { args } = input({ unknownOutcomeId: 'c1', toolCalls: calls });
        await expect(executeTurnToolCalls(args)).rejects.toBeInstanceOf(AgentTaskParked);
        expect(markParked).toHaveBeenCalledWith('t1');
        expect(runTool).not.toHaveBeenCalled();
        expect(order).toEqual([]); // 표식 해제('clear') 없음
    });

    it('묻기를 끄면(AGENT_TASK_REENTRY_UNKNOWN_OUTCOME_ASK=false) 묻지 않고 안내만 준다', async () => {
        const limits = AGENT_TASK_LIMITS as { REENTRY_UNKNOWN_OUTCOME_ASK: boolean };
        limits.REENTRY_UNKNOWN_OUTCOME_ASK = false;
        try {
            const { args, conversation } = input({ unknownOutcomeId: 'c1', toolCalls: calls });
            await executeTurnToolCalls(args);
            expect(approvalRequest).not.toHaveBeenCalled();
            expect(toolMessages(conversation)[0].content).toBe(getAgentTaskUnknownOutcomeNotice('od::create'));
        } finally { limits.REENTRY_UNKNOWN_OUTCOME_ASK = true; }
    });
});

describe('executeTurnToolCalls — 외부 도구 실행 영수증·멱등 키', () => {
    it('외부 도구는 표식 → 영수증 시작 → 실행(문맥에 멱등 키) → 스텝 → 영수증 종료 → 표식 해제 순서', async () => {
        const { args } = input({ toolCalls: [{ id: 'c1', function: { name: 'od::create', arguments: {} } }] });
        await executeTurnToolCalls(args);
        expect(order).toEqual(['mark:c1', 'receipt:c1', 'run', 'step', 'receipt:c1:succeeded', 'clear']);
        expect(keysSeen).toEqual(['key-t1-c1']);
    });

    it('도구가 오류를 돌려주면 영수증은 failed', async () => {
        runTool.mockImplementationOnce(async () => 'Error: 서버 오류');
        const { args } = input({ toolCalls: [{ id: 'c1', function: { name: 'od::create', arguments: {} } }] });
        await executeTurnToolCalls(args);
        expect(finishReceipt).toHaveBeenCalledWith('t1', 'c1', 'failed');
    });

    it('읽기 전용 도구는 영수증도 멱등 키도 없다', async () => {
        const { args } = input({ toolCalls: [{ id: 'c1', function: { name: 'mcp_read_resource', arguments: {} } }] });
        await executeTurnToolCalls(args);
        expect(startReceipt).not.toHaveBeenCalled();
        expect(keysSeen).toEqual([undefined]);
    });

    it('결과 불명 호출을 다시 실행하지 않으면 영수증은 outcome_unknown 으로 닫는다', async () => {
        approvalRequest.mockResolvedValue({ decision: 'rejected', reason: 'user', waitedMs: 0 });
        const { args } = input({ unknownOutcomeId: 'c1', toolCalls: [{ id: 'c1', function: { name: 'od::create', arguments: {} } }] });
        await executeTurnToolCalls(args);
        expect(startReceipt).not.toHaveBeenCalled();
        expect(finishReceipt).toHaveBeenCalledWith('t1', 'c1', 'outcome_unknown');
    });
});

describe('executeTurnToolCalls — 도구 결과 데이터 래퍼', () => {
    const calls = [{ id: 'c1', function: { name: 'web_search', arguments: { query: 'x' } } }];
    const toolMessage = (conversation: ChatMessage[]) => conversation.find((m) => m.role === 'tool');
    afterEach(() => { jest.restoreAllMocks(); });

    it('켜져 있으면 호스트 도구 결과를 감싸 대화에 싣고, 스텝 기록은 원문 그대로 둔다', async () => {
        jest.replaceProperty(AGENT_TASK_LIMITS, 'TOOL_RESULT_WRAP_ENABLED', true);
        const { args, conversation } = input({ toolCalls: calls, goal: '가격을 조사한다' });
        await executeTurnToolCalls(args);
        const content = String(toolMessage(conversation)?.content);
        expect(content).toContain('<tool_output>\n도구 결과\n</tool_output>');
        expect(content).toContain('가격을 조사한다');
        expect(addAgentTaskStep).toHaveBeenCalledWith(expect.objectContaining({ stepType: 'tool_result', content: '도구 결과' }));
    });

    it('꺼져 있으면(기본) 결과를 그대로 싣는다', async () => {
        const { args, conversation } = input({ toolCalls: calls, goal: '가격을 조사한다' });
        await executeTurnToolCalls(args);
        expect(toolMessage(conversation)?.content).toBe('도구 결과');
    });

    it('샌드박스 도구(bash) 결과는 감싸지 않는다', async () => {
        jest.replaceProperty(AGENT_TASK_LIMITS, 'TOOL_RESULT_WRAP_ENABLED', true);
        const taskRuntime = { isTaskTool: () => true, executeTaskTool: jest.fn(async () => 'ok'), getPlanSnapshot: () => [], notifyApprovalPending: jest.fn() };
        const { args, conversation } = input({ taskRuntime, goal: '목표', toolCalls: [{ id: 'c1', function: { name: 'bash', arguments: { command: 'ls' } } }] });
        await executeTurnToolCalls(args);
        expect(toolMessage(conversation)?.content).toBe('ok');
    });
});
