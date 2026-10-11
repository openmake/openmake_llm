/**
 * 사전 주입 웹검색 컨텍스트 → 도구 출처 번호의 기준.
 *
 * REST 경로는 클라이언트가 webSearchContext 문자열만 주고 기준(sourceNumberBase)을 주지 않는다 — 기준이 없으면
 * 그 턴의 도구 출처가 1번부터 시작해 사전 주입 번호와 겹치고, 번호표는 사전 주입 쪽이 이겨 도구 인용이 엉뚱한 출처로 간다.
 */
jest.mock('../search-orchestrator', () => ({
    performWebSearch: jest.fn(async () => [
        { title: 'A', url: 'https://a.example', snippet: 'a' },
        { title: 'B', url: 'https://b.example', snippet: 'b' },
    ]),
}));

import { formatSearchSources, parseInjectedSources, resolveSourceNumberBase } from '../format-sources';
import { webSearchTools } from '../tools';
import { WEB_SEARCH_TEMPLATES } from '../../../sockets/ws-chat-locales';

/** buildWebSearchContext 와 같은 꼴의 사전 주입 컨텍스트 — 지시문(예시 [출처 1], [출처 2] 포함) + 라벨형 출처 count 건 */
function injectedContext(count: number, lang: 'ko' | 'en' = 'ko'): string {
    const tpl = WEB_SEARCH_TEMPLATES[lang];
    const results = Array.from({ length: count }, (_, i) => ({ title: `사전 ${i + 1}`, url: `https://pre.example/${i + 1}`, snippet: '요약' }));
    const body = formatSearchSources(results, { labeled: true, sourceWord: tpl.sourceLabel, contentWord: tpl.contentLabel, separator: '\n' });
    return `\n\n## 🔍 ${tpl.header}\n${tpl.instruction}\n\n${body}\n`;
}

describe('parseInjectedSources', () => {
    it('라벨형 컨텍스트에서 번호 → 제목·URL 을 뽑는다(지시문의 예시 번호는 출처가 아니다)', () => {
        const parsed = parseInjectedSources(injectedContext(3));
        expect([...parsed.keys()]).toEqual(['1', '2', '3']);
        expect(parsed.get('2')).toEqual({ title: '사전 2', url: 'https://pre.example/2' });
    });

    it('출처가 없는 문자열은 빈 표', () => {
        expect(parseInjectedSources('').size).toBe(0);
        expect(parseInjectedSources('\n\n## ⚠️ 최신 정보 확인 불가\n학습 지식만으로 답하세요 [1].\n').size).toBe(0);
    });
});

describe('resolveSourceNumberBase', () => {
    it('기준이 없고 컨텍스트에 [출처 1]~[출처 10] 이 있으면 10', () => {
        expect(resolveSourceNumberBase(undefined, injectedContext(10))).toBe(10);
        expect(resolveSourceNumberBase(undefined, injectedContext(10, 'en'))).toBe(10);
    });

    it('기준이 명시되면 그 값이 우선한다', () => {
        expect(resolveSourceNumberBase(12, injectedContext(10))).toBe(12);
    });

    it('컨텍스트가 없거나 출처가 없으면 0', () => {
        expect(resolveSourceNumberBase(undefined, undefined)).toBe(0);
        expect(resolveSourceNumberBase(undefined, '')).toBe(0);
        expect(resolveSourceNumberBase(undefined, '\n\n## ⚠️ 최신 정보 확인 불가\n학습 지식만으로 답하세요.\n')).toBe(0);
    });

    it('이 기준을 실은 문맥에서 web_search 는 사전 주입 뒤 번호(11~)를 받는다', async () => {
        const tool = webSearchTools.find((t) => t.tool.name === 'web_search')!;
        const context = { userId: '3', role: 'user' as const, sourceNumberBase: resolveSourceNumberBase(undefined, injectedContext(10)) };
        const r = await tool.handler({ query: 'q' }, context);
        expect(r.sources?.map((s) => s.n)).toEqual([11, 12]);
    });
});
