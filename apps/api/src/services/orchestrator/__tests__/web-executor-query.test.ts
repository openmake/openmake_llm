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

function run(instruction: string, userMessage = '원문') {
    const task = { id: 't1', capability: 'web.search', instruction, refs: [], attachments: [] };
    return webSearchExecutor(task as never, { lang: 'ko', userMessage } as never);
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
