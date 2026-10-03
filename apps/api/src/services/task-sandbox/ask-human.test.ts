import { normalizeAskHuman } from './ask-human';

describe('ask_human 인자 정규화', () => {
    it('문자열 하나짜리 호출은 그대로다', () => {
        expect(normalizeAskHuman({ question: '계속할까요?' })).toEqual({ question: '계속할까요?' });
    });

    it('질문 여러 개·선택지·권장안을 구조로 남기고, 줄글 질문도 함께 만든다', () => {
        const out = normalizeAskHuman({
            questions: [
                { question: '어느 리전을 쓸까요?', options: ['서울', '도쿄'], recommended: '서울' },
                { question: '예산 상한은요?' },
            ],
        });
        expect(out.questions).toEqual([
            { question: '어느 리전을 쓸까요?', options: ['서울', '도쿄'], recommended: '서울' },
            { question: '예산 상한은요?' },
        ]);
        expect(out.question).toContain('1) 어느 리전을 쓸까요?');
        expect(out.question).toContain('서울');
        expect(out.question).toContain('도쿄');
        expect(out.question).toContain('권장: 서울');
        expect(out.question).toContain('2) 예산 상한은요?');
    });

    it('question 과 questions 를 함께 주면 question 은 머리말이 된다', () => {
        const out = normalizeAskHuman({ question: '배포 전에 확인이 필요합니다.', questions: [{ question: '진행할까요?', options: ['예', '아니오'] }] });
        expect(out.question.startsWith('배포 전에 확인이 필요합니다.')).toBe(true);
        expect(out.question).toContain('진행할까요?');
        expect(out.questions).toHaveLength(1);
        expect(out.intro).toBe('배포 전에 확인이 필요합니다.');
    });

    it('선택지 없는 질문 하나는 문자열 호출과 같다', () => {
        expect(normalizeAskHuman({ questions: [{ question: '이름은요?' }] })).toEqual({ question: '이름은요?' });
        expect(normalizeAskHuman({ questions: ['이름은요?'] })).toEqual({ question: '이름은요?' });
    });

    it('선택지에 없는 권장안은 버리고, 빈 질문·빈 선택지는 뺀다', () => {
        const out = normalizeAskHuman({ questions: [{ question: ' ', options: ['a'] }, { question: '색은?', options: ['빨강', '', 3, '파랑'], recommended: '초록' }] });
        expect(out.questions).toEqual([{ question: '색은?', options: ['빨강', '파랑'] }]);
    });

    it('개수 상한을 넘는 질문·선택지는 잘라 낸다', () => {
        const out = normalizeAskHuman({
            questions: Array.from({ length: 9 }, (_, i) => ({ question: `q${i}`, options: Array.from({ length: 12 }, (_, j) => `o${j}`) })),
        });
        expect(out.questions).toHaveLength(5);
        expect(out.questions![0].options).toHaveLength(6);
    });

    it('questions 가 쓸 수 없는 모양이면 question 만 쓴다', () => {
        expect(normalizeAskHuman({ question: 'q', questions: 'oops' })).toEqual({ question: 'q' });
        expect(normalizeAskHuman({ question: 'q', questions: [{}] })).toEqual({ question: 'q' });
        expect(normalizeAskHuman({})).toEqual({ question: '' });
    });

    it('끄면 questions 를 무시한다', () => {
        expect(normalizeAskHuman({ question: 'q', questions: [{ question: 'a', options: ['x', 'y'] }] }, false)).toEqual({ question: 'q' });
    });
});
