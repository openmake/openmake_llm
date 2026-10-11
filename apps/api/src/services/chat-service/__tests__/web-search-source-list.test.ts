/**
 * 웹검색 출처 목록 결정적 첨부 — 사전 주입 검색과 web_search 도구 호출이 한 턴에 함께 일어난 경우.
 *
 * 배경(2026-10-12 로컬 라이브): 도구 출처는 사전 주입 건수 뒤 번호(11~)를 받는데 번호표는 사전 주입
 * 컨텍스트에서만 만들어, 모델이 단 [출처 11]~ 인용이 죽은 마커로 지워지고 무관한 사전 검색 10건 전체가 붙었다.
 */
import { appendDeterministicBlocks } from '../external-deterministic-append';
import { WEB_SEARCH_INJECTION } from '../../../config/runtime-limits';
import type { ChatMessageRequest } from '../../chat-service-types';
import type { StreamFromExternalContext } from '../external-provider';
import type { SearchSourceRef } from '../../../tools/web-search/types';

/** 사전 주입 컨텍스트(라벨형) — [출처 1]~[출처 count] */
function injectedContext(count: number): string {
    return Array.from({ length: count }, (_, i) => `[출처 ${i + 1}] 사전 ${i + 1}\n   URL: https://pre.example/${i + 1}\n   내용: 요약`).join('\n\n');
}

/** web_search 도구 한 번의 구조화 출처 — 번호 from 부터 count 건 */
function toolSearch(from: number, count: number, host = 'tool'): SearchSourceRef[] {
    return Array.from({ length: count }, (_, i) => ({ n: from + i, title: `도구 ${from + i}`, url: `https://${host}.example/${from + i}`, snippet: 's' }));
}

function run(finalContent: string, opts: { webSearchContext?: string; toolSources?: SearchSourceRef[][] }): { out: string; streamed: string } {
    let streamed = '';
    const out = appendDeterministicBlocks({
        finalContent,
        onToken: (t) => { streamed += t; },
        generatedMediaMarkdowns: [],
        integrationBlocks: {},
        ...(opts.toolSources ? { toolSources: opts.toolSources } : {}),
        req: { message: 'm', userId: '3', webSearchContext: opts.webSearchContext, userLanguagePreference: 'ko' } as unknown as ChatMessageRequest,
        ctx: {} as StreamFromExternalContext,
    });
    return { out, streamed };
}

