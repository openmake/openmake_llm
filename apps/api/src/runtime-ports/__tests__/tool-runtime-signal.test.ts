/**
 * 내장 전용 런타임(MCP add-on 없음)도 중단 신호를 버리지 않는다(#1474) — 포트의 opts 가 dispatchTool 까지 닿아
 * 이미 중단된 요청은 내장 도구 핸들러를 시작하지 않는다.
 */
const handler = jest.fn(async () => ({ content: [{ type: 'text', text: 'ran' }] }));
jest.mock('../../tools/builtin-tools', () => ({
    getBuiltInTools: () => [{ tool: { name: 'fake_tool', description: 'd', inputSchema: { type: 'object', properties: {} } }, handler }],
}));

import { getToolRuntime, resetToolRuntime } from '../tool-runtime';

beforeEach(() => { resetToolRuntime(); handler.mockClear(); });

describe('BUILTIN_ONLY_RUNTIME.executeTool — 중단 신호', () => {
    it('이미 중단된 신호면 내장 핸들러를 부르지 않는다', async () => {
        const ac = new AbortController();
        ac.abort();
        const r = await getToolRuntime().executeTool('fake_tool', {}, { userId: 'u1', role: 'user' }, { signal: ac.signal });
        expect(handler).not.toHaveBeenCalled();
        expect(r.isError).toBe(true);
    });

    it('신호가 살아 있으면 종전대로 실행한다', async () => {
        const r = await getToolRuntime().executeTool('fake_tool', {}, { userId: 'u1', role: 'user' }, { signal: new AbortController().signal });
        expect(handler).toHaveBeenCalledTimes(1);
        expect(r.isError).toBeFalsy();
    });
});
