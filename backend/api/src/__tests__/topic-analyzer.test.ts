/**
 * topic-analyzer.test.ts
 * analyzeTopicIntent, TOPIC_CATEGORIES 단위 테스트
 */

import { analyzeTopicIntent, TOPIC_CATEGORIES } from '../agents/topic-analyzer';

describe('TOPIC_CATEGORIES 구조', () => {
    test('17개 카테고리가 정의되어 있다', () => {
        expect(TOPIC_CATEGORIES).toHaveLength(17);
    });

    test('각 카테고리에 name, patterns, relatedAgents, expansionKeywords 필드 존재', () => {
        for (const category of TOPIC_CATEGORIES) {
            expect(typeof category.name).toBe('string');
            expect(Array.isArray(category.patterns)).toBe(true);
            expect(category.patterns.length).toBeGreaterThan(0);
            expect(Array.isArray(category.relatedAgents)).toBe(true);
            expect(category.relatedAgents.length).toBeGreaterThan(0);
            expect(Array.isArray(category.expansionKeywords)).toBe(true);
        }
    });

    test('모든 카테고리 이름이 고유하다', () => {
        const names = TOPIC_CATEGORIES.map(c => c.name);
        const unique = new Set(names);
        expect(unique.size).toBe(names.length);
    });

    test('각 카테고리의 패턴은 RegExp 인스턴스다', () => {
        for (const category of TOPIC_CATEGORIES) {
            for (const pattern of category.patterns) {
                expect(pattern).toBeInstanceOf(RegExp);
            }
        }
    });

    test('17개 기대 카테고리명 포함', () => {
        const names = TOPIC_CATEGORIES.map(c => c.name);
        expect(names).toContain('프로그래밍/개발');
        expect(names).toContain('비즈니스/창업');
        expect(names).toContain('금융/투자');
        expect(names).toContain('법률/계약');
        expect(names).toContain('의료/건강');
        expect(names).toContain('교육/학습');
        expect(names).toContain('디자인/크리에이티브');
        expect(names).toContain('데이터/AI');
        expect(names).toContain('엔지니어링');
        expect(names).toContain('과학/연구');
        expect(names).toContain('미디어/커뮤니케이션');
        expect(names).toContain('공공/정부');
        expect(names).toContain('부동산');
        expect(names).toContain('에너지/환경');
        expect(names).toContain('물류/운송');
        expect(names).toContain('관광/호스피탈리티');
        expect(names).toContain('농업/식품');
    });
});

