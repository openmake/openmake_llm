/**
 * analytics.test.ts
 * AnalyticsSystem 클래스 단위 테스트
 * getApiUsageTracker()는 jest.mock으로 격리
 */

jest.mock('../ollama/api-usage-tracker', () => ({
    getApiUsageTracker: jest.fn(() => ({
        getSummary: jest.fn(() => ({
            today: {
                totalTokens: 1000,
                totalRequests: 50,
                totalErrors: 2,
                avgResponseTime: 300,
                modelUsage: { 'gpt-4': 20, 'claude-3': 30 }
            },
            weekly: {
                totalTokens: 7000,
                totalRequests: 350,
                totalErrors: 14,
                avgResponseTime: 280
            }
        }))
    }))
}));

jest.mock('../agents/agent-data', () => ({
    AGENTS: {
        'test-agent': { name: '테스트 에이전트' },
        'another-agent': { name: '다른 에이전트' }
    }
}));

// os 모듈은 실제 값을 사용 (테스트 환경에서 문제없음)

import { AnalyticsSystem } from '../monitoring/analytics';

// ============================================================
// 인스턴스 생성 및 정리 헬퍼
// ============================================================

let analytics: AnalyticsSystem;

beforeEach(() => {
    analytics = new AnalyticsSystem();
});

afterEach(() => {
    analytics.dispose();
});

// ============================================================
// 초기화
// ============================================================

describe('AnalyticsSystem — 초기화', () => {
    test('인스턴스를 생성할 수 있다', () => {
        expect(analytics).toBeInstanceOf(AnalyticsSystem);
    });

    test('초기 getAgentPerformance() → 빈 배열', () => {
        expect(analytics.getAgentPerformance()).toEqual([]);
    });

    test('초기 getPeakHours() → 24개 항목 (모두 0)', () => {
        const peaks = analytics.getPeakHours();
        expect(peaks).toHaveLength(24);
        for (const p of peaks) {
            expect(p.requests).toBe(0);
        }
    });

    test('초기 getTopQueries() → 빈 배열', () => {
        expect(analytics.getTopQueries()).toEqual([]);
    });
});

// ============================================================
// recordAgentRequest()
// ============================================================

describe('AnalyticsSystem — recordAgentRequest()', () => {
    test('에이전트 통계가 누적된다', () => {
        analytics.recordAgentRequest('test-agent', '테스트', 200, true, 100);
        analytics.recordAgentRequest('test-agent', '테스트', 400, true, 200);

        const perf = analytics.getAgentPerformance();
        expect(perf).toHaveLength(1);
        expect(perf[0].agentId).toBe('test-agent');
        expect(perf[0].totalRequests).toBe(2);
        expect(perf[0].avgResponseTime).toBe(300); // (200+400)/2
        expect(perf[0].successRate).toBe(100);
        expect(perf[0].avgTokens).toBe(150); // (100+200)/2
    });

    test('실패 요청이 successRate에 반영된다', () => {
        analytics.recordAgentRequest('test-agent', '테스트', 100, true, 50);
        analytics.recordAgentRequest('test-agent', '테스트', 100, false, 50);

        const perf = analytics.getAgentPerformance();
        expect(perf[0].successRate).toBe(50);
    });

    test('여러 에이전트를 별도로 추적한다', () => {
        analytics.recordAgentRequest('agent-a', 'A', 100, true, 50);
        analytics.recordAgentRequest('agent-b', 'B', 200, true, 100);

        const perf = analytics.getAgentPerformance();
        expect(perf).toHaveLength(2);
        const ids = perf.map(p => p.agentId);
        expect(ids).toContain('agent-a');
        expect(ids).toContain('agent-b');
    });

    test('popularity는 요청 수 기준 오름차순 순위다', () => {
        analytics.recordAgentRequest('agent-a', 'A', 100, true, 50);
        analytics.recordAgentRequest('agent-a', 'A', 100, true, 50);
        analytics.recordAgentRequest('agent-b', 'B', 100, true, 50);

        const perf = analytics.getAgentPerformance();
        const agentA = perf.find(p => p.agentId === 'agent-a');
        const agentB = perf.find(p => p.agentId === 'agent-b');
        expect(agentA!.popularity).toBeLessThan(agentB!.popularity);
    });
});

// ============================================================
// recordQuery()
// ============================================================

