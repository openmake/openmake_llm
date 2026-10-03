/** 웹 구조화 질문 보조(apps/web/lib/hitl-question.ts) — 승인 인자에서 질문 구조를 읽고, 고른 답을 글 하나로 엮는다. */
// apps/api tsconfig rootDir 밖 파일이라 require 로 런타임만 불러온다(ts-jest 가 변환)
export {};
type Q = { question: string; options?: string[]; recommended?: string };
const lib = require('../../../../web/lib/hitl-question') as {
    structuredQuestions: (toolName: string, args?: Record<string, unknown>) => { intro: string; questions: Q[] } | null;
    composeStructuredAnswer: (questions: readonly Q[], picks: Readonly<Record<number, string>>) => string;
};

describe('web hitl-question — 구조화 질문', () => {
    const args = {
        question: '배포 전 확인\n1) 어느 리전을 쓸까요? — 선택지: 서울 / 도쿄 (권장: 서울)\n2) 예산 상한은요?',
        intro: '배포 전 확인',
        questions: [{ question: '어느 리전을 쓸까요?', options: ['서울', '도쿄'], recommended: '서울' }, { question: '예산 상한은요?' }],
    };

    it('ask_human 인자의 questions 를 읽는다', () => {
        expect(lib.structuredQuestions('ask_human', args)).toEqual({ intro: '배포 전 확인', questions: args.questions });
    });

    it('구조가 없거나 모양이 다르면 null — 종전 문자열 표시로 떨어진다', () => {
        expect(lib.structuredQuestions('ask_human', { question: '계속할까요?' })).toBeNull();
        expect(lib.structuredQuestions('ask_human', { question: 'q', questions: 'oops' })).toBeNull();
        expect(lib.structuredQuestions('ask_human', { question: 'q', questions: [{ nope: 1 }] })).toBeNull();
        expect(lib.structuredQuestions('ask_human', undefined)).toBeNull();
        expect(lib.structuredQuestions('mcp_elicit', args)).toBeNull();
        expect(lib.structuredQuestions('bash', args)).toBeNull();
    });

    it('문자열이 아닌 선택지는 버린다', () => {
        const out = lib.structuredQuestions('ask_human', { question: 'q', questions: [{ question: '색은?', options: ['빨강', 3, null] }] });
        expect(out?.questions).toEqual([{ question: '색은?', options: ['빨강'] }]);
    });

    it('질문이 하나면 고른 답 그대로, 여럿이면 번호를 붙여 한 줄로 엮는다', () => {
        expect(lib.composeStructuredAnswer([args.questions[0]], { 0: '도쿄' })).toBe('도쿄');
        expect(lib.composeStructuredAnswer(args.questions, { 0: '서울', 1: '월 10만원' })).toBe('1) 서울; 2) 월 10만원');
        expect(lib.composeStructuredAnswer(args.questions, { 1: '월 10만원' })).toBe('2) 월 10만원');
        expect(lib.composeStructuredAnswer(args.questions, {})).toBe('');
    });
});
