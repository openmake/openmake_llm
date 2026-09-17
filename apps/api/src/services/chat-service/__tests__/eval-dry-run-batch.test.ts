jest.mock('../external-tool-exec', () => ({ executeExternalTool: jest.fn(async () => 'real result') }));

import { runToolCallBatch, createToolBatchState, EVAL_DRY_RUN_TOOL_RESULT } from '../external-tool-batch';
import { executeExternalTool } from '../external-tool-exec';

describe('runToolCallBatch evalToolObserver.dryRun', () => {
    it('도구를 실행하지 않고 호출마다 dry-run 결과를 싣는다', async () => {
        const messages: Array<Record<string, unknown>> = [];
        await runToolCallBatch({
            deps: { currentUserContext: null, allowedTools: [] },
            req: { message: 'q', evalToolObserver: { dryRun: true, onToolCalls: () => undefined } } as never,
            ctx: {},
            tools: [],
            messages: messages as never,
            toolCalls: [{ id: 't1', name: 'web_search', args: { query: 'a' } }, { id: 't2', name: 'extract_webpage', args: { url: 'u' } }] as never,
            state: createToolBatchState(),
        });
        expect(executeExternalTool).not.toHaveBeenCalled();
        expect(messages).toEqual([
            { role: 'tool', content: EVAL_DRY_RUN_TOOL_RESULT, tool_name: 'web_search', tool_call_id: 't1' },
            { role: 'tool', content: EVAL_DRY_RUN_TOOL_RESULT, tool_name: 'extract_webpage', tool_call_id: 't2' },
        ]);
    });
});
