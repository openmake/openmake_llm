/**
 * 오픈디자인 산출물 결정적 에코 테스트 — 캡처 조건·중복 방지·첨부 계약.
 * (external-deterministic-append 의 captureOdArtifactHtml + odArtifact 첨부 경로)
 */
import {
    captureOdArtifactHtml,
    appendDeterministicBlocks,
    normalizeOdToolCall,
    type OdArtifactCapture,
} from '../external-deterministic-append';
import type { ChatMessageRequest } from '../../chat-service-types';
import type { StreamFromExternalContext } from '../external-provider';

const DECK_HTML = '<!DOCTYPE html>\n<html lang="ko"><head><title>사내 AI 도입 제안</title></head>'
    + '<body><section class="slide">s1</section></body></html>';

describe('captureOdArtifactHtml', () => {
    it('자체완결 HTML content 를 title 태그와 함께 캡처한다', () => {
        const cap = captureOdArtifactHtml({ name: 'deck.html', content: DECK_HTML }, '{"ok":true}');
        expect(cap).not.toBeNull();
        expect(cap!.title).toBe('사내 AI 도입 제안');
        expect(cap!.id).toMatch(/^deck-/);
        expect(cap!.html).toBe(DECK_HTML);
    });

    it('title 태그가 없으면 파일명(확장자 제거)을 제목으로 쓴다', () => {
        const html = '<html><body>x</body></html>';
        const cap = captureOdArtifactHtml({ path: 'projects/pitch-deck.html', content: html }, 'ok');
        expect(cap!.title).toBe('pitch-deck');
    });

    it('HTML 이 아닌 content(CSS 등 부속 파일)는 캡처하지 않는다', () => {
        expect(captureOdArtifactHtml({ name: 'tokens.css', content: ':root{--x:1}' }, 'ok')).toBeNull();
    });

    it('실패한 도구 호출(Error 결과)은 캡처하지 않는다', () => {
        expect(captureOdArtifactHtml({ name: 'deck.html', content: DECK_HTML }, 'Error: 저장 실패')).toBeNull();
    });

    it('제목의 큰따옴표는 작은따옴표로 강등한다 (artifact 속성 파싱 보호)', () => {
        const html = '<html><head><title>"AI" 제안</title></head></html>';
        const cap = captureOdArtifactHtml({ name: 'deck.html', content: html }, 'ok');
        expect(cap!.title).toBe("'AI' 제안");
    });
});

describe('normalizeOdToolCall', () => {
    it('mcp_call 간접 호출을 server::tool 로 정규화한다', () => {
        const eff = normalizeOdToolCall('mcp_call', {
            server: 'open-design',
            tool: 'create_artifact',
            args: { name: 'deck.html', content: DECK_HTML },
        });
        expect(eff.name).toBe('open-design::create_artifact');
        expect(eff.args.content).toBe(DECK_HTML);
    });

    it('직접 호출은 그대로 반환한다', () => {
        const args = { name: 'deck.html', content: DECK_HTML };
        const eff = normalizeOdToolCall('open-design::create_artifact', args);
        expect(eff.name).toBe('open-design::create_artifact');
        expect(eff.args).toBe(args);
    });
});

describe('appendDeterministicBlocks — odArtifact 첨부', () => {
    function run(finalContent: string, odArtifact: OdArtifactCapture | null): { out: string; streamed: string } {
        let streamed = '';
        const out = appendDeterministicBlocks({
            finalContent,
            onToken: (t) => { streamed += t; },
            generatedImageMarkdowns: [],
            kakaomapBlocks: [],
            discussionSourceBlocks: [],
            odArtifact,
            req: { message: 'm', userId: '3' } as unknown as ChatMessageRequest,
            ctx: {} as StreamFromExternalContext,
        });
        return { out, streamed };
    }

    const CAP: OdArtifactCapture = { id: 'deck-abc', title: '사내 AI 도입 제안', html: DECK_HTML };

    it('최종 응답에 html 아티팩트가 없으면 결정적으로 첨부한다 (스트림+히스토리 양쪽)', () => {
        const { out, streamed } = run('덱을 저장했습니다. 아래에서 확인하세요.', CAP);
        expect(out).toContain('<artifact id="deck-abc" kind="html" title="사내 AI 도입 제안">');
        expect(out).toContain(DECK_HTML);
        expect(streamed).toContain('<artifact id="deck-abc"');
    });

    it('모델이 이미 html 아티팩트를 출력했으면 중복 첨부하지 않는다', () => {
        const withArtifact = '완성했습니다.\n\n<artifact id="x" kind="html" title="t">\n<html></html>\n</artifact>';
        const { out } = run(withArtifact, CAP);
        expect(out.match(/<artifact\b/g)!.length).toBe(1);
    });

    it('캡처가 없으면 아무것도 첨부하지 않는다', () => {
        const { out } = run('일반 답변입니다.', null);
        expect(out).toBe('일반 답변입니다.');
    });
});
