/**
 * 딥리서치 소스 검색 — config.userId 를 costUserId 로 넘긴다 (2026-11-18 r4, Fable r3 지적 1).
 * 넘기지 않으면 의미 리랭킹이 행위자 없이 해석돼 개인 text.embed 배정만 있는 사용자는 '미배정' 으로 skip 된다.
 */
const performWebSearch = jest.fn(async (_q: string, _o?: unknown) => [] as unknown[]);
jest.mock('../../../tools/web-search', () => ({ performWebSearch: (q: string, o?: unknown) => performWebSearch(q, o) }));
jest.mock('../../../tools/web-search/provider-registry', () => ({ searchContentProviders: async () => [] }));
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ addResearchStep: async () => undefined }) }));

import { searchSubTopics } from '../source-searcher';
import type { ResearchConfig } from '../types';

function run(config: Partial<ResearchConfig>) {
    return searchSubTopics({
        client: {} as never,
        config: { maxSearchResults: 30, maxTotalSources: 80, language: 'ko', ...config } as ResearchConfig,
        subTopics: [{ id: 's1', title: 't', description: 'd', searchQueries: ['질의 하나'], priority: 1 } as never],
        sessionId: 'sess', loopNumber: 0,
        sourceMap: new Map(), seenUrls: new Set(), usedQueries: new Set(),
        throwIfAborted: () => undefined,
    });
}

describe('searchSubTopics — 행위자 전달', () => {
    beforeEach(() => performWebSearch.mockClear());

    it('config.userId 가 있으면 costUserId 로 넘긴다', async () => {
        await run({ userId: 'actor-u1' });
        expect(performWebSearch).toHaveBeenCalledTimes(1);
        expect(performWebSearch.mock.calls[0][1]).toEqual(expect.objectContaining({ costUserId: 'actor-u1' }));
    });

    it('config.userId 가 없으면 costUserId 도 없다', async () => {
        await run({});
        expect((performWebSearch.mock.calls[0][1] as { costUserId?: string }).costUserId).toBeUndefined();
    });
});
