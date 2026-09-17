import { formatSearchSources, toSourceRefs } from '../format-sources';

const results = [
    { title: '첫째', url: 'https://a.example/1', snippet: '가'.repeat(30), source: 'searxng' },
    { title: '둘째 😀', url: 'https://b.example/2', snippet: '😀'.repeat(10), source: 'naver.com' },
    { title: '셋째', url: 'https://c.example/3', snippet: '', source: 'google.com' },
];

describe('toSourceRefs — formatSearchSources 와 같은 번호·캡', () => {
    it('maxResults 캡과 [N] 번호가 포맷 출력과 일치한다', () => {
        const opts = { maxResults: 2, maxSnippetChars: 5 };
        const text = formatSearchSources(results, { ...opts, labeled: true });
        const refs = toSourceRefs(results, opts);
        expect(refs.map((r) => r.n)).toEqual([1, 2]);
        for (const r of refs) {
            expect(text).toContain(`[출처 ${r.n}] ${r.title}`);
            if (r.snippet) expect(text).toContain(r.snippet);
        }
        expect(text).not.toContain('[출처 3]');
    });

    it('snippet 은 code point 기준으로 자르고 접미사를 붙인다(이모지 중간 절단 없음)', () => {
        const refs = toSourceRefs(results, { maxSnippetChars: 3, snippetSuffix: '...' });
        expect(refs[1].snippet).toBe('😀😀😀...');
        expect(refs[2].snippet).toBe('');
    });

    it('source 는 도메인이 아니면 URL 호스트로(표시 라벨 규칙 동일)', () => {
        const refs = toSourceRefs(results);
        expect(refs.map((r) => r.source)).toEqual(['a.example', 'naver.com', 'google.com']);
    });
});
