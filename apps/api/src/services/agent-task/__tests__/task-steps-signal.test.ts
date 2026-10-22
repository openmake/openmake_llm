/**
 * runTool 중단 신호 전달(2026-10-22 R4) — signal 이 있으면 executeTool 의 4번째 인자로 넘기고, 없으면 종전 호출 그대로다.
 */
import { runTool } from '../task-steps';

describe('runTool — 중단 신호', () => {
    it('runTool 은 signal 을 executeTool 의 4번째 인자로 넘긴다', async () => {
        const executeTool = jest.fn().mockResolvedValue({ content: 'ok' });
        const ac = new AbortController();
        await runTool({ executeTool } as never, 'x', {}, { userId: 'u' } as never, undefined, ac.signal);
        expect(executeTool).toHaveBeenCalledWith('x', {}, expect.anything(), { signal: ac.signal });
    });

    it('signal 이 없으면 4번째 인자는 undefined 다', async () => {
        const executeTool = jest.fn().mockResolvedValue({ content: 'ok' });
        await runTool({ executeTool } as never, 'x', {}, { userId: 'u' } as never);
        expect(executeTool).toHaveBeenCalledWith('x', {}, expect.anything(), undefined);
    });
});