/** 첨부된 출처 목록의 번호들 */
function listedNums(out: string): number[] {
    const block = out.split('**출처**')[1] ?? '';
    return [...block.matchAll(/^- \*\*(\d+)\.\*\* \[/gm)].map((m) => Number(m[1]));
}

describe('appendDeterministicBlocks — 사전 주입 + 도구 검색 출처', () => {
    it('도구 출처(11~) 인용은 보존되고 목록에는 인용된 도구 출처만 붙는다', () => {
        const { out, streamed } = run('환율이 올랐다 [출처 11]. 전망은 엇갈린다 [출처 13].', {
            webSearchContext: injectedContext(10),
            toolSources: [toolSearch(11, 10)],
        });
        expect(out).toContain('[출처 11]');
        expect(out).toContain('[출처 13]');
        expect(listedNums(out)).toEqual([11, 13]);
        expect(out).toContain('- **11.** [도구 11](https://tool.example/11)');
        expect(out).not.toContain('https://pre.example/');
        expect(streamed).toContain('- **13.** [도구 13](https://tool.example/13)');
    });

    it('사전 주입과 도구 출처를 섞어 인용하면 둘 다 목록에 붙는다', () => {
        const { out } = run('배경 [출처 2]. 최신 수치 [출처 12, 15].', {
            webSearchContext: injectedContext(10),
            toolSources: [toolSearch(11, 10)],
        });
        expect(listedNums(out)).toEqual([2, 12, 15]);
        expect(out).toContain('- **2.** [사전 2](https://pre.example/2)');
        expect(out).toContain('- **15.** [도구 15](https://tool.example/15)');
    });

    it('어느 쪽에도 없는 번호의 인용은 여전히 지운다', () => {
        const { out } = run('근거 [출처 11]. 지어낸 번호 [출처 40].', {
            webSearchContext: injectedContext(10),
            toolSources: [toolSearch(11, 10)],
        });
        expect(out).toContain('[출처 11]');
        expect(out).not.toContain('[출처 40]');
        expect(listedNums(out)).toEqual([11]);
    });

    it('도구 검색이 돈 턴에서 인용이 없으면 가장 최근 도구 검색의 상위 N건만 붙는다', () => {
        const perSearch = WEB_SEARCH_INJECTION.MAX_RESULTS + 2;
        const first = toolSearch(11, perSearch, 'first');
        const last = toolSearch(11 + perSearch, perSearch, 'last');
        const { out } = run('인용 없이 쓴 답변.', {
            webSearchContext: injectedContext(10),
            toolSources: [first, last],
        });
        expect(listedNums(out)).toEqual(last.slice(0, WEB_SEARCH_INJECTION.MAX_RESULTS).map((s) => s.n));
        expect(out).not.toContain('https://pre.example/');
        expect(out).not.toContain('https://first.example/');
    });

    it('인용이 없을 때 검색 뒤에 읽은 페이지가 있으면 최근 검색 상위 N건에 읽은 페이지를 더해 붙인다', () => {
        const search = toolSearch(11, 4, 'search');
        const page = toolSearch(15, 1, 'page');
        const { out } = run('인용 없이 쓴 답변.', { webSearchContext: injectedContext(10), toolSources: [search, page] });
        expect(listedNums(out)).toEqual([11, 12, 13, 14, 15]);
        expect(out).not.toContain('https://pre.example/');
    });

    it('인용이 없고 도구는 페이지 읽기만 했으면 사전 주입 전체에 읽은 페이지를 더해 붙인다', () => {
        const page = toolSearch(11, 1, 'page');
        const { out } = run('인용 없이 쓴 답변.', { webSearchContext: injectedContext(10), toolSources: [page] });
        expect(listedNums(out)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    });

    it('도구 검색이 없던 턴은 종전대로 — 인용이 없으면 사전 주입 전체, 있으면 인용된 것만', () => {
        const none = run('인용 없이 쓴 답변.', { webSearchContext: injectedContext(10) });
        expect(listedNums(none.out)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

        const cited = run('근거 [출처 3]. 지어낸 번호 [출처 11].', { webSearchContext: injectedContext(10), toolSources: [] });
        expect(listedNums(cited.out)).toEqual([3]);
        expect(cited.out).not.toContain('[출처 11]');
    });

    it('모델이 출처 섹션을 직접 썼고 인용·URL 이 없으면 최근 도구 검색 상위 N건의 URL 을 보강한다', () => {
        const { out } = run('답변.\n\n**출처**\n- 도구 11\n- 도구 12', {
            webSearchContext: injectedContext(10),
            toolSources: [toolSearch(11, 3)],
        });
        expect(out).toContain('[11] https://tool.example/11');
        expect(out).toContain('[13] https://tool.example/13');
        expect(out).not.toContain('https://pre.example/');
    });
});

/**
 * 사전 주입 없이 모델이 web_search 도구만 부른 턴 — 번호표는 도구 출처(1~)뿐이다.
 * 인용이 있으면 사전 검색 턴과 같은 규칙으로 붙이고, 인용이 없으면 아무것도 붙이지 않는다
 * (모델이 extract_webpage 로 읽은 페이지를 `출처: A, B` 평문으로 직접 쓴 답에 검색 결과 10건이 덧붙는 소음 방지).
 */
describe('appendDeterministicBlocks — 도구 검색만 돈 턴', () => {
    it('인용이 있으면 인용된 도구 출처만 목록으로 붙는다', () => {
        const { out, streamed } = run('최신 수치 [출처 1]. 배경 [출처 4, 6].', { toolSources: [toolSearch(1, 10)] });
        expect(listedNums(out)).toEqual([1, 4, 6]);
        expect(out).toContain('- **4.** [도구 4](https://tool.example/4)');
        expect(streamed).toContain('**출처**\n- **1.** [도구 1](https://tool.example/1)');
    });

    it('인용이 없으면 아무것도 붙이지 않는다', () => {
        const body = '공식 문서를 읽고 정리한 답변.\n\n출처: [Node.js 릴리스](https://nodejs.org/en/about/previous-releases), [블로그](https://blog.example/a)';
        const { out, streamed } = run(body, { toolSources: [toolSearch(1, 10), toolSearch(11, 10, 'second')] });
        expect(out).toBe(body);
        expect(streamed).toBe('');
    });

    it('목록 밖 번호의 인용 마커는 지운다', () => {
        const { out } = run('근거 [출처 2]. 지어낸 번호 [출처 40].', { toolSources: [toolSearch(1, 10)] });
        expect(out).toContain('[출처 2]');
        expect(out).not.toContain('[출처 40]');
        expect(listedNums(out)).toEqual([2]);
    });

    it('목록 밖 번호만 인용했으면 마커만 지우고 목록은 붙이지 않는다', () => {
        const { out, streamed } = run('지어낸 번호 [출처 40].', { toolSources: [toolSearch(1, 10)] });
        expect(out).toBe('지어낸 번호.');
        expect(streamed).toBe('');
    });

    it('라벨 없는 대괄호 숫자(모델 자체 각주·코드)는 인용으로 보지 않는다', () => {
        const body = 'Bun 1.3 이 나왔다[1]. 예: `arr[3]`.\n\n[1] Bun 공식 블로그 https://bun.sh/blog\n[2] 릴리스 노트 https://github.com/oven-sh/bun/releases';
        const { out, streamed } = run(body, { toolSources: [toolSearch(1, 10)] });
        expect(out).toBe(body);
        expect(streamed).toBe('');
    });

    // 2026-10-12 로컬 라이브: 모델이 읽은 페이지까지 섞어 자기 번호로 `## 출처 목록` 을 쓰자, 도구 출처 번호표
    // 기준의 `🔗 URL` 보강이 같은 번호에 다른 URL 을 덧붙였다. 사전 주입이 없는 턴은 목록 작성 금지 지시도 없다.
    it('모델이 출처 섹션을 직접 썼으면 건드리지 않는다 — 번호가 모델 자체 목록 기준일 수 있다', () => {
        const body = '공식 발표 [출처 1]. 벤치마크 [출처 5]. 후속 [출처 12].\n\n## 출처 목록\n1 Bun Blog — https://bun.com/blog/bun-v1.3\n5 Mashblog — https://mashblog.com/posts/bun\n12 InfoQ — https://www.infoq.com/news/bun';
        const { out, streamed } = run(body, { toolSources: [toolSearch(1, 8)] });
        expect(out).toBe(body);
        expect(streamed).toBe('');
    });

    it('모델이 출처 섹션을 직접 썼고 인용이 없으면 보강하지 않는다', () => {
        const body = '답변.\n\n**출처**\n- 도구 1\n- 도구 2';
        const { out, streamed } = run(body, { toolSources: [toolSearch(1, 5)] });
        expect(out).toBe(body);
        expect(streamed).toBe('');
    });

    // extract_webpage·web_scrape 가 읽은 페이지도 출처 1건으로 등록된다 — 링크를 주고 "요약해줘" 한 턴처럼 읽기 도구만 돈 턴.
    // 라벨 인용이 있을 때만 목록이 붙고, 인용이 없거나 라벨 없는 [1] 만 있으면 본문 그대로다.
    it('읽은 페이지 1건만 있는 턴 — [출처 1] 로 인용하면 그 페이지가 목록에 붙는다', () => {
        const readPage: SearchSourceRef[] = [{ n: 1, title: 'Bun 1.3', url: 'https://bun.sh/blog/bun-v1.3', snippet: 's' }];
        const { out, streamed } = run('Bun 1.3 이 나왔다 [출처 1].', { toolSources: [readPage] });
        expect(listedNums(out)).toEqual([1]);
        expect(streamed).toContain('**출처**\n- **1.** [Bun 1.3](https://bun.sh/blog/bun-v1.3)');
    });

    it('읽은 페이지 1건만 있는 턴 — 인용이 없거나 라벨 없는 [1] 만 있으면 아무것도 붙이지 않는다', () => {
        const readPage: SearchSourceRef[] = [{ n: 1, title: 'Bun 1.3', url: 'https://bun.sh/blog/bun-v1.3', snippet: 's' }];
        for (const body of ['링크의 글을 요약하면 이렇다.', '요약하면 이렇다 [1].']) {
            const { out, streamed } = run(body, { toolSources: [readPage] });
            expect(out).toBe(body);
            expect(streamed).toBe('');
        }
    });

    it('검색 뒤에 읽은 페이지(검색 결과 뒤 번호)를 인용하면 읽은 페이지가 목록에 붙는다', () => {
        const readPage: SearchSourceRef[] = [{ n: 11, title: 'Bun 1.3', url: 'https://bun.sh/blog/bun-v1.3', snippet: 's' }];
        const { out } = run('공식 발표 [출처 11]. 반응 [출처 2].', { toolSources: [toolSearch(1, 10), readPage] });
        expect(listedNums(out)).toEqual([11, 2]);
        expect(out).toContain('- **11.** [Bun 1.3](https://bun.sh/blog/bun-v1.3)');
    });

    it('도구 검색이 결과 없이 끝난 턴은 건드리지 않는다', () => {
        const { out, streamed } = run('검색 결과가 없었다 [출처 1].', { toolSources: [[]] });
        expect(out).toBe('검색 결과가 없었다 [출처 1].');
        expect(streamed).toBe('');
    });
});

/**
 * 도구 검색만 돈 턴 — 모델이 쓴 출처 섹션의 판정(2026-10-12).
 * 섹션에 URL 이 하나라도 있으면 서버는 아무것도 하지 않고(모델 번호 + 링크 목록과 어긋나지 않게),
 * URL 이 하나도 없으면 섹션이 없는 것과 같게 처리한다(링크 없는 목록만 남아 원문으로 못 가는 것 방지).
 * 섹션 인식은 헤딩·굵은 글씨에 더해 평문 `(수식어) 출처:` 줄까지 — 스테이징에서 `검색 결과 출처:` 평문 줄이 안 걸렸다.
 */
describe('appendDeterministicBlocks — 도구 검색만 돈 턴의 모델 출처 섹션', () => {
    const untouched = (body: string) => {
        const { out, streamed } = run(body, { toolSources: [toolSearch(1, 8)] });
        expect(out).toBe(body);
        expect(streamed).toBe('');
    };

    it('평문 섹션에 URL 이 있으면 건드리지 않는다', () => {
        untouched('공식 발표 [출처 1]. 벤치마크 [출처 5]. 후속 [출처 12].\n\n검색 결과 출처:\n1 Bun Blog — https://bun.com/blog/bun-v1.3\n5 Mashblog — https://mashblog.com/posts/bun\n12 InfoQ — https://www.infoq.com/news/bun');
    });

    it('평문 섹션(URL 있음) 뒤에 맺음말이 와도 건드리지 않는다', () => {
        untouched('공식 발표 [출처 1].\n\n출처:\n- [Bun Blog](https://bun.com/blog/bun-v1.3)\n- [InfoQ](https://www.infoq.com/news/bun)\n\n더 궁금한 점이 있으면 말씀해 주세요.');
    });

    it('답변 마지막 줄의 한 줄 평문 섹션(URL 있음)도 건드리지 않는다', () => {
        untouched('공식 발표 [출처 1].\n\n참고 출처: [Bun Blog](https://bun.com/blog/bun-v1.3), [InfoQ](https://www.infoq.com/news/bun)');
    });

    it('다른 언어 라벨·복수형·전각 콜론의 평문 섹션도 같은 규칙이다', () => {
        untouched('Released [Source 1].\n\nSources:\n1. Bun Blog https://bun.com/blog/bun-v1.3');
        untouched('発表 [出典 1]。\n\n出典：\n- https://bun.com/blog/bun-v1.3');
    });

    it('평문 섹션에 URL 이 없으면 섹션이 없는 것처럼 — 목록 밖 마커를 지우고 인용된 출처 목록을 붙인다', () => {
        const { out } = run('수치 [출처 2]. 배경 [출처 5]. 지어낸 번호 [출처 40].\n\n검색 결과 출처:\n2 nxplace.com — 요약\n5 example.org — 요약', { toolSources: [toolSearch(1, 8)] });
        expect(out).not.toContain('[출처 40]');
        expect(listedNums(out)).toEqual([2, 5]);
        expect(out).toContain('- **5.** [도구 5](https://tool.example/5)');
    });

    it('헤딩·굵은 글씨 섹션이라도 URL 이 없으면 인용된 출처 목록을 붙인다', () => {
        const heading = run('수치 [출처 2]. 지어낸 번호 [출처 40].\n\n## 출처 목록\n- 도구 2', { toolSources: [toolSearch(1, 8)] });
        expect(heading.out).not.toContain('[출처 40]');
        expect(heading.out).toContain('\n\n---\n\n**출처**\n- **2.** [도구 2](https://tool.example/2)');

        const bold = run('수치 [출처 3].\n\n**출처**\n- 도구 3', { toolSources: [toolSearch(1, 8)] });
        expect(bold.streamed).toBe('\n\n---\n\n**출처**\n- **3.** [도구 3](https://tool.example/3)');
    });

    it('본문 중간의 한 줄 "출처: …" 표기는 섹션으로 보지 않는다 — URL 이 있어도 서버 목록이 붙는다', () => {
        const { out } = run('인구는 줄었다 [출처 2].\n출처: 통계청 (https://kostat.go.kr)\n\n다음으로 물가는 올랐다 [출처 4]. 자세한 내용은 https://example.org/cpi 를 보라.', { toolSources: [toolSearch(1, 8)] });
        expect(listedNums(out)).toEqual([2, 4]);
    });

    it('콜론 뒤가 빈 평문 줄이라도 바로 뒤가 목록이 아니면 섹션으로 보지 않는다', () => {
        const { out } = run('인구는 줄었다 [출처 2].\n\n출처:\n통계청이 낸 자료를 보면 https://kostat.go.kr 에 표가 있다.', { toolSources: [toolSearch(1, 8)] });
        expect(listedNums(out)).toEqual([2]);
    });

    it('사전 주입 턴은 평문 섹션을 섹션으로 보지 않는다(종전 그대로) — URL 이 있어도 인용된 출처 목록이 붙는다', () => {
        const { out } = run('근거 [출처 3].\n\n검색 결과 출처:\n3 사전 3 — https://pre.example/3', { webSearchContext: injectedContext(10) });
        expect(listedNums(out)).toEqual([3]);
    });
});
