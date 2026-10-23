/**
 * W3 S3 — 채팅 승인 대기(사람이 결정하는 시간)는 도구 루프의 wall-clock 예산과 도구 시간(timings.toolMs)에서 뺀다.
 * 도구 배치는 가짜로 바꿔 "시계가 WAIT 만큼 흐른 배치"를 흉내 낸다 — 그중 승인 대기로 보고한 몫만 예산에서 빠져야 한다.
 */
jest.mock('../external-tool-batch', () => ({
    ...jest.requireActual('../external-tool-batch'),
    runToolCallBatch: jest.fn(),
}));

import { streamFromExternalProvider } from '../external-fallback';
import { runToolCallBatch } from '../external-tool-batch';
import { AGENT_LOOP_LIMITS } from '../../../config/runtime-limits';
import type { ResolvedProvider } from '../../../providers/provider-router';
import type { ChatMessage } from '../../../llm';
import type { StreamFromExternalContext } from '../external-provider-types';

const batch = runToolCallBatch as jest.Mock;
const WALL_CLOCK_NUDGE = '처리 시간이 초과되었습니다';
const WAIT = AGENT_LOOP_LIMITS.MAX_WALL_CLOCK_MS + 60_000;

let skew = 0;
const realNow = Date.now.bind(Date);

function runWithBatchWait(reportAsApprovalWait: boolean) {
    const seen: ChatMessage[][] = [];
    const streamChat = jest.fn(async (opts: { messages: ChatMessage[] }) => {
        seen.push([...opts.messages]);
        return seen.length === 1
            ? { content: '', toolCalls: [{ id: 't1', name: 'bash', args: { command: 'ls' } }], usage: {}, finishReason: 'tool_calls' }
            : { content: '답', usage: {}, finishReason: 'stop' };
    });
    batch.mockImplementation(async (p: { state: { approvalWaitMs: number }; messages: ChatMessage[] }) => {
        skew += WAIT;
        if (reportAsApprovalWait) p.state.approvalWaitMs += WAIT;
        p.messages.push({ role: 'tool', content: 'ran', tool_name: 'bash', tool_call_id: 't1' } as ChatMessage);
    });
    const resolved = {
        providerId: 'local-llm', modelId: 'm', fullId: 'local-llm:m',
        provider: {
            id: 'local-llm', sdkType: 'local-llm', displayName: 'local-llm',
            getCapabilities: () => ({ streaming: true, toolCalling: true, vision: false, thinking: false }),
            listModels: async () => [], validateCredentials: async () => ({ ok: true }), streamChat,
        },
    } as unknown as ResolvedProvider;
    const deps = { currentUserContext: null, allowedTools: [], providerRouter: { resolve: jest.fn(), getExternalKeysRepo: () => undefined } } as never;
    const ctx: StreamFromExternalContext = {};
    const req = { message: '안녕', userId: 'u1', userRole: 'user' as const };
    return streamFromExternalProvider(deps, resolved, req as never, () => {}, ctx).then(() => ({ seen, ctx }));
}

describe('도구 루프 예산 — 승인 대기 제외', () => {
    beforeEach(() => { skew = 0; jest.spyOn(Date, 'now').mockImplementation(() => realNow() + skew); });
    afterEach(() => { jest.restoreAllMocks(); });

    it('승인 대기로 흐른 시간은 wall-clock 가드를 넘기지 않고 toolMs 에도 들어가지 않는다', async () => {
        const { seen, ctx } = await runWithBatchWait(true);
        expect(seen).toHaveLength(2);
        expect(seen[1].some((m) => String(m.content).includes(WALL_CLOCK_NUDGE))).toBe(false);
        expect(ctx.timings!.toolMs).toBeLessThan(WAIT);
    });

    it('대조: 같은 시간이 도구 실행이면 가드가 걸리고 toolMs 에 들어간다', async () => {
        const { seen, ctx } = await runWithBatchWait(false);
        expect(seen[1].some((m) => String(m.content).includes(WALL_CLOCK_NUDGE))).toBe(true);
        expect(ctx.timings!.toolMs).toBeGreaterThanOrEqual(WAIT);
    });
});
