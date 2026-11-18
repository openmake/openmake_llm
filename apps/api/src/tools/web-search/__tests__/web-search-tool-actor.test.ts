/**
 * fact_check·research_topic 도구 — 요청 사용자를 costUserId 로 넘긴다 (2026-11-18 라이브).
 * 넘기지 않으면 의미 리랭킹이 행위자 없이 해석돼 개인 text.embed 배정만 있는 사용자는 '미배정' 으로 skip 된다.
 */
const performWebSearch = jest.fn(async (_q: string, _o?: unknown) => [{ title: 'A', url: 'https://a.example', snippet: 'a' }]);
jest.mock('../search-orchestrator', () => ({ performWebSearch: (q: string, o?: unknown) => performWebSearch(q, o) }));

import { webSearchTools } from '../tools';

const byName = (n: string) => webSearchTools.find((t) => t.tool.name === n)!;

describe.each([
    ['fact_check', { claim: '주장' }],
    ['research_topic', { topic: '주제' }],
])('%s — 행위자 전달', (name, args) => {
    beforeEach(() => performWebSearch.mockClear());

    it('사용자 문맥이 있으면 costUserId 로 넘긴다', async () => {
        await byName(name).handler(args, { userId: 'actor-u1', role: 'user' });
        expect(performWebSearch.mock.calls[0][1]).toEqual(expect.objectContaining({ costUserId: 'actor-u1' }));
    });

    it('사용자 문맥이 없으면 costUserId 도 없다', async () => {
        await byName(name).handler(args);
        expect((performWebSearch.mock.calls[0][1] as { costUserId?: string } | undefined)?.costUserId).toBeUndefined();
    });
});
