/**
 * 채팅 도구 루프의 중단 신호 전파(#1474) — 요청(req.abortSignal)의 신호가 런타임 포트 executeTool 까지 그대로 내려가고,
 * 이미 중단됐으면 도구를 시작하지 않으며, 진행 중 중단 뒤에는 같은 배치의 다음 호출을 시작하지 않는다.
 * 신호가 없는 기존 호출은 종전 인자(3개) 그대로다.
 */
const executeTool = jest.fn();

jest.mock('../../../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../../../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({ executeTool, normalizeToolCall: (name: string, args: Record<string, unknown>) => ({ name, args }) }),
}));
jest.mock('../../tool-result-truncation-recorder', () => ({ recordToolResultTruncation: jest.fn() }));
jest.mock('../../org/effective-policy', () => ({
    ...jest.requireActual('../../org/effective-policy'),
    resolveEffectivePolicy: async () => ({ approvalPolicyMin: 'high-risk' }),
}));

import { executeExternalTool } from '../external-tool-exec';
import { runToolCallBatch, createToolBatchState } from '../external-tool-batch';
import { getChatApprovalRegistry } from '../chat-approval';

const userContext = { userId: '3', role: 'user' as const };
const OK = { content: [{ type: 'text', text: 'ok' }] };

beforeEach(() => executeTool.mockReset().mockResolvedValue(OK));

describe('executeExternalTool — 중단 신호(#1474)', () => {
    it('신호를 주면 런타임 executeTool 이 같은 신호를 받는다', async () => {
        const ac = new AbortController();
        await executeExternalTool({ currentUserContext: userContext } as never, 'x::y', {}, undefined, ac.signal);
        expect(executeTool).toHaveBeenCalledWith('x::y', {}, userContext, { signal: ac.signal });
    });

    it('이미 중단된 신호면 런타임을 부르지 않고 시작 알림도 보내지 않는다', async () => {
        const start = jest.fn();
        const ac = new AbortController();
        ac.abort();
        const out = await executeExternalTool({ currentUserContext: userContext, mcpToolStartCallback: start } as never, 'x::y', {}, undefined, ac.signal);
        expect(executeTool).not.toHaveBeenCalled();
        expect(start).not.toHaveBeenCalled();
        expect(out.startsWith('Error:')).toBe(true);
    });

    it('신호가 없으면 종전처럼 3인자로 부른다', async () => {
        await executeExternalTool({ currentUserContext: userContext } as never, 'x::y', {});
        expect(executeTool.mock.calls[0]).toEqual(['x::y', {}, userContext]);
    });
});

describe('runToolCallBatch — 요청 신호가 배치의 모든 도구 호출에 닿는다(#1474)', () => {
    const base = (signal: AbortSignal) => ({
        // 외부 MCP 호출은 승인 후 신호를 검사한다 — none 바닥 차단을 우회하는 예전 전제는 쓰지 않는다.
        deps: {
            currentUserContext: userContext, allowedTools: [],
            chatApprovalPendingCallback: (p: { approvalId: string }) => { void getChatApprovalRegistry().approve(p.approvalId); },
        } as never,
        req: { message: 'q', abortSignal: signal, approvalCards: true } as never,
        ctx: {}, tools: [], messages: [] as never, state: createToolBatchState(),
    });

    it('병렬 선실행·순차 실행 모두 req.abortSignal 을 그대로 넘긴다', async () => {
        const ac = new AbortController();
        await runToolCallBatch({ ...base(ac.signal), toolCalls: [{ id: 't1', name: 'web_search', args: { query: 'a' } }, { id: 't2', name: 'web_search', args: { query: 'b' } }] as never });
        await runToolCallBatch({ ...base(ac.signal), toolCalls: [{ id: 't3', name: 'x::write', args: {} }] as never });
        expect(executeTool).toHaveBeenCalledTimes(3);
        for (const call of executeTool.mock.calls) expect(call[3]).toEqual({ signal: ac.signal });
    });

    it('진행 중 중단 뒤에는 같은 배치의 다음 호출을 시작하지 않는다', async () => {
        const ac = new AbortController();
        executeTool.mockImplementationOnce(async () => { ac.abort(); return OK; });
        const params = { ...base(ac.signal), toolCalls: [{ id: 't1', name: 'x::write_a', args: {} }, { id: 't2', name: 'x::write_b', args: {} }] as never };
        await runToolCallBatch(params);
        expect(executeTool).toHaveBeenCalledTimes(1);
        expect(executeTool.mock.calls[0][0]).toBe('x::write_a');
    });
});
