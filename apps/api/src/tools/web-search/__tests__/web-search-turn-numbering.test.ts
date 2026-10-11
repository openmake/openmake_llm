/**
 * web_search 번호 이어 매기기 — 도구 런타임(샌드박스·인자 검증·디스패처)을 거쳐도 턴 공유 문맥이 그대로 핸들러에 닿는지.
 * 런타임이 문맥을 복제하면 핸들러가 민 기준(sourceNumberBase)이 다음 호출에 보이지 않아 번호가 다시 겹친다(2026-10-12).
 */
jest.mock('../search-orchestrator', () => ({
    performWebSearch: jest.fn(async () => [
        { title: 'A', url: 'https://a.example', snippet: 'a' },
        { title: 'B', url: 'https://b.example', snippet: 'b' },
    ]),
}));

import { getToolRuntime } from '../../../runtime-ports/tool-runtime';

describe('web_search — 런타임 경유 번호 기준', () => {
    it('같은 문맥 객체로 두 번 실행하면 번호가 이어진다', async () => {
        const context = { userId: '3', role: 'user' as const, sourceNumberBase: 10 };
        const first = await getToolRuntime().executeTool('web_search', { query: 'q1' }, context);
        const second = await getToolRuntime().executeTool('web_search', { query: 'q2' }, context);
        expect(first.sources?.map((s) => s.n)).toEqual([11, 12]);
        expect(second.sources?.map((s) => s.n)).toEqual([13, 14]);
        expect(context.sourceNumberBase).toBe(14);
    });
});
