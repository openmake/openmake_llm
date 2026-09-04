/** 도구 결과 언어 리마인더·답변 언어 가드 — 순수 함수 회귀 (2026-09-05) */
import { targetScriptRatio, shouldAppendLanguageNote, withLanguageNote, detectAnswerLanguageMismatch, scriptKeyFor } from '../tool-result-language';
import { TOOL_RESULT_LANGUAGE_NOTE } from '../../../config/runtime-limits';

const EN_DOC = ('Route Handlers allow you to create custom request handlers for a given route using the Web Request and Response APIs. ').repeat(4);
const KO_DOC = ('라우트 핸들러는 웹 요청과 응답 객체를 사용해 특정 경로의 요청 처리기를 만듭니다. 파일 위치는 앱 폴더 아래이며 내보내기 함수 이름이 메서드가 됩니다. ').repeat(4);

describe('scriptKeyFor', () => {
    it('ko/ja/zh 는 고유 문자 체계, 라틴 계열은 latin', () => {
        expect(scriptKeyFor('ko')).toBe('ko');
        expect(scriptKeyFor('ja-JP')).toBe('ja');
        expect(scriptKeyFor('en')).toBe('latin');
        expect(scriptKeyFor('de')).toBe('latin');
    });
});

describe('targetScriptRatio', () => {
    it('한국어 본문의 ko 비율은 높고, 영문 본문의 ko 비율은 0 에 가깝다', () => {
        expect(targetScriptRatio(KO_DOC, 'ko')!).toBeGreaterThan(0.7);
        expect(targetScriptRatio(EN_DOC, 'ko')!).toBeLessThan(0.05);
    });
    it('코드블록·URL·아티팩트 참조는 판정에서 제외한다', () => {
        const mixed = '결과입니다.\n```ts\nexport async function GET() { return Response.json({ ok: true }) }\n```\nhttps://example.com/docs [[artifact:auto-1]]';
        expect(targetScriptRatio(mixed, 'ko')!).toBeGreaterThan(0.9);
    });
    it('판정 가능한 글자가 없으면 null', () => {
        expect(targetScriptRatio('123 ... !!!', 'ko')).toBeNull();
    });
});

describe('shouldAppendLanguageNote / withLanguageNote', () => {
    it('긴 영문 도구 결과 + 대상 ko → 리마인더 부착', () => {
        expect(shouldAppendLanguageNote(EN_DOC, 'ko')).toBe(true);
        expect(withLanguageNote(EN_DOC, 'ko')).toContain('반드시 한국어로');
    });
    it('한국어 도구 결과엔 붙이지 않는다', () => {
        expect(shouldAppendLanguageNote(KO_DOC, 'ko')).toBe(false);
        expect(withLanguageNote(KO_DOC, 'ko')).toBe(KO_DOC);
    });
    it(`MIN_RESULT_CHARS(${TOOL_RESULT_LANGUAGE_NOTE.MIN_RESULT_CHARS}) 미만의 짧은 영문 결과(ok/JSON)엔 붙이지 않는다`, () => {
        expect(shouldAppendLanguageNote('{"ok":true,"path":"nim-test.txt"}', 'ko')).toBe(false);
    });
    it('대상 언어 미지정이면 원문 그대로', () => {
        expect(withLanguageNote(EN_DOC, undefined)).toBe(EN_DOC);
    });
    it('대상이 영어면 한국어 도구 결과에 영어 리마인더', () => {
        expect(withLanguageNote(KO_DOC, 'en')).toContain('Write the final answer in English');
    });
});

describe('detectAnswerLanguageMismatch', () => {
    it('한국어 질문(target ko)에 영어 답변 → true', () => {
        expect(detectAnswerLanguageMismatch(EN_DOC, 'ko')).toBe(true);
    });
    it('한국어 답변 → false, 짧은 답변 → false, target 미지정 → false', () => {
        expect(detectAnswerLanguageMismatch(KO_DOC, 'ko')).toBe(false);
        expect(detectAnswerLanguageMismatch('OK done.', 'ko')).toBe(false);
        expect(detectAnswerLanguageMismatch(EN_DOC, undefined)).toBe(false);
    });
    it('코드 위주 한국어 답변은 코드블록 제외 후 판정 → false', () => {
        const a = '아래 예제를 참고하세요. 핸들러는 app/api/hello/route.ts 에 두고 GET 을 내보내면 됩니다. 응답은 JSON 입니다.\n```ts\n' + 'export async function GET() { return Response.json({ message: "Hello World" }) }\n'.repeat(5) + '```';
        expect(detectAnswerLanguageMismatch(a, 'ko')).toBe(false);
    });
});