describe('analyzeTopicIntent', () => {
    describe('반환 구조', () => {
        test('matchedCategories, suggestedAgents, confidence 필드 반환', () => {
            const result = analyzeTopicIntent('코딩 도움 주세요');
            expect(Array.isArray(result.matchedCategories)).toBe(true);
            expect(Array.isArray(result.suggestedAgents)).toBe(true);
            expect(typeof result.confidence).toBe('number');
        });

        test('confidence는 0~1 범위', () => {
            const result = analyzeTopicIntent('프로그래밍 API 서버 코딩');
            expect(result.confidence).toBeGreaterThanOrEqual(0);
            expect(result.confidence).toBeLessThanOrEqual(1);
        });
    });

    describe('프로그래밍/개발 카테고리 매칭', () => {
        test('코드 키워드 → 프로그래밍/개발 카테고리 매칭', () => {
            const result = analyzeTopicIntent('코드 버그 오류 수정');
            expect(result.matchedCategories).toContain('프로그래밍/개발');
        });

        test('API 서버 키워드 → 프로그래밍/개발', () => {
            const result = analyzeTopicIntent('api 서버 백엔드 개발');
            expect(result.matchedCategories).toContain('프로그래밍/개발');
        });

        test('파이썬/자바스크립트 키워드 → 프로그래밍/개발', () => {
            const result = analyzeTopicIntent('python javascript 리액트');
            expect(result.matchedCategories).toContain('프로그래밍/개발');
        });

        test('관련 에이전트 반환', () => {
            const result = analyzeTopicIntent('코드 개발 프로그램');
            expect(result.suggestedAgents.length).toBeGreaterThan(0);
        });
    });

    describe('비즈니스/창업 카테고리 매칭', () => {
        test('사업 마케팅 → 비즈니스/창업', () => {
            const result = analyzeTopicIntent('사업 창업 마케팅 전략');
            expect(result.matchedCategories).toContain('비즈니스/창업');
        });

        test('회사 직원 채용 → 비즈니스/창업', () => {
            const result = analyzeTopicIntent('회사 직원 채용 인사');
            expect(result.matchedCategories).toContain('비즈니스/창업');
        });
    });

    describe('금융/투자 카테고리 매칭', () => {
        test('주식 투자 → 금융/투자', () => {
            const result = analyzeTopicIntent('주식 투자 포트폴리오');
            expect(result.matchedCategories).toContain('금융/투자');
        });

        test('세금 대출 이자 → 금융/투자', () => {
            const result = analyzeTopicIntent('세금 대출 이자 금리');
            expect(result.matchedCategories).toContain('금융/투자');
        });
    });

    describe('의료/건강 카테고리 매칭', () => {
        test('건강 병원 진료 → 의료/건강', () => {
            const result = analyzeTopicIntent('건강 병원 진료 치료');
            expect(result.matchedCategories).toContain('의료/건강');
        });

        test('다이어트 운동 → 의료/건강', () => {
            const result = analyzeTopicIntent('다이어트 운동 체중');
            expect(result.matchedCategories).toContain('의료/건강');
        });
    });

    describe('교육/학습 카테고리 매칭', () => {
        test('공부 시험 → 교육/학습', () => {
            const result = analyzeTopicIntent('공부 시험 학습');
            expect(result.matchedCategories).toContain('교육/학습');
        });

        test('토익 면접 이력서 → 교육/학습', () => {
            const result = analyzeTopicIntent('토익 면접 이력서');
            expect(result.matchedCategories).toContain('교육/학습');
        });
    });

    describe('디자인/크리에이티브 카테고리 매칭', () => {
        test('UI UX 디자인 → 디자인/크리에이티브', () => {
            const result = analyzeTopicIntent('UI UX 디자인 그래픽');
            expect(result.matchedCategories).toContain('디자인/크리에이티브');
        });

        test('figma canva → 디자인/크리에이티브', () => {
            const result = analyzeTopicIntent('figma canva 포스터');
            expect(result.matchedCategories).toContain('디자인/크리에이티브');
        });
    });

    describe('데이터/AI 카테고리 매칭', () => {
        test('AI 머신러닝 → 데이터/AI', () => {
            const result = analyzeTopicIntent('AI 머신러닝 딥러닝');
            expect(result.matchedCategories).toContain('데이터/AI');
        });

        test('데이터 분석 통계 → 데이터/AI', () => {
            const result = analyzeTopicIntent('데이터 분석 통계 차트');
            expect(result.matchedCategories).toContain('데이터/AI');
        });
    });

    describe('매칭 없는 경우', () => {
        test('무관한 문자열 → matchedCategories 빈 배열', () => {
            const result = analyzeTopicIntent('안녕하세요 좋은 하루 되세요');
            expect(result.matchedCategories).toHaveLength(0);
            expect(result.suggestedAgents).toHaveLength(0);
            expect(result.confidence).toBe(0);
        });

        test('빈 문자열 → 빈 결과', () => {
            const result = analyzeTopicIntent('');
            expect(result.matchedCategories).toHaveLength(0);
            expect(result.confidence).toBe(0);
        });
    });

    describe('다중 카테고리 매칭', () => {
        test('여러 카테고리 키워드 포함 시 여러 카테고리 반환', () => {
            // 프로그래밍 + 데이터/AI 혼합
            const result = analyzeTopicIntent('코드 AI 머신러닝 개발');
            expect(result.matchedCategories.length).toBeGreaterThan(1);
        });

        test('suggestedAgents는 중복 없이 반환', () => {
            const result = analyzeTopicIntent('코드 AI 머신러닝 개발');
            const ids = result.suggestedAgents;
            const unique = new Set(ids);
            expect(unique.size).toBe(ids.length);
        });
    });

    describe('confidence 계산', () => {
        test('매칭 패턴이 많을수록 confidence가 높다', () => {
            const few = analyzeTopicIntent('코드');
            const many = analyzeTopicIntent('코드 버그 api 서버 데이터베이스 파이썬');
            expect(many.confidence).toBeGreaterThanOrEqual(few.confidence);
        });

        test('confidence는 최대 1.0', () => {
            // 수십 개 패턴이 매칭돼도 1.0을 초과하지 않음
            const result = analyzeTopicIntent(
                '코드 버그 오류 api 서버 백엔드 프론트 파이썬 리액트 자바 크롤링 함수 클래스 변수 개발 프로그램 앱 데이터베이스'
            );
            expect(result.confidence).toBeLessThanOrEqual(1.0);
        });
    });

    describe('컨텍스트 포함 분석', () => {
        test('컨텍스트 포함 시 분류 정확도 향상 — 추가 패턴 매칭 가능', () => {
            const withContext = analyzeTopicIntent('도움 주세요\n\n컨텍스트: 코드 버그 api 서버');
            expect(withContext.matchedCategories).toContain('프로그래밍/개발');
        });
    });
});