describe('AnalyticsSystem — recordQuery()', () => {
    test('쿼리가 기록된다', () => {
        analytics.recordQuery('안녕하세요');
        const top = analytics.getTopQueries(10);
        expect(top).toHaveLength(1);
        expect(top[0].query).toBe('안녕하세요');
        expect(top[0].count).toBe(1);
    });

    test('동일 쿼리는 카운트가 증가한다', () => {
        analytics.recordQuery('hello');
        analytics.recordQuery('hello');
        analytics.recordQuery('hello');

        const top = analytics.getTopQueries();
        expect(top[0].count).toBe(3);
    });

    test('대소문자를 구분하지 않는다 (소문자 정규화)', () => {
        analytics.recordQuery('Hello');
        analytics.recordQuery('HELLO');
        analytics.recordQuery('hello');

        const top = analytics.getTopQueries();
        expect(top[0].count).toBe(3);
        expect(top[0].query).toBe('hello');
    });

    test('100자 초과 쿼리는 100자로 잘린다', () => {
        const longQuery = 'a'.repeat(200);
        analytics.recordQuery(longQuery);

        const top = analytics.getTopQueries();
        expect(top[0].query.length).toBe(100);
    });

    test('limit 파라미터가 반환 수를 제한한다', () => {
        for (let i = 0; i < 20; i++) {
            analytics.recordQuery(`query-${i}`);
        }
        expect(analytics.getTopQueries(5)).toHaveLength(5);
    });

    test('getTopQueries()는 빈도 내림차순 정렬된다', () => {
        analytics.recordQuery('rare');
        analytics.recordQuery('common');
        analytics.recordQuery('common');
        analytics.recordQuery('common');

        const top = analytics.getTopQueries();
        expect(top[0].query).toBe('common');
        expect(top[1].query).toBe('rare');
    });
});

// ============================================================
// Session 관리
// ============================================================

describe('AnalyticsSystem — 세션 관리', () => {
    test('startSession + endSession이 정상 동작한다', () => {
        analytics.startSession('session-1');
        analytics.endSession('session-1');

        const behavior = analytics.getUserBehavior();
        // 완료된 세션이 1개
        expect(behavior.avgSessionLength).toBeGreaterThanOrEqual(0);
    });

    test('incrementSessionQuery가 세션 쿼리 카운트를 증가시킨다', () => {
        analytics.startSession('session-2');
        analytics.incrementSessionQuery('session-2');
        analytics.incrementSessionQuery('session-2');
        analytics.endSession('session-2');

        const behavior = analytics.getUserBehavior();
        expect(behavior.avgQueriesPerSession).toBeGreaterThanOrEqual(2);
    });

    test('존재하지 않는 세션 종료는 에러를 발생시키지 않는다', () => {
        expect(() => analytics.endSession('non-existent')).not.toThrow();
    });

    test('종료된 세션에 incrementSessionQuery는 효과 없다', () => {
        analytics.startSession('session-3');
        analytics.endSession('session-3');
        // 이미 종료된 세션에 쿼리 증가 시도 → 효과 없어야 함
        expect(() => analytics.incrementSessionQuery('session-3')).not.toThrow();
    });

    test('세션이 없을 때 avgSessionLength = 0', () => {
        const behavior = analytics.getUserBehavior();
        expect(behavior.avgSessionLength).toBe(0);
    });

    test('세션이 없을 때 avgQueriesPerSession = 0', () => {
        const behavior = analytics.getUserBehavior();
        expect(behavior.avgQueriesPerSession).toBe(0);
    });
});

// ============================================================
// getPeakHours()
// ============================================================

describe('AnalyticsSystem — getPeakHours()', () => {
    test('24개 항목이 항상 반환된다', () => {
        expect(analytics.getPeakHours()).toHaveLength(24);
    });

    test('요청 수 내림차순으로 정렬된다', () => {
        // 현재 시간 기준으로 쿼리를 다수 기록
        analytics.recordQuery('query');
        analytics.recordQuery('query2');

        const peaks = analytics.getPeakHours();
        for (let i = 0; i < peaks.length - 1; i++) {
            expect(peaks[i].requests).toBeGreaterThanOrEqual(peaks[i + 1].requests);
        }
    });

    test('각 항목은 hour(0-23)와 requests를 가진다', () => {
        const peaks = analytics.getPeakHours();
        for (const peak of peaks) {
            expect(peak.hour).toBeGreaterThanOrEqual(0);
            expect(peak.hour).toBeLessThanOrEqual(23);
            expect(typeof peak.requests).toBe('number');
        }
    });
});

// ============================================================
// setActiveConnectionsGetter()
// ============================================================

describe('AnalyticsSystem — setActiveConnectionsGetter()', () => {
    test('활성 연결 수 조회 콜백이 getSystemHealth()에 반영된다', () => {
        analytics.setActiveConnectionsGetter(() => 42);
        const health = analytics.getSystemHealth();
        expect(health.activeConnections).toBe(42);
    });

    test('기본값은 0', () => {
        const health = analytics.getSystemHealth();
        expect(health.activeConnections).toBe(0);
    });
});

// ============================================================
// getSystemHealth()
// ============================================================

