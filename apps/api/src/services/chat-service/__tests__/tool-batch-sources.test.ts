/**
 * runToolCallBatch — 도구가 낸 구조화 출처를 턴 단위(state.toolSources)로 모은다.
 * 병렬 선실행(읽기 전용 2건 이상)과 순차 실행 양쪽에서 모여야 답변 끝 출처 목록의 번호표에 들어간다(2026-10-12).
 */
const executeTool = jest.fn();

jest.mock('../../../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../../../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({ executeTool, normalizeToolCall: (name: string, args: Record<string, unknown>) => ({ name, args }) }),
}));
jest.mock('../../tool-result-truncation-recorder', () => ({ recordToolResultTruncation: jest.fn() }));

import { runToolCallBatch, createToolBatchState } from '../external-tool-batch';

const src = (n: number) => ({ n, title: `T${n}`, url: `https://e.example/${n}`, snippet: 's' });

describe('runToolCallBatch — 도구 출처 수집', () => {
    it('병렬 선실행·순차 실행 모두 호출별 출처를 state.toolSources 에 쌓고, 턴 공유 문맥을 그대로 넘긴다', async () => {
        const userContext = { userId: '3', role: 'user' as const, sourceNumberBase: 10 };
        const seenContexts: unknown[] = [];
        executeTool.mockImplementation(async (name: string, args: { query?: string }, context: unknown) => {
            seenContexts.push(context);
            if (name !== 'web_search') return { content: [{ type: 'text', text: 'page' }] };
            const from = args.query === 'a' ? 11 : args.query === 'b' ? 13 : 15;
            return { content: [{ type: 'text', text: 'r' }], sources: [src(from), src(from + 1)] };
        });
        const state = createToolBatchState();
        const base = { deps: { currentUserContext: userContext, allowedTools: [] } as never, req: { message: 'q' } as never, ctx: {}, tools: [], messages: [] as never, state };

        // 1턴: web_search 2건 → 병렬 선실행
        await runToolCallBatch({ ...base, toolCalls: [{ id: 't1', name: 'web_search', args: { query: 'a' } }, { id: 't2', name: 'web_search', args: { query: 'b' } }] as never });
        // 2턴: 1건 → 순차 실행
        await runToolCallBatch({ ...base, toolCalls: [{ id: 't3', name: 'web_search', args: { query: 'c' } }] as never });

        expect(state.toolSources.map((list) => list.map((s) => s.n))).toEqual([[11, 12], [13, 14], [15, 16]]);
        expect(executeTool).toHaveBeenCalledTimes(3);
        expect(seenContexts.every((c) => c === userContext)).toBe(true);
    });
});
