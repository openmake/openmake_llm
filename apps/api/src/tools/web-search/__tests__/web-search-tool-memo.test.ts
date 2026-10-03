/**
 * web_search 도구 — 같은 사용자의 같은 질의는 한 번만 검색하고, 다른 사용자는 따로 검색한다.
 */
const performWebSearch = jest.fn(async (_q: string, _o?: unknown) => [{ title: 'A', url: 'https://a.example', snippet: 'a' }]);
jest.mock('../search-orchestrator', () => ({ performWebSearch: (q: string, o?: unknown) => performWebSearch(q, o) }));

import { webSearchTools } from '../tools';

const tool = webSearchTools.find((t) => t.tool.name === 'web_search')!;

describe('web_search 결과 메모', () => {
    it('같은 사용자·같은 질의는 다시 검색하지 않는다(동시 호출 포함)', async () => {
        const ctx = { userId: 'memo-u1', role: 'user' as const };
        const [a, b] = await Promise.all([tool.handler({ query: '메모 질의' }, ctx), tool.handler({ query: '메모 질의' }, ctx)]);
        const c = await tool.handler({ query: ' 메모  질의 ' }, ctx);
        expect(performWebSearch).toHaveBeenCalledTimes(1);
        expect(b.content).toEqual(a.content);
        expect(c.sources).toEqual(a.sources);
    });

    it('다른 사용자·사용자 문맥 없는 호출은 따로 검색한다', async () => {
        performWebSearch.mockClear();
        await tool.handler({ query: '메모 질의' }, { userId: 'memo-u2', role: 'user' });
        await tool.handler({ query: '메모 질의' });
        await tool.handler({ query: '메모 질의' });
        expect(performWebSearch).toHaveBeenCalledTimes(3);
    });
});
