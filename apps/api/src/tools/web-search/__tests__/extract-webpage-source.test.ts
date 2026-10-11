/**
 * extract_webpage — 읽은 페이지를 그 턴의 출처 1건으로 등록한다.
 *
 * 배경(2026-10-12 로컬 라이브): 모델이 extract_webpage 로 읽은 페이지 내용을 [출처 1] 로 인용했는데 그 턴의 1번은
 * web_search 결과의 무관한 페이지였다 — 읽은 페이지에 번호가 없어 모델이 검색 결과 번호를 빌려 썼다.
 */
const mockSafeFetch = jest.fn();

jest.mock('../../../security/ssrf-guard', () => ({
    ...jest.requireActual('../../../security/ssrf-guard'),
    safeFetch: mockSafeFetch,
}));
jest.mock('../search-orchestrator', () => ({
    performWebSearch: jest.fn(async () => [
        { title: 'A', url: 'https://a.example', snippet: 'a' },
        { title: 'B', url: 'https://b.example', snippet: 'b' },
    ]),
}));

import { webSearchTools } from '../tools';
import { TRUNCATION } from '../../../config/runtime-limits';
import { WEB_SEARCH_TOOL_LIMITS } from '../../../config/addon-tool-limits';

const extract = webSearchTools.find((t) => t.tool.name === 'extract_webpage')!;
const search = webSearchTools.find((t) => t.tool.name === 'web_search')!;

const PAGE_URL = 'https://bun.sh/blog/bun-v1.3';
const page = (html: string) => mockSafeFetch.mockResolvedValueOnce({ text: async () => html });
const textOf = (r: { content: Array<{ text?: string }> }) => r.content[0].text ?? '';

describe('extract_webpage 출처 번호', () => {
    afterEach(() => mockSafeFetch.mockReset());

    it('기준 10 → 11번을 받고 기준을 11 로 민다', async () => {
        page('<html><head><title> Bun 1.3 </title></head><body><p>Bun 1.3 릴리스 본문</p></body></html>');
        const context = { userId: '3', role: 'user' as const, sourceNumberBase: 10 };
        const r = await extract.handler({ url: PAGE_URL }, context);
        expect(r.sources).toEqual([{ n: 11, title: 'Bun 1.3', url: PAGE_URL, snippet: expect.stringContaining('Bun 1.3 릴리스 본문') }]);
        expect(context.sourceNumberBase).toBe(11);
        expect(r.isError).toBeUndefined();
    });

    it('결과 텍스트 맨 앞에 web_search 와 같은 표기로 번호·제목·URL 을 붙인다', async () => {
        page('<html><head><title>Bun 1.3</title></head><body><p>본문</p></body></html>');
        const r = await extract.handler({ url: PAGE_URL }, { userId: '3', role: 'user', sourceNumberBase: 10 });
        expect(textOf(r).startsWith(`[11] Bun 1.3\n   ${PAGE_URL}\n\n`)).toBe(true);
        expect(textOf(r)).toContain('본문');
    });

    it('<title> 이 없으면 URL 을 제목으로 쓴다', async () => {
        page('<html><body><p>제목 없는 페이지</p></body></html>');
        const r = await extract.handler({ url: PAGE_URL }, { userId: '3', role: 'user', sourceNumberBase: 0 });
        expect(r.sources).toEqual([expect.objectContaining({ n: 1, title: PAGE_URL, url: PAGE_URL })]);
        expect(textOf(r).startsWith(`[1] ${PAGE_URL}\n`)).toBe(true);
    });

    it('snippet 은 본문 앞부분을 기존 상한(web_search 스니펫)까지만 싣는다', async () => {
        page(`<html><head><title>T</title></head><body>${'가'.repeat(WEB_SEARCH_TOOL_LIMITS.SNIPPET_CHARS * 3)}</body></html>`);
        const r = await extract.handler({ url: PAGE_URL }, { userId: '3', role: 'user', sourceNumberBase: 0 });
        expect(r.sources?.[0].snippet).toHaveLength(WEB_SEARCH_TOOL_LIMITS.SNIPPET_CHARS + '...'.length);
    });

    it('기준이 없는 문맥(채팅 턴 밖 — 에이전트 작업 등)은 텍스트·반환값이 종전과 같고 문맥을 바꾸지 않는다', async () => {
        const html = '<html><head><title>Bun 1.3</title></head><body><p>본문</p></body></html>';
        const legacy = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, TRUNCATION.WEB_CONTENT_MAX);
        const context: { userId: string; role: 'user'; sourceNumberBase?: number } = { userId: '3', role: 'user' };
        page(html);
        expect(await extract.handler({ url: PAGE_URL }, context)).toEqual({ content: [{ type: 'text', text: legacy }] });
        expect(context.sourceNumberBase).toBeUndefined();
        page(html);
        expect(await extract.handler({ url: PAGE_URL })).toEqual({ content: [{ type: 'text', text: legacy }] });
    });

    it('실패하면 번호를 주지 않고 기준도 밀지 않는다', async () => {
        mockSafeFetch.mockRejectedValueOnce(new Error('network error'));
        const context = { userId: '3', role: 'user' as const, sourceNumberBase: 10 };
        const r = await extract.handler({ url: PAGE_URL }, context);
        expect(r.isError).toBe(true);
        expect(r.sources).toBeUndefined();
        expect(textOf(r)).not.toContain('[11]');
        expect(context.sourceNumberBase).toBe(10);
    });

    it('web_search → extract_webpage → web_search 가 겹치지 않는 번호를 받는다', async () => {
        const context = { userId: '3', role: 'user' as const, sourceNumberBase: 10 };
        const first = await search.handler({ query: 'q1' }, context);
        page('<html><head><title>읽은 페이지</title></head><body>본문</body></html>');
        const read = await extract.handler({ url: PAGE_URL }, context);
        const second = await search.handler({ query: 'q2' }, context);
        expect(first.sources?.map((s) => s.n)).toEqual([11, 12]);
        expect(read.sources?.map((s) => s.n)).toEqual([13]);
        expect(second.sources?.map((s) => s.n)).toEqual([14, 15]);
        expect(context.sourceNumberBase).toBe(15);
    });
});
