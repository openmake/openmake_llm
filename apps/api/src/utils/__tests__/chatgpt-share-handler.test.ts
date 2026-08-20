/**
 * ChatGPT 공유 대화 구조화 핸들러 — hydrateTurboStream / parseChatGptShareHtml.
 * 공유 페이지는 SPA 셸이라 Readability 본문이 0 — 인라인 turbo-stream 그래프에서
 * 대화를 복원하는 0단계 핸들러 검증 (2026-08-20 도입).
 */
import { hydrateTurboStream, parseChatGptShareHtml } from '../web-scraper-handlers';

/** 실페이지 인코딩과 동형의 최소 픽스처 그래프를 구성한다. */
function buildFixtureValues(): unknown[] {
    const V: unknown[] = [null]; // 0 = root (마지막에 채움)
    const add = (v: unknown) => { V.push(v); return V.length - 1; };
    const kRole = add('role');
    const kAuthor = add('author');
    const kContentType = add('content_type');
    const kParts = add('parts');
    const kContent = add('content');
    const kMessage = add('message');
    const mkNode = (roleStr: string, contentType: string, textStr: string) => {
        const author = add({ [`_${kRole}`]: add(roleStr) });
        const content = add({
            [`_${kContentType}`]: add(contentType),
            [`_${kParts}`]: add([add(textStr)]),
        });
        return add({ [`_${kMessage}`]: add({ [`_${kAuthor}`]: author, [`_${kContent}`]: content }) });
    };
    const linear = add([
        mkNode('system', 'text', '시스템 프롬프트'),
        mkNode('user', 'text', '질문입니다'),
        mkNode('assistant', 'thoughts', '내부 사고'),
        mkNode('assistant', 'text', '답변입니다'),
    ]);
    const data = add({ [`_${add('title')}`]: add('공유 테스트'), [`_${add('linear_conversation')}`]: linear });
    V[0] = { [`_${add('loaderData')}`]: data };
    return V;
}

function fixtureHtml(): string {
    const payload = JSON.stringify(JSON.stringify(buildFixtureValues()));
    return `<html><body><script>window.__reactRouterContext.streamController.enqueue(${payload});</script></body></html>`;
}

describe('hydrateTurboStream', () => {
    test('객체 키(_K)·배열·참조 인덱스를 복원한다', () => {
        const values = ['안 씀', 'k', { _1: 3 }, [4], 'v'];
        expect(hydrateTurboStream(values, 2)).toEqual({ k: ['v'] });
    });

    test('음수 인덱스(특수값)는 null 로 강등한다', () => {
        expect(hydrateTurboStream(['k', { _0: -5 }], 1)).toEqual({ k: null });
    });
});

describe('parseChatGptShareHtml', () => {
    test('user/assistant text 턴만 순서대로 markdown 으로 추출한다', () => {
        const r = parseChatGptShareHtml(fixtureHtml());
        expect(r).not.toBeNull();
        expect(r!.title).toBe('공유 테스트');
        expect(r!.markdown).toContain('# 공유 테스트');
        expect(r!.markdown).toContain('**사용자:**\n\n질문입니다');
        expect(r!.markdown).toContain('**ChatGPT:**\n\n답변입니다');
        expect(r!.markdown).not.toContain('시스템 프롬프트'); // system 제외
        expect(r!.markdown).not.toContain('내부 사고'); // thoughts 채널 제외
        expect(r!.markdown.indexOf('질문입니다')).toBeLessThan(r!.markdown.indexOf('답변입니다'));
    });

    test('스트림 청크가 없는 일반 HTML 은 null (fallback 단계로 진행)', () => {
        expect(parseChatGptShareHtml('<html><body><p>hello</p></body></html>')).toBeNull();
    });

    test('청크가 있어도 대화 데이터가 없으면 null', () => {
        const html = `<script>streamController.enqueue(${JSON.stringify(JSON.stringify([{ _1: 2 }, 'k', 'v']))})</script>`;
        expect(parseChatGptShareHtml(html)).toBeNull();
    });
});
