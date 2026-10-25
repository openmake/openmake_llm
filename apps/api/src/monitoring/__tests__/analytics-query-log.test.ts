/**
 * AnalyticsSystem 쿼리 기록(W7) — 원문 질의를 메모리에 보관하지 않고 길이·해시(sha256 앞 16자)·시각만 남긴다.
 */
jest.mock('../../llm', () => ({ getApiUsageTracker: jest.fn(() => ({ getSummary: jest.fn(() => null) })) }));
jest.mock('../../agents/agent-data', () => ({ AGENTS: {} }));

import { AnalyticsSystem } from '../analytics';

describe('AnalyticsSystem.recordQuery — 원문 미보관', () => {
    let analytics: AnalyticsSystem;
    beforeEach(() => { analytics = new AnalyticsSystem(); });
    afterEach(() => { analytics.dispose(); });

    it('getQueryLog() 항목에 원문이 없고 length·hash·timestamp 만 있다', () => {
        analytics.recordQuery('비밀 문장');
        const log = analytics.getQueryLog();
        expect(log).toHaveLength(1);
        expect(Object.keys(log[0]).sort()).toEqual(['hash', 'length', 'timestamp']);
        expect(log[0].length).toBe('비밀 문장'.length);
        expect(log[0].hash).toMatch(/^[0-9a-f]{16}$/);
        expect(log[0].timestamp).toBeInstanceOf(Date);
        expect(JSON.stringify(log)).not.toContain('비밀 문장');
    });

    it('getTopQueries() 도 원문 대신 해시를 돌려준다', () => {
        analytics.recordQuery('비밀 문장');
        analytics.recordQuery('비밀 문장');
        const top = analytics.getTopQueries();
        expect(top[0].count).toBe(2);
        expect(top[0].query).toBe(analytics.getQueryLog()[0].hash);
        expect(JSON.stringify(analytics.getUserBehavior())).not.toContain('비밀 문장');
    });
});
