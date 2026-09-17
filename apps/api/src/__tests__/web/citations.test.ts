/** 웹 인용 전처리(apps/web/lib/citations.ts, F19.4) — rootDir 밖이라 require 로 불러온다. */
const { linkCitations, citationNumber, sourceDomain } = require('../../../../web/lib/citations') as {
    linkCitations: (content: string, n: number) => string;
    citationNumber: (href?: string) => number | null;
    sourceDomain: (s: { url: string; source?: string }) => string;
};

describe('web citations', () => {
    it('범위 안 [N] 만 링크로, 범위 밖·0 은 그대로', () => {
        expect(linkCitations('코스피는 2,600 [1] 이고 환율은 [3] 입니다 [0]', 2)).toBe('코스피는 2,600 [1](#cite-1) 이고 환율은 [3] 입니다 [0]');
    });

    it('코드펜스·인라인 코드 안의 [1] 은 바꾸지 않는다', () => {
        const src = '배열 `arr[1]` 과\n```js\nconst x = a[1];\n```\n출처 [1]';
        expect(linkCitations(src, 1)).toBe('배열 `arr[1]` 과\n```js\nconst x = a[1];\n```\n출처 [1](#cite-1)');
    });

    it('스트리밍 중 닫히지 않은 코드펜스 안도 건드리지 않는다', () => {
        expect(linkCitations('앞 [1]\n```py\nprint(a[1])', 1)).toBe('앞 [1](#cite-1)\n```py\nprint(a[1])');
    });

    it('이미 링크인 [1](...) 과 참조형 [텍스트][1] 은 그대로, 연속 인용 [1][2] 는 둘 다', () => {
        expect(linkCitations('[1](https://x.example) [문서][1] [1][2]', 2)).toBe('[1](https://x.example) [문서][1] [1](#cite-1)[2](#cite-2)');
    });

    it('출처가 없으면 원문 그대로', () => {
        expect(linkCitations('[1]', 0)).toBe('[1]');
    });

    it('citationNumber·sourceDomain', () => {
        expect(citationNumber('#cite-3')).toBe(3);
        expect(citationNumber('https://x')).toBeNull();
        expect(citationNumber('#cite-x')).toBeNull();
        expect(sourceDomain({ url: 'https://news.example.com/a' })).toBe('news.example.com');
        expect(sourceDomain({ url: 'x', source: 'naver.com' })).toBe('naver.com');
    });
});
