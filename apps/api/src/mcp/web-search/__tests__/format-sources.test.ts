import { formatSearchSources } from '../format-sources';

const SAMPLE = [
    { title: 'A', url: 'http://a', snippet: 'alpha snippet body' },
    { title: 'B', url: 'http://b', snippet: 'beta snippet body' },
    { title: 'C', url: 'http://c', snippet: '' },
];

describe('formatSearchSources', () => {
    it('maxSnippetChars=0 은 무제한 — snippet 을 자르지 않는다 (P1 회귀: 0 → 빈 슬라이스 금지)', () => {
        const out = formatSearchSources(SAMPLE, { maxSnippetChars: 0 });
        expect(out).toContain('alpha snippet body');
        expect(out).toContain('beta snippet body');
    });

    it('maxResults=0 은 무제한 — 모든 결과를 포함', () => {
        const out = formatSearchSources(SAMPLE, { maxResults: 0 });
        expect(out).toContain('[1] A');
        expect(out).toContain('[3] C');
    });

    it('maxResults 양수면 상위 N개로 컷', () => {
        const out = formatSearchSources(SAMPLE, { maxResults: 2 });
        expect(out).toContain('[1] A');
        expect(out).toContain('[2] B');
        expect(out).not.toContain('[3] C');
    });

    it('maxSnippetChars 양수면 잘라내고 접미사 부착', () => {
        const out = formatSearchSources([SAMPLE[0]], { maxSnippetChars: 5, snippetSuffix: '...' });
        expect(out).toContain('alpha...');
        expect(out).not.toContain('alpha snippet');
    });

    it('labeled=true 는 출처/내용 라벨형, emptySnippet 으로 빈 snippet 대체', () => {
        const out = formatSearchSources([SAMPLE[2]], { labeled: true, emptySnippet: '(내용 없음)' });
        expect(out).toContain('[출처 1] C');
        expect(out).toContain('URL: http://c');
        expect(out).toContain('내용: (내용 없음)');
    });

    it('labeled=false 는 간결형 — 빈 snippet 줄은 생략', () => {
        const out = formatSearchSources([SAMPLE[2]], { labeled: false });
        expect(out).toContain('[1] C');
        expect(out.trim().endsWith('http://c')).toBe(true);
    });

    it('sourceWord/contentWord 로 라벨 다국어화', () => {
        const out = formatSearchSources([SAMPLE[0]], { labeled: true, sourceWord: 'Source', contentWord: 'Content' });
        expect(out).toContain('[Source 1] A');
        expect(out).toContain('Content: alpha snippet body');
    });

    it('labeled=true 이고 emptySnippet 미지정이면 빈 snippet 의 내용 라벨 줄 자체를 생략 (빈 "내용: " 누수 방지)', () => {
        const out = formatSearchSources([SAMPLE[2]], { labeled: true, contentWord: '내용' });
        expect(out).toContain('[출처 1] C');
        expect(out).toContain('URL: http://c');
        expect(out).not.toContain('내용:');
        expect(out.trim().endsWith('URL: http://c')).toBe(true);
    });

    it('showSource=true 는 제목 옆에 소스 도메인 표시, source 없는 결과는 제목만', () => {
        const out = formatSearchSources(
            [
                { title: 'N', url: 'http://n', snippet: 's', source: 'naver.com' },
                { title: 'X', url: 'http://x', snippet: 's' },
            ],
            { showSource: true },
        );
        expect(out).toContain('[1] N · naver.com');
        expect(out).toContain('[2] X\n');
    });

    it('showSource 미지정(기본 false)은 기존 포맷 유지 — source 가 있어도 표시 안 함', () => {
        const out = formatSearchSources(
            [{ title: 'N', url: 'http://n', snippet: 's', source: 'naver.com' }],
        );
        expect(out).toContain('[1] N\n');
        expect(out).not.toContain('naver.com');
    });

    it('snippet 컷이 surrogate pair(이모지) 중간을 분할하지 않는다', () => {
        // '😀' = U+1F600 (surrogate pair, 길이 2). 캡 3 이면 코드포인트 3개까지 = 'ab😀'
        const out = formatSearchSources([{ title: 'E', url: 'http://e', snippet: 'ab😀cd' }], { maxSnippetChars: 3 });
        expect(out).toContain('ab😀');
        expect(out).not.toContain('�'); // replacement char 없음
        expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/); // lone high surrogate 없음
    });
});
