import { verifyArtifact } from '../artifact-verifier';

describe('verifyArtifact — JSON', () => {
    it('정상 JSON → valid', () => {
        const r = verifyArtifact({ lang: 'json', content: '{"a":1,"b":[2,3]}' });
        expect(r.checked).toBe(true);
        expect(r.valid).toBe(true);
    });
    it('깨진 JSON → invalid + issue', () => {
        const r = verifyArtifact({ lang: 'json', content: '{"a":1,}' });
        expect(r.checked).toBe(true);
        expect(r.valid).toBe(false);
        expect(r.issues.length).toBeGreaterThan(0);
    });
});

describe('verifyArtifact — 괄호 균형 (js/ts/css)', () => {
    it('균형 잡힌 JS → valid', () => {
        const r = verifyArtifact({ lang: 'js', content: 'function f(a){ return [a, {x:1}]; }' });
        expect(r.valid).toBe(true);
    });
    it('닫히지 않은 중괄호 → invalid', () => {
        const r = verifyArtifact({ lang: 'ts', content: 'function f() { if (x) { return 1;' });
        expect(r.valid).toBe(false);
        expect(r.issues[0]).toContain('닫히지 않은 괄호');
    });
    it('문자열 안의 괄호는 무시', () => {
        const r = verifyArtifact({ lang: 'js', content: 'const s = "){}(";' });
        expect(r.valid).toBe(true);
    });
    it('주석 안의 괄호는 무시', () => {
        const r = verifyArtifact({ lang: 'js', content: '// ){}\n/* ]]] */\nconst a = 1;' });
        expect(r.valid).toBe(true);
    });
    it('백틱 템플릿(멀티라인) 허용', () => {
        const r = verifyArtifact({ lang: 'ts', content: 'const t = `line1\nline2 ${x}`;\nfoo();' });
        expect(r.valid).toBe(true);
    });
    it('닫히지 않은 문자열 → invalid', () => {
        const r = verifyArtifact({ lang: 'js', content: 'const s = "unterminated;\nconst b = 2;' });
        expect(r.valid).toBe(false);
        expect(r.issues[0]).toContain('닫히지 않은 문자열');
    });
    it('CSS 균형 → valid', () => {
        const r = verifyArtifact({ lang: 'css', content: '.a{color:red} .b{margin:0}' });
        expect(r.valid).toBe(true);
    });
});

describe('verifyArtifact — HTML 태그 균형', () => {
    it('균형 잡힌 HTML → valid', () => {
        const r = verifyArtifact({ lang: 'html', content: '<div><p>hi</p><br><img src="x"></div>' });
        expect(r.checked).toBe(true);
        expect(r.valid).toBe(true);
    });
    it('닫히지 않은 div → invalid', () => {
        const r = verifyArtifact({ lang: 'html', content: '<div><p>hi</p>' });
        expect(r.valid).toBe(false);
        expect(r.issues[0]).toContain('닫히지 않은 태그');
    });
    it('대응 없는 닫는 태그 → invalid', () => {
        const r = verifyArtifact({ lang: 'html', content: '<p>hi</span>' });
        expect(r.valid).toBe(false);
    });
    it('script 내부의 < 는 오탐하지 않음', () => {
        const r = verifyArtifact({ lang: 'html', content: '<div><script>if(a<b){}</script></div>' });
        expect(r.valid).toBe(true);
    });
    it('자기 닫힘 태그 허용', () => {
        const r = verifyArtifact({ lang: 'html', content: '<div><input/><hr/></div>' });
        expect(r.valid).toBe(true);
    });
});

describe('verifyArtifact — 미지원/엣지', () => {
    it('지원 밖 언어 → checked=false, valid=true(비차단)', () => {
        const r = verifyArtifact({ lang: 'python', content: 'def f(:\n  pass' });
        expect(r.checked).toBe(false);
        expect(r.valid).toBe(true);
    });
    it('빈 콘텐츠 → 비차단 통과', () => {
        const r = verifyArtifact({ lang: 'json', content: '   ' });
        expect(r.checked).toBe(false);
        expect(r.valid).toBe(true);
    });
    it('kind=json 으로도 검증', () => {
        const r = verifyArtifact({ kind: 'json', lang: null, content: '{bad}' });
        expect(r.checked).toBe(true);
        expect(r.valid).toBe(false);
    });
});
