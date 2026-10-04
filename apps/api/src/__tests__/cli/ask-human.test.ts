/** CLI 구조화 질문 보조(apps/cli/src/ask-human.ts) — 승인 인자에서 질문 구조를 읽고, 번호 목록을 만들고, 입력을 해석한다. */
// apps/api tsconfig rootDir 밖 파일이라 require 로 런타임만 불러온다(ts-jest 가 변환)
export {};
type Q = { question: string; options?: string[]; recommended?: string };
type Picked = { ok: true; answer: string } | { ok: false; message: string };
const lib = require('../../../../cli/src/ask-human') as {
    structuredQuestions: (toolName: string, args?: unknown) => { intro: string; questions: Q[] } | null;
    approvalQuestionText: (args?: unknown) => string;
    renderQuestion: (q: Q, index: number, total: number) => string;
    renderInputHint: (q: Q) => string;
    interpretAnswer: (q: Q, input: string) => Picked;
    composeAnswer: (questions: readonly Q[], picks: readonly string[]) => string;
};

const region: Q = { question: '어느 리전을 쓸까요?', options: ['서울', '도쿄', '싱가포르'], recommended: '도쿄' };
const budget: Q = { question: '예산 상한은요?' };
const noRec: Q = { question: 'DB 는요?', options: ['Postgres', 'SQLite'] };

describe('cli ask-human — 구조 읽기', () => {
    const args = { question: '줄글', intro: '배포 전 확인', questions: [region, budget] };
    it('ask_human 인자의 questions 를 읽는다', () => {
        expect(lib.structuredQuestions('ask_human', args)).toEqual({ intro: '배포 전 확인', questions: [region, budget] });
    });
    it('구조가 없거나(옛 서버) 모양이 다르거나 다른 도구면 null — 종전 표시로 떨어진다', () => {
        expect(lib.structuredQuestions('ask_human', { question: '진행할까요?' })).toBeNull();
        expect(lib.structuredQuestions('ask_human', undefined)).toBeNull();
        expect(lib.structuredQuestions('ask_human', { questions: [] })).toBeNull();
        expect(lib.structuredQuestions('ask_human', { questions: [{ options: ['a'] }] })).toBeNull();
        expect(lib.structuredQuestions('ask_human', { questions: 'x' })).toBeNull();
        expect(lib.structuredQuestions('shell', args)).toBeNull();
    });
    it('선택지에 없는 권장안과 글이 아닌 선택지는 버린다', () => {
        const got = lib.structuredQuestions('ask_human', { questions: [{ question: 'q', options: ['a', 3, ''], recommended: 'z' }] });
        expect(got).toEqual({ intro: '', questions: [{ question: 'q', options: ['a'] }] });
    });
    it('줄글 질문은 인자의 question 에서 읽는다(없으면 빈 글)', () => {
        expect(lib.approvalQuestionText({ question: ' 진행할까요? ' })).toBe('진행할까요?');
        expect(lib.approvalQuestionText({ command: 'ls' })).toBe('');
        expect(lib.approvalQuestionText(undefined)).toBe('');
    });
});

describe('cli ask-human — 표시', () => {
    it('선택지를 번호 목록으로, 권장안에 표시를 붙인다', () => {
        expect(lib.renderQuestion(region, 0, 1)).toBe('어느 리전을 쓸까요?\n  1) 서울\n  2) 도쿄 (권장)\n  3) 싱가포르');
    });
    it('질문이 여럿이면 순번을 앞에 붙인다', () => {
        expect(lib.renderQuestion(budget, 1, 2)).toBe('[2/2] 예산 상한은요?');
    });
    it('터미널 제어 문자는 지운다(모델이 쓴 글이다)', () => {
        expect(lib.renderQuestion({ question: 'a\x1b[2Jb', options: ['x\x07y'] }, 0, 1)).toBe('a[2Jb\n  1) xy');
    });
    it('입력 안내 — 선택지·권장안 유무에 따라 다르다', () => {
        expect(lib.renderInputHint(region)).toBe('번호(1-3) 또는 직접 입력, Enter=권장안: ');
        expect(lib.renderInputHint(noRec)).toBe('번호(1-2) 또는 직접 입력: ');
        expect(lib.renderInputHint(budget)).toBe('답변 입력: ');
    });
});

describe('cli ask-human — 입력 해석', () => {
    it('번호는 그 선택지로', () => {
        expect(lib.interpretAnswer(region, '1')).toEqual({ ok: true, answer: '서울' });
        expect(lib.interpretAnswer(region, ' 3 ')).toEqual({ ok: true, answer: '싱가포르' });
    });
    it('빈 입력은 권장안으로, 권장안이 없으면 다시 묻는다', () => {
        expect(lib.interpretAnswer(region, '')).toEqual({ ok: true, answer: '도쿄' });
        expect(lib.interpretAnswer(noRec, '  ').ok).toBe(false);
        expect(lib.interpretAnswer(budget, '').ok).toBe(false);
    });
    it('범위를 벗어난 번호는 다시 묻는다', () => {
        expect(lib.interpretAnswer(region, '0').ok).toBe(false);
        expect(lib.interpretAnswer(region, '4').ok).toBe(false);
    });
    it('그 밖의 글은 직접 입력한 답이다', () => {
        expect(lib.interpretAnswer(region, '프랑크푸르트')).toEqual({ ok: true, answer: '프랑크푸르트' });
        expect(lib.interpretAnswer(region, '2개 리전 모두')).toEqual({ ok: true, answer: '2개 리전 모두' });
    });
    it('선택지가 없는 질문은 숫자도 답 그대로다', () => {
        expect(lib.interpretAnswer(budget, '100')).toEqual({ ok: true, answer: '100' });
    });
});

describe('cli ask-human — 답 엮기(웹 composeStructuredAnswer 와 같은 모양)', () => {
    it('질문이 하나면 답 그대로, 여럿이면 순번을 붙여 한 글로', () => {
        expect(lib.composeAnswer([region], ['서울'])).toBe('서울');
        expect(lib.composeAnswer([region, budget], ['서울', '월 100만원'])).toBe('1) 서울; 2) 월 100만원');
    });
    it('웹과 같은 글이 나온다', () => {
        const web = require('../../../../web/lib/hitl-question') as { composeStructuredAnswer: (q: readonly Q[], p: Record<number, string>) => string };
        expect(lib.composeAnswer([region, budget], ['서울', '월 100만원'])).toBe(web.composeStructuredAnswer([region, budget], { 0: '서울', 1: '월 100만원' }));
    });
});
