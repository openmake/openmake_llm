/**
 * learning.test.ts
 * AgentLearningSystem 단위 테스트
 * DB는 jest.mock으로 격리, feedbacks는 내부 배열 직접 주입
 */

// DB mock — 생성자에서 loadFromDB() 호출되므로 최상단에 위치
jest.mock('../data/models/unified-database', () => ({
    getPool: jest.fn(() => ({
        query: jest.fn().mockResolvedValue({ rows: [] })
    }))
}));

import { AgentLearningSystem, getAgentLearningSystem } from '../agents/learning';

// ============================================================
// 내부 feedbacks 배열 직접 주입 헬퍼
// ============================================================

interface InternalFeedback {
    feedbackId: string;
    agentId: string;
    userId?: string;
    rating: 1 | 2 | 3 | 4 | 5;
    comment?: string;
    query: string;
    response: string;
    timestamp: Date;
    tags?: string[];
}

function injectFeedbacks(system: AgentLearningSystem, feedbacks: InternalFeedback[]): void {
    (system as unknown as { feedbacks: InternalFeedback[] }).feedbacks = feedbacks;
}

function makeFeedback(overrides: Partial<InternalFeedback> = {}): InternalFeedback {
    return {
        feedbackId: `fb_test_${Math.random().toString(36).slice(2, 8)}`,
        agentId: 'test-agent',
        rating: 4,
        query: '테스트 질문',
        response: '테스트 응답',
        timestamp: new Date(),
        ...overrides
    };
}

// ============================================================
// describe: AgentLearningSystem
// ============================================================

