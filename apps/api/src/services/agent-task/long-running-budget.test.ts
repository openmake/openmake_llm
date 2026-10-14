jest.mock('../../config/agent-task-long-running', () => ({
    AGENT_TASK_LONG_RUNNING: {
        ENABLED: true, DEFAULT_MS: 8 * 3_600_000, MAX_MS: 24 * 3_600_000,
        DEFAULT_TOKENS: 5_000_000, MAX_TOKENS: 20_000_000, DEFAULT_SEGMENTS: 12, MAX_SEGMENTS: 48,
        CONTINUE_AT_RATIO: 0.9, HANDOFF_TURN_MAX_CHARS: 2000, HANDOFF_TURN_TIMEOUT_MS: 60_000,
    },
}));
import { resolveLongRunningBudget } from './long-running-budget';

describe('resolveLongRunningBudget', () => {
    it('빈 입력은 기본값', () => {
        const r = resolveLongRunningBudget({}, 'user', 1000);
        expect(r).toEqual({ ok: true, budget: { maxDurationMs: 8 * 3_600_000, maxTotalTokens: 5_000_000, maxSegments: 12, startedAt: 1000 } });
    });
    it('일반 사용자가 기본값을 넘기면 거절', () => {
        const r = resolveLongRunningBudget({ maxDurationMs: 9 * 3_600_000 }, 'user', 0);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/관리자/);
    });
    it('관리자는 절대 상한까지 허용, 그 이상은 거절', () => {
        expect(resolveLongRunningBudget({ maxTotalTokens: 20_000_000 }, 'admin', 0).ok).toBe(true);
        expect(resolveLongRunningBudget({ maxTotalTokens: 20_000_001 }, 'admin', 0).ok).toBe(false);
    });
    it('0 이하·정수 아님은 거절', () => {
        expect(resolveLongRunningBudget({ maxSegments: 0 }, 'admin', 0).ok).toBe(false);
        expect(resolveLongRunningBudget({ maxSegments: 1.5 }, 'admin', 0).ok).toBe(false);
    });
});

import { longRunningCreateGate } from './long-running-budget';

describe('longRunningCreateGate', () => {
    it('longRunning 이 없으면 아무것도 하지 않는다', () => {
        expect(longRunningCreateGate(undefined, 'user', 0, true)).toEqual({ ok: true, fields: {} });
    });
    it('기능이 꺼져 있으면 400 사유', () => {
        const r = longRunningCreateGate({}, 'user', 0, false);
        expect(r).toEqual({ ok: false, reason: expect.stringMatching(/AGENT_TASK_LONG_RUNNING/) });
    });
    it('켜져 있으면 기본 예산을 fields.longRunning 으로 돌려준다(chainRootTaskId 는 라우트가 자기 id 로 채운다)', () => {
        const r = longRunningCreateGate({}, 'user', 1000, true);
        expect(r).toEqual({ ok: true, fields: { longRunning: { maxDurationMs: 8 * 3_600_000, maxTotalTokens: 5_000_000, maxSegments: 12, startedAt: 1000 } } });
    });
    it('일반 사용자가 기본값을 넘기면 400 사유', () => {
        expect(longRunningCreateGate({ maxSegments: 13 }, 'user', 0, true).ok).toBe(false);
    });
});
