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
});
