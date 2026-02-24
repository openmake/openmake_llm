/**
 * query-classifier.ts 단위 테스트
 * classifyQuery() — 9가지 QueryType 분류 로직 검증
 */

import { classifyQuery } from '../chat/query-classifier';

describe('classifyQuery', () => {
    describe('code 분류', () => {
        test('코드 블록 포함 → code', () => {
            const result = classifyQuery('```js\nconst x = 1;\n```');
            expect(result.type).toBe('code');
        });

        test('JS 키워드 포함 → code', () => {
            const result = classifyQuery('function hello() { return "world"; }');
            expect(result.type).toBe('code');
        });

        test('에러 스택 트레이스 → code', () => {
            const result = classifyQuery('TypeError at getUser (app.ts:42:15)');
            expect(result.type).toBe('code');
        });

        test('SQL 키워드 → code', () => {
            const result = classifyQuery('SELECT * FROM users WHERE id = 1');
            expect(result.type).toBe('code');
        });

        test('한국어 코딩 키워드 → code', () => {
            const result = classifyQuery('리액트 컴포넌트 구현 방법을 알려줘');
            expect(result.type).toBe('code');
        });

        test('버그 에러 키워드 → code', () => {
            const result = classifyQuery('error bug debug this issue');
            expect(result.type).toBe('code');
        });

        test('React 키워드 → code', () => {
            const result = classifyQuery('how do I use useState hook in React?');
            expect(result.type).toBe('code');
        });

        test('TypeScript 파일 확장자 → code', () => {
            const result = classifyQuery('fix error in main.ts file');
            expect(result.type).toBe('code');
        });
    });

    describe('math 분류', () => {
        test('수식 패턴 → math', () => {
            const result = classifyQuery('2 + 3 * 4 = ?');
            expect(result.type).toBe('math');
        });

        test('math 영어 키워드 → math', () => {
            const result = classifyQuery('calculate the integral of x^2');
            expect(result.type).toBe('math');
        });

        test('한국어 수학 키워드 → math', () => {
            const result = classifyQuery('미적분 계산 방법 알려줘');
            expect(result.type).toBe('math');
        });

        test('증명 키워드 → math', () => {
            const result = classifyQuery('prove this theorem step by step');
            expect(result.type).toBe('math');
        });
    });

    describe('translation 분류', () => {
        test('번역 키워드 → translation', () => {
            const result = classifyQuery('이 문장을 영어로 번역해줘');
            expect(result.type).toBe('translation');
        });

        test('to english 패턴 → translation', () => {
            const result = classifyQuery('translate this to english please');
            expect(result.type).toBe('translation');
        });

        test('한국어로 번역 → translation', () => {
            const result = classifyQuery('translate this paragraph to korean');
            expect(result.type).toBe('translation');
        });
    });

    describe('vision 분류', () => {
        test('[IMAGE] 메타데이터 → vision (강제)', () => {
            const result = classifyQuery('[IMAGE] what is in this picture?');
            expect(result.type).toBe('vision');
            expect(result.confidence).toBe(1.0); // 강제: min(10/4, 1.0)=1.0
        });

        test('[image_attached] 메타데이터 → vision (강제)', () => {
            const result = classifyQuery('analyze [image_attached] this diagram');
            expect(result.type).toBe('vision');
        });

        test('이미지 키워드 → vision', () => {
            const result = classifyQuery('이미지를 분석해줘');
            expect(result.type).toBe('vision');
        });
    });

    describe('document 분류', () => {
        test('요약 키워드 → document', () => {
            const result = classifyQuery('이 문서를 요약해줘');
            expect(result.type).toBe('document');
        });

        test('summarize → document', () => {
            const result = classifyQuery('summarize this report');
            expect(result.type).toBe('document');
        });
    });

    describe('analysis 분류', () => {
        test('비교 분석 키워드 → analysis', () => {
            const result = classifyQuery('두 방법의 장단점을 비교 분석해줘');
            expect(result.type).toBe('analysis');
        });

        test('analyze keyword → analysis', () => {
            const result = classifyQuery('analyze the impact of climate change');
            expect(result.type).toBe('analysis');
        });
    });

    describe('creative 분류', () => {
        test('스토리 작성 → creative', () => {
            const result = classifyQuery('짧은 이야기를 작성해줘');
            expect(result.type).toBe('creative');
        });

        test('write a poem → creative', () => {
            const result = classifyQuery('write a poem about the ocean');
            expect(result.type).toBe('creative');
        });
    });

    describe('chat 분류 (기본)', () => {
        test('안녕 인사 → chat', () => {
            const result = classifyQuery('안녕하세요');
            expect(result.type).toBe('chat');
        });

        test('hello → chat', () => {
            const result = classifyQuery('hello there');
            expect(result.type).toBe('chat');
        });
    });

    describe('confidence 계산', () => {
        test('confidence는 0~1 범위', () => {
            const result = classifyQuery('const x = require("express")');
            expect(result.confidence).toBeGreaterThanOrEqual(0);
            expect(result.confidence).toBeLessThanOrEqual(1);
        });

        test('명확한 코드 질문은 높은 confidence', () => {
            const result = classifyQuery('function add(a: number, b: number): number { return a + b; }');
            expect(result.confidence).toBeGreaterThan(0.5);
        });
    });

    describe('subType — 한국어 비율', () => {
        test('한국어 비율 30% 이상 → subType=korean', () => {
            const result = classifyQuery('이 코드를 수정하고 싶습니다 fix');
            expect(result.subType).toBe('korean');
        });

        test('영어만 → subType undefined', () => {
            const result = classifyQuery('please fix this bug in my code');
            expect(result.subType).toBeUndefined();
        });

        test('한국어 100% → subType=korean', () => {
            const result = classifyQuery('안녕하세요 저는 코딩을 배우고 싶습니다');
            expect(result.subType).toBe('korean');
        });
    });

    describe('matchedPatterns', () => {
        test('최대 5개 반환', () => {
            // 많은 코드 패턴 포함
            const result = classifyQuery('SELECT * FROM users WHERE function class const let error bug debug compile');
            expect(result.matchedPatterns.length).toBeLessThanOrEqual(5);
        });

        test('빈 query는 기본 chat 반환', () => {
            // 아무 패턴도 없으면 기본 'chat'
            const result = classifyQuery('');
            expect(result.type).toBe('chat');
            expect(result.confidence).toBe(0);
        });
    });

    describe('엣지 케이스', () => {
        test('매우 짧은 입력도 처리', () => {
            const result = classifyQuery('hi');
            expect(result).toBeDefined();
            expect(result.type).toBeTruthy();
        });

        test('특수문자만 포함된 입력', () => {
            const result = classifyQuery('!@#$%^&*()');
            expect(result).toBeDefined();
        });

        test('긴 입력도 처리', () => {
            const longInput = 'function '.repeat(500);
            const result = classifyQuery(longInput);
            expect(result.type).toBe('code');
        });
    });
});
