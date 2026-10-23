/**
 * 채팅 도구 배치의 취소 경계(#1474 리뷰 보정) — 요청이 중단되면 같은 배치의 **어느 분기도**(외부 도구·위임·병렬 위임·
 * 오케스트레이션) 새로 시작하지 않고, 승인 대기 중 중단되면 승인 결과와 무관하게 실행하지 않는다.
 * 위임은 실제 orchestration-dispatch 를 거쳐 작업 생성·디스패치 저장소까지 닿는지를 본다(그 둘만 대역).
 */
const executeTool = jest.fn();
const createAgentTask = jest.fn(async () => true);
const dispatchAgentTask = jest.fn(async () => 'started');
const approval = { policy: 'none' as string, onRequest: async (): Promise<void> => undefined };

jest.mock('../../../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../../../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({ executeTool, normalizeToolCall: (name: string, args: Record<string, unknown>) => ({ name, args }) }),
}));
jest.mock('../../tool-result-truncation-recorder', () => ({ recordToolResultTruncation: jest.fn() }));
jest.mock('../../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ createAgentTask, findAgentTaskByCreateKey: async () => undefined }),
    getPool: () => ({ query: async () => ({ rows: [], rowCount: 0 }) }),
}));
jest.mock('../../agent-task/task-queue', () => ({ dispatchAgentTask: (...a: unknown[]) => (dispatchAgentTask as jest.Mock)(...a) }));
jest.mock('../../agent-task/create-idempotency', () => ({
    claimDelegatedTaskDurable: async () => ({ priorTaskId: undefined, createKey: undefined }),
    releaseDelegatedTask: jest.fn(),
}));
jest.mock('../chat-approval', () => ({
    ...jest.requireActual('../chat-approval'),
    resolveChatApprovalPolicy: async () => approval.policy,
    hasChatApprovalChannel: () => true,
    requestChatApproval: async () => { await approval.onRequest(); return { decision: 'approved', waitedMs: 0 }; },
}));

import { runToolCallBatch, createToolBatchState } from '../external-tool-batch';

const userContext = { userId: '3', role: 'user' as const };
const OK = { content: [{ type: 'text', text: 'ok' }] };

beforeEach(() => {
    executeTool.mockReset().mockResolvedValue(OK);
    createAgentTask.mockClear();
    dispatchAgentTask.mockClear();
    approval.policy = 'none';
    approval.onRequest = async () => undefined;
});

const run = (signal: AbortSignal, toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>) => {
    const messages: Array<{ role: string; content: string; tool_call_id?: string }> = [];
    return runToolCallBatch({
        deps: { currentUserContext: userContext, allowedTools: [] } as never,
        req: { message: 'q', abortSignal: signal, approvalCards: true } as never,
        ctx: {}, tools: [], messages: messages as never, state: createToolBatchState(), toolCalls: toolCalls as never,
    }).then(() => messages);
};

describe('runToolCallBatch — 중단 뒤 어느 분기도 시작하지 않는다', () => {
    it('외부 도구 실행 중 중단 → 뒤따르는 delegate_agent_task 는 작업을 만들지도 디스패치하지도 않는다', async () => {
        const ac = new AbortController();
        executeTool.mockImplementationOnce(async () => { ac.abort(); return OK; });
        const messages = await run(ac.signal, [
            { id: 't1', name: 'x::write', args: {} },
            { id: 't2', name: 'delegate_agent_task', args: { goal: '보고서 작성' } },
        ]);
        expect(createAgentTask).not.toHaveBeenCalled();
        expect(dispatchAgentTask).not.toHaveBeenCalled();
        // 호출마다 tool 결과는 남긴다(대화 구조 유지) — 실행하지 않았다는 문구로
        expect(messages.map((m) => m.tool_call_id)).toEqual(['t1', 't2']);
    });

    it('승인 대기 중 중단 → 승인이 나도 위임을 실행하지 않는다', async () => {
        approval.policy = 'all';
        const ac = new AbortController();
        approval.onRequest = async () => { ac.abort(); };
        await run(ac.signal, [{ id: 't1', name: 'delegate_agent_task', args: { goal: '보고서 작성' } }]);
        expect(createAgentTask).not.toHaveBeenCalled();
        expect(dispatchAgentTask).not.toHaveBeenCalled();
    });

    it('승인 대기 중 중단 → 승인이 나도 외부 도구를 실행하지 않는다', async () => {
        approval.policy = 'all';
        const ac = new AbortController();
        approval.onRequest = async () => { ac.abort(); };
        await run(ac.signal, [{ id: 't1', name: 'x::write', args: {} }]);
        expect(executeTool).not.toHaveBeenCalled();
    });

    it('중단이 없으면 위임은 종전대로 작업을 만들고 디스패치한다(회귀)', async () => {
        await run(new AbortController().signal, [{ id: 't1', name: 'delegate_agent_task', args: { goal: '보고서 작성' } }]);
        expect(createAgentTask).toHaveBeenCalledTimes(1);
        expect(dispatchAgentTask).toHaveBeenCalledTimes(1);
    });
});
