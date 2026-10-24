/**
 * watchdog tick 과 readiness 생존 판정(#1478) — 진짜 background-liveness 로 본다.
 * 받아들인 tick 이 멈추면 그 뒤의 겹친 tick 은 생존 기록을 갱신하지 않아, 마지막 받아들인 tick 부터 3×주기 뒤 readiness 가 false 다.
 */
const listStaleRunningTasks = jest.fn();
jest.mock('../../../data/repositories/agent-task-progress-repository', () => ({
    AgentTaskProgressRepository: jest.fn().mockImplementation(() => ({
        listStaleRunningTasks: (...a: unknown[]) => listStaleRunningTasks(...a),
        summarizeParkedByReason: async () => ({ count: 0, longCount: 0, oldest: [] }),
        summarizeStalePendingTasks: async () => ({ count: 0, oldestStalledMs: 0, taskIds: [] }),
    })),
}));
jest.mock('../../../data/repositories/agent-task-repository', () => ({
    AgentTaskRepository: jest.fn().mockImplementation(() => ({ countActiveAgentTasksByStatus: async () => ({ queued: 0, running: 0, paused: 0, pending: 0 }) })),
}));
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../task-queue', () => ({ getAgentTaskQueue: () => ({ stats: () => ({ globalActive: 0, pending: 0, wait: { oldestPendingMs: null } }) }) }));
jest.mock('../../../monitoring/agent-task-alerts', () => ({ ...jest.requireActual('../../../monitoring/agent-task-alerts'), sendAgentTaskAlert: async () => undefined }));
jest.mock('../../../monitoring/metrics', () => ({ getMetrics: () => ({ setGauge: () => undefined }) }));
jest.mock('../shutdown-drain', () => ({ isAgentTaskShutdown: () => false }));
const limits = { WATCHDOG_ENABLED: true, WATCHDOG_MS: 60_000, LEASE_ENABLED: false, SCHEDULES_ENABLED: false, STALE_MS: 900_000, QUEUE_BACKLOG_PENDING: 20, QUEUE_BACKLOG_WAIT_MS: 300_000, MODEL_WAIT_ALERT_MS: 1_800_000 };
jest.mock('../../../config/runtime-limits', () => ({ ...jest.requireActual('../../../config/runtime-limits'), AGENT_TASK_LIMITS: limits }));

import { runWatchdogTick } from '../stale-watchdog';
import { getBackgroundLiveness, markLoopRegistered } from '../background-liveness';

const T0 = Date.UTC(2026, 9, 24, 0, 0, 0);

afterEach(() => jest.useRealTimers());

it('멈춘 tick 뒤 겹친 tick 들은 생존을 연장하지 않는다 — 마지막 받아들인 tick 부터 3×주기 뒤 false', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(T0);
    markLoopRegistered('watchdog', T0);
    listStaleRunningTasks.mockImplementationOnce(() => new Promise(() => undefined)); // 영영 끝나지 않는 조회
    void runWatchdogTick();
    for (const at of [T0 + 60_000, T0 + 120_000, T0 + 170_000]) {
        jest.setSystemTime(at);
        await expect(runWatchdogTick()).resolves.toMatchObject({ skipped: 'overlap' });
    }
    expect(getBackgroundLiveness(T0 + 179_999).loops.watchdog.ok).toBe(true);
    expect(getBackgroundLiveness(T0 + 180_001).loops.watchdog).toMatchObject({ ok: false, lastRunAt: new Date(T0).toISOString() });
});
