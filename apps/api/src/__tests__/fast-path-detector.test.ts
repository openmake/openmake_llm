import { detectFastPath } from '../chat/fast-path-detector';

describe('detectFastPath', () => {
    describe('매칭되어야 하는 케이스 (fast-path)', () => {
        const cases: Array<[string, string]> = [
            ['안녕', 'greeting'],
            ['안녕!', 'greeting'],
            ['안녕하세요', 'greeting'],
            ['hi', 'greeting'],
            ['Hello!', 'greeting'],
            ['좋은 아침', 'greeting'],
            ['고마워', 'thanks'],
            ['감사합니다', 'thanks'],
            ['thanks!', 'thanks'],
            ['네', 'affirmation'],
            ['아니요', 'negation'],
            ['누구야?', 'meta_identity'],
            ['넌 뭐야', 'meta_identity'],
            ['지금 몇 시야?', 'time_query'],
            ['오늘 며칠?', 'date_query'],
        ];
        test.each(cases)('"%s" → matched=true (reason=%s)', (query, expectedReason) => {
            const result = detectFastPath(query);
            expect(result.matched).toBe(true);
            expect(result.reason).toBe(expectedReason);
        });
    });

    describe('매칭되면 안 되는 케이스 (thinking 필요)', () => {
        const cases: string[] = [
            '양자역학이란 무엇인가?',         // 짧지만 깊이 필요
            '1+1은?',                         // 사실 질문이지만 추론 가능성
            '안녕, 코드 리뷰 해줄래?',        // 인사 + 작업 요청
            '왜 하늘은 파란가요?',            // 인과 질문
            '파이썬으로 정렬 알고리즘 만들어줘', // 작업 요청
            '안녕 코드',                       // 모호함 — false positive 회피
            '',                               // 빈 문자열
            '   ',                            // 공백만
            'a',                              // 너무 짧음
        ];
        test.each(cases.map(c => [c]))('"%s" → matched=false', (query) => {
            const result = detectFastPath(query);
            expect(result.matched).toBe(false);
        });
    });

    describe('경계 조건', () => {
        test('null/undefined 입력 — matched=false', () => {
            expect(detectFastPath(null as unknown as string).matched).toBe(false);
            expect(detectFastPath(undefined as unknown as string).matched).toBe(false);
        });

        test('50자 초과 인사 — matched=false (긴 메시지는 thinking 가능성)', () => {
            const longGreeting = '안녕'.repeat(20);  // 60자
            expect(detectFastPath(longGreeting).matched).toBe(false);
        });
    });
});
