/**
 * web.search 실행기 — 계획기 지시문을 그대로 검색어로 쓰지 않는다 (2026-10-13).
 *
 * 배경: 계획기가 "Search for the latest …"·"…를 검색" 같은 지시문을 instruction 에 적었고
 * 실행기는 그 문장을 통째로 검색 엔진에 넘겼다.
 */
const performWebSearch = jest.fn();
jest.mock('../../../tools/web-search/search-orchestrator', () => ({
    performWebSearch: (...args: unknown[]) => performWebSearch(...args),
}));

import { webSearchExecutor } from '../executors/web';

function run(instruction: string, userMessage = '원문', userId?: string) {
    const task = { id: 't1', capability: 'web.search', instruction, refs: [], attachments: [] };
    return webSearchExecutor(task as never, { lang: 'ko', userMessage, userId } as never);
}

beforeEach(() => performWebSearch.mockReset().mockResolvedValue([{ title: 't', url: 'https://e.x', snippet: 's' }]));

describe('webSearchExecutor — 검색어', () => {
    it('지시문에서 지시 표현을 걷어낸 검색어로 검색한다', async () => {
        const r = await run('Search the web for Bun runtime version 1.3 release notes and major changes.');

        expect(performWebSearch.mock.calls[0][0]).toBe('Bun runtime version 1.3 release notes and major changes');
        expect(r.text).toContain('검색어: Bun runtime version 1.3 release notes and major changes\n');
    });

    it('지시문이 비면 사용자 메시지에서 검색어를 만든다', async () => {
        await run('', '벤처기업확인기관에 대해서 조사해서 보고해');

        expect(performWebSearch.mock.calls[0][0]).toBe('벤처기업확인기관에 대해서');
    });
});

describe('webSearchExecutor — 구조화 출처', () => {
    it('검색 결과를 번호 없는 출처로 함께 돌려준다(text 는 그대로)', async () => {
        performWebSearch.mockResolvedValue([{ title: '날씨', url: 'https://w.x/1', snippet: '맑음\n  5도', source: 'w.x' }]);
        const r = await run('서울 날씨');
        expect(r.sources).toEqual([{ title: '날씨', url: 'https://w.x/1', snippet: '맑음 5도', source: 'w.x' }]);
        expect(r.text).toContain('1. 날씨');
    });

    it('결과 0건이면 출처가 없다', async () => {
        performWebSearch.mockResolvedValue([]);
        const r = await run('서울 날씨');
        expect(r.sources).toBeUndefined();
    });
});

describe('webSearchExecutor — 행위자 전달 (2026-11-18 라이브)', () => {
    // 계획기 web 작업이 행위자 없이 검색해, 개인 text.embed 배정만 있는 사용자의 리랭킹이 '미배정' 으로 skip 됐다
    it('요청 사용자를 costUserId 로 넘긴다 — 리랭킹이 그 사용자의 text.embed 배정으로 해석된다', async () => {
        await run('Node.js 최신 LTS', '원문', '1');
        expect(performWebSearch.mock.calls[0][1]).toEqual(expect.objectContaining({ costUserId: '1' }));
    });

    it('사용자 없음이면 costUserId 도 없다', async () => {
        await run('Node.js 최신 LTS');
        expect(performWebSearch.mock.calls[0][1].costUserId).toBeUndefined();
    });
});