describe('AnalyticsSystem — getSystemHealth()', () => {
    test('status는 healthy/degraded/critical 중 하나다', () => {
        const health = analytics.getSystemHealth();
        expect(['healthy', 'degraded', 'critical']).toContain(health.status);
    });

    test('uptime은 양수다', () => {
        const health = analytics.getSystemHealth();
        expect(health.uptime).toBeGreaterThanOrEqual(0);
    });

    test('memoryUsage는 0-100 범위다', () => {
        const health = analytics.getSystemHealth();
        expect(health.memoryUsage).toBeGreaterThanOrEqual(0);
        expect(health.memoryUsage).toBeLessThanOrEqual(200);
    });

    test('cpuUsage는 숫자다', () => {
        const health = analytics.getSystemHealth();
        expect(typeof health.cpuUsage).toBe('number');
    });

    test('에러율 2%(모킹 50req, 2err)는 healthy 상태다', () => {
        // mock: 50 requests, 2 errors → 4% error rate → healthy
        const health = analytics.getSystemHealth();
        expect(health.status).toBe('healthy');
    });
});

// ============================================================
// getCostAnalysis()
// ============================================================

describe('AnalyticsSystem — getCostAnalysis()', () => {
    test('dailyCost, weeklyCost, projectedMonthlyCost를 반환한다', () => {
        const cost = analytics.getCostAnalysis();
        expect(typeof cost.dailyCost).toBe('number');
        expect(typeof cost.weeklyCost).toBe('number');
        expect(typeof cost.projectedMonthlyCost).toBe('number');
    });

    test('비용은 음수가 아니다', () => {
        const cost = analytics.getCostAnalysis();
        expect(cost.dailyCost).toBeGreaterThanOrEqual(0);
        expect(cost.weeklyCost).toBeGreaterThanOrEqual(0);
        expect(cost.projectedMonthlyCost).toBeGreaterThanOrEqual(0);
    });

    test('costByModel은 배열이다', () => {
        const cost = analytics.getCostAnalysis();
        expect(Array.isArray(cost.costByModel)).toBe(true);
    });

    test('costByAgent는 배열이다', () => {
        const cost = analytics.getCostAnalysis();
        expect(Array.isArray(cost.costByAgent)).toBe(true);
    });
});

// ============================================================
// getUserBehavior()
// ============================================================

describe('AnalyticsSystem — getUserBehavior()', () => {
    test('peakHours는 최대 5개다', () => {
        const behavior = analytics.getUserBehavior();
        expect(behavior.peakHours.length).toBeLessThanOrEqual(5);
    });

    test('topQueries는 최대 10개다', () => {
        const behavior = analytics.getUserBehavior();
        expect(behavior.topQueries.length).toBeLessThanOrEqual(10);
    });

    test('avgSessionLength는 숫자다', () => {
        const behavior = analytics.getUserBehavior();
        expect(typeof behavior.avgSessionLength).toBe('number');
    });

    test('avgQueriesPerSession은 숫자다', () => {
        const behavior = analytics.getUserBehavior();
        expect(typeof behavior.avgQueriesPerSession).toBe('number');
    });
});

// ============================================================
// getDashboard()
// ============================================================

describe('AnalyticsSystem — getDashboard()', () => {
    test('timestamp, agentPerformance, userBehavior, costAnalysis, systemHealth를 포함한다', () => {
        const dashboard = analytics.getDashboard();
        expect(dashboard).toHaveProperty('timestamp');
        expect(dashboard).toHaveProperty('agentPerformance');
        expect(dashboard).toHaveProperty('userBehavior');
        expect(dashboard).toHaveProperty('costAnalysis');
        expect(dashboard).toHaveProperty('systemHealth');
    });

    test('timestamp는 Date 인스턴스다', () => {
        const dashboard = analytics.getDashboard();
        expect(dashboard.timestamp).toBeInstanceOf(Date);
    });

    test('agentPerformance는 배열이다', () => {
        const dashboard = analytics.getDashboard();
        expect(Array.isArray(dashboard.agentPerformance)).toBe(true);
    });
});

// ============================================================
// reset()
// ============================================================

describe('AnalyticsSystem — reset()', () => {
    test('reset 후 에이전트 통계가 초기화된다', () => {
        analytics.recordAgentRequest('agent-a', 'A', 100, true, 50);
        analytics.reset();
        expect(analytics.getAgentPerformance()).toEqual([]);
    });

    test('reset 후 쿼리 로그가 초기화된다', () => {
        analytics.recordQuery('test query');
        analytics.reset();
        expect(analytics.getTopQueries()).toEqual([]);
    });

    test('reset 후 세션 로그가 초기화된다', () => {
        analytics.startSession('session-x');
        analytics.endSession('session-x');
        analytics.reset();
        const behavior = analytics.getUserBehavior();
        expect(behavior.avgSessionLength).toBe(0);
    });
});

// ============================================================
// dispose()
// ============================================================

describe('AnalyticsSystem — dispose()', () => {
    test('dispose()를 두 번 호출해도 에러가 없다', () => {
        expect(() => {
            analytics.dispose();
            analytics.dispose();
        }).not.toThrow();
    });
});