describe('AgentLearningSystem', () => {
    let system: AgentLearningSystem;

    beforeEach(() => {
        system = new AgentLearningSystem();
    });

    // ----------------------------------------------------------
    // calculateQualityScore
    // ----------------------------------------------------------

    describe('calculateQualityScore()', () => {
        test('피드백이 없으면 기본값 반환: overallScore=50, avgRating=0, stable', () => {
            const score = system.calculateQualityScore('unknown-agent');
            expect(score.agentId).toBe('unknown-agent');
            expect(score.overallScore).toBe(50);
            expect(score.avgRating).toBe(0);
            expect(score.totalFeedbacks).toBe(0);
            expect(score.recentTrend).toBe('stable');
            expect(score.strengths).toEqual([]);
            expect(score.weaknesses).toEqual([]);
        });

        test('평균 평점 5점 → overallScore=100', () => {
            injectFeedbacks(system, [
                makeFeedback({ rating: 5 }),
                makeFeedback({ rating: 5 })
            ]);
            const score = system.calculateQualityScore('test-agent');
            expect(score.overallScore).toBe(100);
            expect(score.avgRating).toBe(5);
        });

        test('평균 평점 1점 → overallScore=20', () => {
            injectFeedbacks(system, [
                makeFeedback({ rating: 1 }),
                makeFeedback({ rating: 1 })
            ]);
            const score = system.calculateQualityScore('test-agent');
            expect(score.overallScore).toBe(20);
        });

        test('평균 평점 3점 → overallScore=60', () => {
            injectFeedbacks(system, [
                makeFeedback({ rating: 3 }),
                makeFeedback({ rating: 3 }),
                makeFeedback({ rating: 3 })
            ]);
            const score = system.calculateQualityScore('test-agent');
            expect(score.overallScore).toBe(60);
            expect(score.avgRating).toBe(3);
            expect(score.totalFeedbacks).toBe(3);
        });

        test('다른 에이전트 피드백은 무시됨', () => {
            injectFeedbacks(system, [
                makeFeedback({ agentId: 'other-agent', rating: 1 }),
                makeFeedback({ agentId: 'test-agent', rating: 5 })
            ]);
            const score = system.calculateQualityScore('test-agent');
            expect(score.totalFeedbacks).toBe(1);
            expect(score.avgRating).toBe(5);
        });

        test('10개 이상: 최근 5개 평균 > 이전 5개 평균 + 0.3 → improving', () => {
            const now = Date.now();
            // 이전 5개: rating=2 (오래된 것)
            const old = Array.from({ length: 5 }, (_, i) =>
                makeFeedback({ rating: 2, timestamp: new Date(now - (10 - i) * 1000) })
            );
            // 최근 5개: rating=5
            const recent = Array.from({ length: 5 }, (_, i) =>
                makeFeedback({ rating: 5, timestamp: new Date(now - i * 100) })
            );
            injectFeedbacks(system, [...old, ...recent]);
            const score = system.calculateQualityScore('test-agent');
            expect(score.recentTrend).toBe('improving');
        });

        test('10개 이상: 최근 5개 평균 < 이전 5개 평균 - 0.3 → declining', () => {
            const now = Date.now();
            // 이전 5개: rating=5
            const old = Array.from({ length: 5 }, (_, i) =>
                makeFeedback({ rating: 5, timestamp: new Date(now - (10 - i) * 1000) })
            );
            // 최근 5개: rating=2
            const recent = Array.from({ length: 5 }, (_, i) =>
                makeFeedback({ rating: 2, timestamp: new Date(now - i * 100) })
            );
            injectFeedbacks(system, [...old, ...recent]);
            const score = system.calculateQualityScore('test-agent');
            expect(score.recentTrend).toBe('declining');
        });

        test('9개 이하: 트렌드는 항상 stable', () => {
            injectFeedbacks(system, Array.from({ length: 9 }, () => makeFeedback({ rating: 5 })));
            const score = system.calculateQualityScore('test-agent');
            expect(score.recentTrend).toBe('stable');
        });

        test('태그 기반 strengths: 좋은 평점에서 bad*2 초과 → strength', () => {
            injectFeedbacks(system, [
                makeFeedback({ rating: 5, tags: ['speed'] }),
                makeFeedback({ rating: 5, tags: ['speed'] }),
                makeFeedback({ rating: 5, tags: ['speed'] }),
                // bad 1개 (speed에 대해)
                makeFeedback({ rating: 1, tags: ['speed'] })
            ]);
            // good=3, bad=1 → 3 > 1*2? No. 3 > 2 → Yes → strength
            const score = system.calculateQualityScore('test-agent');
            expect(score.strengths).toContain('speed');
            expect(score.weaknesses).not.toContain('speed');
        });

        test('태그 기반 weaknesses: 나쁜 평점에서 good*2 초과 → weakness', () => {
            injectFeedbacks(system, [
                makeFeedback({ rating: 1, tags: ['accuracy'] }),
                makeFeedback({ rating: 1, tags: ['accuracy'] }),
                makeFeedback({ rating: 1, tags: ['accuracy'] }),
                // good 1개
                makeFeedback({ rating: 5, tags: ['accuracy'] })
            ]);
            // bad=3, good=1 → 3 > 1*2? Yes → weakness
            const score = system.calculateQualityScore('test-agent');
            expect(score.weaknesses).toContain('accuracy');
            expect(score.strengths).not.toContain('accuracy');
        });

        test('avgRating은 소수점 1자리로 반올림됨', () => {
            injectFeedbacks(system, [
                makeFeedback({ rating: 4 }),
                makeFeedback({ rating: 5 }),
                makeFeedback({ rating: 3 })
            ]);
            const score = system.calculateQualityScore('test-agent');
            // (4+5+3)/3 = 4.0
            expect(score.avgRating).toBe(4);
        });
    });

    // ----------------------------------------------------------
    // analyzeFailurePatterns
    // ----------------------------------------------------------

    describe('analyzeFailurePatterns()', () => {
        test('저평가 피드백 없으면 빈 배열 반환', () => {
            injectFeedbacks(system, [
                makeFeedback({ rating: 4 }),
                makeFeedback({ rating: 5 })
            ]);
            expect(system.analyzeFailurePatterns('test-agent')).toEqual([]);
        });

        test('피드백 없으면 빈 배열 반환', () => {
            expect(system.analyzeFailurePatterns('test-agent')).toEqual([]);
        });

        test('rating<=2 피드백에서 패턴 추출 — 정보 부족 키워드 감지', () => {
            injectFeedbacks(system, [
                makeFeedback({ rating: 1, query: '정보가 부족해요', response: '모르겠습니다' }),
                makeFeedback({ rating: 2, query: '이 정보가 없네요', response: '정보 없음' })
            ]);
            const patterns = system.analyzeFailurePatterns('test-agent');
            const found = patterns.find(p => p.pattern === '정보 부족');
            expect(found).toBeDefined();
            expect(found!.count).toBeGreaterThan(0);
        });

        test('rating<=2 피드백에서 잘못된 응답 키워드 감지', () => {
            injectFeedbacks(system, [
                makeFeedback({ rating: 1, query: '이건 틀린 답이에요', response: '오류가 있습니다', comment: '잘못된 정보입니다' })
            ]);
            const patterns = system.analyzeFailurePatterns('test-agent');
            const found = patterns.find(p => p.pattern === '잘못된 응답');
            expect(found).toBeDefined();
        });

        test('rating=3 이상 피드백은 패턴 분석에서 제외', () => {
            injectFeedbacks(system, [
                makeFeedback({ rating: 3, query: '정보가 부족해요', response: '모름' })
            ]);
            expect(system.analyzeFailurePatterns('test-agent')).toEqual([]);
        });

        test('패턴은 count 내림차순 정렬됨', () => {
            injectFeedbacks(system, [
                // 잘못된 응답 2건
                makeFeedback({ rating: 1, query: '틀린 답', response: '오류' }),
                makeFeedback({ rating: 1, query: '잘못된 정보', response: '오류' }),
                // 정보 부족 1건
                makeFeedback({ rating: 1, query: '정보가 부족', response: '없음' })
            ]);
            const patterns = system.analyzeFailurePatterns('test-agent');
            // 내림차순 확인 (첫번째 count >= 두번째 count)
            for (let i = 1; i < patterns.length; i++) {
                expect(patterns[i - 1].count).toBeGreaterThanOrEqual(patterns[i].count);
            }
        });

        test('examples는 query 앞 100자까지만 저장', () => {
            const longQuery = 'A'.repeat(200);
            injectFeedbacks(system, [
                makeFeedback({ rating: 1, query: `${longQuery} 정보 부족`, response: '없음' })
            ]);
            const patterns = system.analyzeFailurePatterns('test-agent');
            patterns.forEach(p => {
                p.examples.forEach(ex => expect(ex.length).toBeLessThanOrEqual(100));
            });
        });

        test('다른 에이전트 피드백은 무시됨', () => {
            injectFeedbacks(system, [
                makeFeedback({ agentId: 'other-agent', rating: 1, query: '잘못된 답', response: '오류' })
            ]);
            expect(system.analyzeFailurePatterns('test-agent')).toEqual([]);
        });
    });

    // ----------------------------------------------------------
    // suggestPromptImprovements
    // ----------------------------------------------------------

    describe('suggestPromptImprovements()', () => {
        test('피드백 없으면 기본 reasoning 반환', () => {
            const result = system.suggestPromptImprovements('test-agent', '기존 프롬프트');
            expect(result.agentId).toBe('test-agent');
            expect(result.currentPrompt).toBe('기존 프롬프트');
            expect(result.suggestedAdditions).toBeInstanceOf(Array);
            expect(result.suggestedRemovals).toBeInstanceOf(Array);
            expect(typeof result.reasoning).toBe('string');
            expect(result.reasoning).toContain('50/100');
        });

        test('정보 부족 패턴 → 해당 개선 제안 포함', () => {
            injectFeedbacks(system, [
                makeFeedback({ rating: 1, query: '정보가 부족해요', response: '모르겠습니다' })
            ]);
            const result = system.suggestPromptImprovements('test-agent', '기존');
            const hasInfoSuggestion = result.suggestedAdditions.some(s => s.includes('추가 정보'));
            expect(hasInfoSuggestion).toBe(true);
        });

        test('잘못된 응답 패턴 → 해당 개선 제안 포함', () => {
            injectFeedbacks(system, [
                makeFeedback({ rating: 1, query: '틀렸어요', response: '오류가 있습니다' })
            ]);
            const result = system.suggestPromptImprovements('test-agent', '기존');
            const hasCorrectionSuggestion = result.suggestedAdditions.some(s => s.includes('추정'));
            expect(hasCorrectionSuggestion).toBe(true);
        });

        test('declining 트렌드 → reasoning에 하락 추세 포함', () => {
            const now = Date.now();
            const old = Array.from({ length: 5 }, (_, i) =>
                makeFeedback({ rating: 5, timestamp: new Date(now - (10 - i) * 1000) })
            );
            const recent = Array.from({ length: 5 }, (_, i) =>
                makeFeedback({ rating: 2, timestamp: new Date(now - i * 100) })
            );
            injectFeedbacks(system, [...old, ...recent]);
            const result = system.suggestPromptImprovements('test-agent', '기존');
            expect(result.reasoning).toContain('하락');
        });

        test('실패 패턴이 있으면 reasoning에 패턴명 포함', () => {
            injectFeedbacks(system, [
                makeFeedback({ rating: 1, query: '정보가 없어요', response: '모름' })
            ]);
            const result = system.suggestPromptImprovements('test-agent', '기존');
            expect(result.reasoning).toContain('주요 실패 패턴');
        });

        test('reasoning은 항상 현재 품질 점수 포함', () => {
            injectFeedbacks(system, [makeFeedback({ rating: 3 })]);
            const result = system.suggestPromptImprovements('test-agent', '기존');
            expect(result.reasoning).toMatch(/\d+\/100/);
        });
    });

    // ----------------------------------------------------------
    // getFeedbacks
    // ----------------------------------------------------------

    describe('getFeedbacks()', () => {
        test('agentId 없으면 전체 피드백 반환', () => {
            injectFeedbacks(system, [
                makeFeedback({ agentId: 'agent-a' }),
                makeFeedback({ agentId: 'agent-b' }),
                makeFeedback({ agentId: 'agent-c' })
            ]);
            const result = system.getFeedbacks();
            expect(result.length).toBe(3);
        });

        test('agentId 지정 시 해당 에이전트 피드백만 반환', () => {
            injectFeedbacks(system, [
                makeFeedback({ agentId: 'agent-a' }),
                makeFeedback({ agentId: 'agent-a' }),
                makeFeedback({ agentId: 'agent-b' })
            ]);
            const result = system.getFeedbacks('agent-a');
            expect(result.length).toBe(2);
            result.forEach(f => expect((f as InternalFeedback).agentId).toBe('agent-a'));
        });

        test('limit 기본값 50 적용', () => {
            const feedbacks = Array.from({ length: 60 }, () => makeFeedback());
            injectFeedbacks(system, feedbacks);
            const result = system.getFeedbacks('test-agent');
            expect(result.length).toBe(50);
        });

        test('limit 커스텀 값 적용', () => {
            injectFeedbacks(system, Array.from({ length: 10 }, () => makeFeedback()));
            const result = system.getFeedbacks('test-agent', 3);
            expect(result.length).toBe(3);
        });

        test('최신 피드백 먼저 정렬됨 (timestamp 내림차순)', () => {
            const now = Date.now();
            injectFeedbacks(system, [
                makeFeedback({ timestamp: new Date(now - 3000) }),
                makeFeedback({ timestamp: new Date(now - 1000) }),
                makeFeedback({ timestamp: new Date(now - 2000) })
            ]);
            const result = system.getFeedbacks('test-agent');
            const timestamps = result.map(f => new Date((f as InternalFeedback).timestamp).getTime());
            expect(timestamps[0]).toBeGreaterThan(timestamps[1]);
            expect(timestamps[1]).toBeGreaterThan(timestamps[2]);
        });
    });

    // ----------------------------------------------------------
    // getOverallStats
    // ----------------------------------------------------------

    describe('getOverallStats()', () => {
        test('피드백 없으면 빈 통계 반환', () => {
            const stats = system.getOverallStats();
            expect(stats.totalFeedbacks).toBe(0);
            expect(stats.avgRating).toBe(0);
            expect(stats.topAgents).toEqual([]);
            expect(stats.worstAgents).toEqual([]);
        });

        test('전체 피드백 수와 평균 평점 계산', () => {
            injectFeedbacks(system, [
                makeFeedback({ agentId: 'agent-a', rating: 4 }),
                makeFeedback({ agentId: 'agent-b', rating: 2 }),
                makeFeedback({ agentId: 'agent-a', rating: 4 })
            ]);
            const stats = system.getOverallStats();
            expect(stats.totalFeedbacks).toBe(3);
            // (4+2+4)/3 = 3.3...
            expect(stats.avgRating).toBeCloseTo(3.3, 0);
        });

        test('topAgents는 점수 높은 순으로 최대 5개', () => {
            const agents = ['a', 'b', 'c', 'd', 'e', 'f'];
            const feedbacks: InternalFeedback[] = [];
            agents.forEach((id, idx) => {
                feedbacks.push(makeFeedback({ agentId: id, rating: (idx % 5 + 1) as 1 | 2 | 3 | 4 | 5 }));
            });
            injectFeedbacks(system, feedbacks);
            const stats = system.getOverallStats();
            expect(stats.topAgents.length).toBeLessThanOrEqual(5);
            // 내림차순 정렬 확인
            for (let i = 1; i < stats.topAgents.length; i++) {
                expect(stats.topAgents[i - 1].score).toBeGreaterThanOrEqual(stats.topAgents[i].score);
            }
        });

        test('worstAgents는 점수 낮은 순', () => {
            injectFeedbacks(system, [
                makeFeedback({ agentId: 'good-agent', rating: 5 }),
                makeFeedback({ agentId: 'bad-agent', rating: 1 })
            ]);
            const stats = system.getOverallStats();
            expect(stats.worstAgents.length).toBeGreaterThan(0);
            // worst가 good보다 낮아야 함
            const worstScore = stats.worstAgents[0].score;
            const bestScore = stats.topAgents[0].score;
            expect(worstScore).toBeLessThanOrEqual(bestScore);
        });
    });

    // ----------------------------------------------------------
    // collectFeedback
    // ----------------------------------------------------------

    describe('collectFeedback()', () => {
        test('피드백 수집 후 내부 배열에 추가됨', async () => {
            const feedback = await system.collectFeedback({
                agentId: 'test-agent',
                rating: 4,
                query: '테스트',
                response: '응답'
            });
            expect(feedback.feedbackId).toMatch(/^fb_/);
            expect(feedback.agentId).toBe('test-agent');
            expect(feedback.rating).toBe(4);
            // getFeedbacks로 조회 가능한지 확인
            const all = system.getFeedbacks('test-agent');
            expect(all.some(f => (f as InternalFeedback).feedbackId === feedback.feedbackId)).toBe(true);
        });

        test('DB 실패 시에도 로컬 배열에는 저장됨', async () => {
            // DB mock이 에러를 던지도록 설정
            const { getPool } = require('../data/models/unified-database') as { getPool: jest.Mock };
            getPool.mockReturnValueOnce({
                query: jest.fn().mockRejectedValue(new Error('DB connection failed'))
            });

            const feedback = await system.collectFeedback({
                agentId: 'test-agent',
                rating: 3,
                query: 'DB 에러 상황',
                response: '응답'
            });
            // 에러에도 불구하고 반환값은 정상
            expect(feedback.feedbackId).toMatch(/^fb_/);
            expect(system.getFeedbacks('test-agent').length).toBeGreaterThan(0);
        });

        test('userId, comment, tags 옵션 필드 포함', async () => {
            const feedback = await system.collectFeedback({
                agentId: 'test-agent',
                userId: 'user-123',
                rating: 5,
                comment: '훌륭해요',
                query: '테스트',
                response: '응답',
                tags: ['accuracy', 'speed']
            });
            expect(feedback.userId).toBe('user-123');
            expect(feedback.comment).toBe('훌륭해요');
            expect(feedback.tags).toEqual(['accuracy', 'speed']);
        });

        test('timestamp는 Date 타입', async () => {
            const feedback = await system.collectFeedback({
                agentId: 'test-agent',
                rating: 4,
                query: 'q',
                response: 'r'
            });
            expect(feedback.timestamp).toBeInstanceOf(Date);
        });
    });

    // ----------------------------------------------------------
    // getAgentLearningSystem (싱글톤)
    // ----------------------------------------------------------

    describe('getAgentLearningSystem()', () => {
        test('싱글톤: 두 번 호출해도 동일 인스턴스 반환', () => {
            const s1 = getAgentLearningSystem();
            const s2 = getAgentLearningSystem();
            expect(s1).toBe(s2);
        });

        test('인스턴스는 AgentLearningSystem 타입', () => {
            expect(getAgentLearningSystem()).toBeInstanceOf(AgentLearningSystem);
        });
    });
});
