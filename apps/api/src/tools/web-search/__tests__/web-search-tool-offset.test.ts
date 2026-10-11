/**
 * web_search 도구 — 문맥의 sourceNumberBase(턴 시작 때 붙은 출처 수) 뒤부터 번호를 매긴다.
 * 종전엔 도구 출처가 [1] 부터 다시 시작해 Knowledge·사전 주입 출처와 번호가 겹치고 저장 시 덮어썼다(2026-09-24 코드 리뷰).
 */
jest.mock('../search-orchestrator', () => ({
    performWebSearch: jest.fn(async () => [
        { title: 'A', url: 'https://a.example', snippet: 'a' },
        { title: 'B', url: 'https://b.example', snippet: 'b' },
    ]),
}));

import { webSearchTools } from '../tools';

const tool = webSearchTools.find((t) => t.tool.name === 'web_search')!;

describe('web_search 번호 기준', () => {
    it('sourceNumberBase 가 있으면 그 뒤 번호로', async () => {
        const r = await tool.handler({ query: 'q' }, { userId: '3', role: 'user', sourceNumberBase: 2 });
        expect(r.sources?.map((s) => s.n)).toEqual([3, 4]);
        const text = (r.content as Array<{ text: string }>)[0].text;
        expect(text).toContain('[3] A');
    });

    it('없으면 종전대로 [1] 부터', async () => {
        const r = await tool.handler({ query: 'q' }, { userId: '3', role: 'user' });
        expect(r.sources?.map((s) => s.n)).toEqual([1, 2]);
    });

    // 같은 턴의 두 번째 web_search 도 11~ 부터 매겨 첫 검색과 번호가 겹쳤다(2026-10-12) — 턴 공유 문맥의 기준을 호출마다 민다
    it('같은 턴(같은 문맥)의 두 번째 호출은 첫 호출 뒤 번호를 받는다', async () => {
        const context = { userId: '3', role: 'user' as const, sourceNumberBase: 10 };
        const first = await tool.handler({ query: 'q1' }, context);
        const second = await tool.handler({ query: 'q2' }, context);
        expect(first.sources?.map((s) => s.n)).toEqual([11, 12]);
        expect(second.sources?.map((s) => s.n)).toEqual([13, 14]);
        expect((second.content as Array<{ text: string }>)[0].text).toContain('[13] A');
    });

    it('병렬로 불러도 번호 범위가 겹치지 않는다', async () => {
        const context = { userId: '3', role: 'user' as const, sourceNumberBase: 0 };
        const results = await Promise.all(['a', 'b', 'c'].map((query) => tool.handler({ query }, context)));
        const nums = results.flatMap((r) => r.sources?.map((s) => s.n) ?? []);
        expect([...nums].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(context.sourceNumberBase).toBe(6);
    });

    it('기준이 없는 문맥(채팅 턴 밖 — 에이전트 작업 등)은 호출마다 [1] 부터, 문맥을 바꾸지 않는다', async () => {
        const context: { userId: string; role: 'user'; sourceNumberBase?: number } = { userId: '3', role: 'user' };
        await tool.handler({ query: 'q1' }, context);
        const second = await tool.handler({ query: 'q2' }, context);
        expect(second.sources?.map((s) => s.n)).toEqual([1, 2]);
        expect(context.sourceNumberBase).toBeUndefined();
    });
});
