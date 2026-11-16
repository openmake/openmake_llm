/** 웹 인용 전처리(apps/web/lib/citations.ts, F19.4) — rootDir 밖이라 require 로 불러온다. */
import { CITATION_MARKER_SRC } from '../../tools/web-search/citation-markers';
import { WEB_SEARCH_TEMPLATES } from '../../sockets/ws-chat-locales';

const { linkCitations, citationNumber, sourceDomain, CITE_LABELS } = require('../../../../web/lib/citations') as {
    CITE_LABELS: readonly string[];
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

    describe('번호마다 라벨을 되풀이한 묶음 인용', () => {
        const chips = (...ns: number[]) => ns.map((n) => `[${n}](#cite-${n})`).join('');

        it('[출처 11, 출처 16, 출처 17] 은 번호별 칩으로 바꾼다', () => {
            expect(linkCitations('물가가 올랐다 [출처 11, 출처 16, 출처 17].', 18)).toBe(`물가가 올랐다 ${chips(11, 16, 17)}.`);
        });

        it('다른 언어 라벨·라벨 섞임·공백 없는 꼴도 바꾼다', () => {
            expect(linkCitations('a [Source 1, Source 2]', 5)).toBe(`a ${chips(1, 2)}`);
            expect(linkCitations('a [출처 3, 출처 8, 9]', 9)).toBe(`a ${chips(3, 8, 9)}`);
            expect(linkCitations('a [출처 1,출처 2]', 2)).toBe(`a ${chips(1, 2)}`);
        });

        it('번호 하나라도 범위 밖이면 원문 그대로', () => {
            expect(linkCitations('a [출처 2, 출처 30]', 5)).toBe('a [출처 2, 출처 30]');
        });

        it('코드펜스·인라인 코드 안과 이미 링크인 꼴은 그대로', () => {
            const src = '`[출처 1, 출처 2]`\n```\n[출처 1, 출처 2]\n```\n[출처 1, 출처 2](https://x)';
            expect(linkCitations(src, 2)).toBe(src);
        });

        it('기존 꼴 회귀 — [출처 3, 8]·[출처 3]·[1][2]', () => {
            expect(linkCitations('[출처 3, 8] [출처 3] [1][2]', 8)).toBe(`${chips(3, 8)} ${chips(3)} ${chips(1, 2)}`);
        });

        // 짝 검사: 번호는 1 이상·1~2자리, 링크 아님, 출처 수 99 — "변환됨" = 결과가 입력과 다름
        it('웹 CITE_LABELS 는 서버 sourceLabel 집합과 같다', () => {
            const server = new Set(Object.values(WEB_SEARCH_TEMPLATES).map((t) => t.sourceLabel.toLowerCase()));
            expect(new Set(CITE_LABELS.map((l) => l.toLowerCase()))).toEqual(server);
        });

        it.each([
            '[출처 11, 출처 16, 출처 17]', '[Source 1, Source 2]', '[출처 3, 8]', '[출처 3, 출처 8, 9]', '[出典 1、出典 2]',
            '[출처 11 출처 16]', '[출처 1 및 출처 2]', '[출처]', '[来源 1，来源 2]', '[출처 1; 출처 2]',
        ])('웹이 변환한다 ⇔ 서버 CITATION_MARKER_SRC 가 전체를 맞춘다: %s', (s) => {
            const web = linkCitations(s, 99) !== s;
            const server = new RegExp(`^${CITATION_MARKER_SRC}$`, 'i').test(s);
            expect(web).toBe(server);
        });
    });
});
