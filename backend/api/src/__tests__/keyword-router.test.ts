/**
 * keyword-router.ts 단위 테스트
 * detectPhase() 순수함수 검증
 * (routeToAgent는 LLM/DB 의존성으로 별도 통합 테스트 필요)
 */

// logger mock
jest.mock('../utils/logger', () => ({
    createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    }),
}));

// agent-data, topic-analyzer, llm-router mock (routeToAgent 테스트 제외)
jest.mock('../agents/agent-data', () => ({
    AGENTS: {},
    industryData: {},
    getAgentById: jest.fn().mockReturnValue(null),
}));
jest.mock('../agents/topic-analyzer', () => ({
    analyzeTopicIntent: jest.fn().mockReturnValue({
        matchedCategories: [],
        suggestedAgents: [],
        confidence: 0,
    }),
}));
jest.mock('../agents/llm-router', () => ({
    routeWithLLM: jest.fn().mockResolvedValue(null),
    isValidAgentId: jest.fn().mockReturnValue(false),
}));

import { detectPhase } from '../agents/keyword-router';

describe('detectPhase', () => {
    describe('planning 페이즈', () => {
        test('설계 키워드 → planning', () => {
            expect(detectPhase('시스템 설계를 도와줘')).toBe('planning');
        });

        test('계획 키워드 → planning', () => {
            expect(detectPhase('프로젝트 계획 세워줘')).toBe('planning');
        });

        test('분석 키워드 → planning', () => {
            expect(detectPhase('요구사항을 분석해줘')).toBe('planning');
        });

        test('어떻게 → planning', () => {
            expect(detectPhase('어떻게 하면 좋을까?')).toBe('planning');
        });

        test('방법 → planning', () => {
            expect(detectPhase('좋은 방법이 있나요?')).toBe('planning');
        });

        test('plan 영어 → planning', () => {
            expect(detectPhase('help me plan this architecture')).toBe('planning');
        });

        test('analyze 영어 → planning', () => {
            expect(detectPhase('analyze the requirements please')).toBe('planning');
        });

        test('design 영어 → planning', () => {
            expect(detectPhase('design a REST API system')).toBe('planning');
        });
    });

    describe('build 페이즈', () => {
        test('구현 키워드 → build', () => {
            expect(detectPhase('이 기능을 구현해줘')).toBe('build');
        });

        test('개발 키워드 → build', () => {
            expect(detectPhase('앱 개발을 도와줘')).toBe('build');
        });

        test('만들 → build', () => {
            expect(detectPhase('버튼 컴포넌트 만들어줘')).toBe('build');
        });

        test('해줘 → build', () => {
            expect(detectPhase('코드 짜줘 해줘')).toBe('build');
        });

        test('implement 영어 → build', () => {
            expect(detectPhase('implement the login feature')).toBe('build');
        });

        test('build 영어 → build', () => {
            expect(detectPhase('build this component')).toBe('build');
        });

        test('create 영어 → build', () => {
            expect(detectPhase('create a new endpoint')).toBe('build');
        });
    });

    describe('optimization 페이즈', () => {
        test('최적화 키워드 → optimization', () => {
            expect(detectPhase('성능 최적화가 필요합니다')).toBe('optimization');
        });
        test('개선 키워드 → optimization', () => {
            expect(detectPhase('코드 개선이 필요합니다')).toBe('optimization');
        });
        test('리팩토링 → optimization', () => {
            expect(detectPhase('이 코드 리팩토링이 필요합니다')).toBe('optimization');
        });

        test('성능 → optimization', () => {
            expect(detectPhase('성능이 너무 느려요')).toBe('optimization');
        });

        test('optimize 영어 → optimization', () => {
            expect(detectPhase('optimize this database query')).toBe('optimization');
        });

        test('improve 영어 → optimization', () => {
            expect(detectPhase('improve the code quality')).toBe('optimization');
        });

        test('refactor 영어 → optimization', () => {
            expect(detectPhase('refactor this function')).toBe('optimization');
        });
    });

    describe('기본값 (planning)', () => {
        test('아무 키워드 없는 일반 문장 → planning (기본)', () => {
            expect(detectPhase('안녕하세요')).toBe('planning');
        });

        test('빈 문자열 → planning', () => {
            expect(detectPhase('')).toBe('planning');
        });

        test('무관한 영어 → planning', () => {
            expect(detectPhase('hello world')).toBe('planning');
        });
    });

    describe('우선순위 (planning > build > optimization)', () => {
        test('planning과 build 키워드 혼재 → planning 우선', () => {
            // 설계 (planning) + 구현 (build) 혼재
            expect(detectPhase('설계하고 구현해줘')).toBe('planning');
        });

        test('planning과 optimization 키워드 혼재 → planning 우선', () => {
            expect(detectPhase('분석하고 최적화해줘')).toBe('planning');
        });
    });
});
