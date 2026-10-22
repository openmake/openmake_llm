/**
 * watchdog tick(R8-b, R9-c) — 진행이 멈춘 실행 중 작업·대기열 적체·모델 대기 장기화를 게이지와 알림으로 드러낸다.
 * 작업 상태는 바꾸지 않는다. 단계 하나가 실패해도 다음 단계는 돈다.
 */
const listStaleRunningTasks = jest.fn();
jest.mock('../../../data/repositories/agent-task-progress-repository', () => ({
    AgentTaskProgressRepository: jest.fn().mockImplementation(() => ({ listStaleRunningTasks: (...a: unknown[]) => listStaleRunningTasks(...a) })),
}));
const listParkedTasks = jest.fn();
const countActiveAgentTasksByStatus = jest.fn();
jest.mock('../../../data/repositories/agent-task-repository', () => ({
    AgentTaskRepository: jest.fn().mockImplementation(() => ({
        listParkedTasks: (...a: unknown[]) => listParkedTasks(...a),
        countActiveAgentTasksByStatus: () => countActiveAgentTasksByStatus(),
    })),
}));
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}) }));
const stats = jest.fn();
jest.mock('../task-queue', () => ({ getAgentTaskQueue: () => ({ stats: () => stats() }) }));
const sendAgentTaskAlert = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../../monitoring/agent-task-alerts', () => ({
    ...jest.requireActual('../../../monitoring/agent-task-alerts'),
    sendAgentTaskAlert: (...a: unknown[]) => sendAgentTaskAlert(...a),
}));
const setGauge = jest.fn();
jest.mock('../../../monitoring/metrics', () => ({ getMetrics: () => ({ setGauge: (...a: unknown[]) => setGauge(...a) }) }));
let shuttingDown = false;
jest.mock('../shutdown-drain', () => ({ isAgentTaskShutdown: () => shuttingDown }));
const limits = { WATCHDOG_ENABLED: true, STALE_MS: 900_000, QUEUE_BACKLOG_PENDING: 20, QUEUE_BACKLOG_WAIT_MS: 300_000, MODEL_WAIT_ALERT_MS: 1_800_000 };
jest.mock('../../../config/runtime-limits', () => ({ ...jest.requireActual('../../../config/runtime-limits'), AGENT_TASK_LIMITS: limits }));

import { runWatchdogTick } from '../stale-watchdog';

const MIN = 60_000;
const stale = (id: string, stalledMs: number) => ({ id, user_id: 'u1', current_turn: 3, lease_owner: 'h:1', stalled_ms: stalledMs });
const gauge = (name: string, labels?: Record<string, string>) =>
    setGauge.mock.calls.find((c) => c[0] === name && (labels === undefined || JSON.stringify(c[2]) === JSON.stringify(labels)))?.[1];
const alertsOf = (type: string) => sendAgentTaskAlert.mock.calls.filter((c) => c[0] === type);

beforeEach(() => {
    jest.clearAllMocks();
    shuttingDown = false;
    limits.WATCHDOG_ENABLED = true;
    listStaleRunningTasks.mockResolvedValue([]);
    stats.mockReturnValue({ globalActive: 1, pending: 0, wait: { oldestPendingMs: null } });
    listParkedTasks.mockResolvedValue([]);
    countActiveAgentTasksByStatus.mockResolvedValue({ queued: 0, running: 1, paused: 0, pending: 0 });
});

describe('runWatchdogTick — 멈춘 실행 중 작업', () => {
    it('stale 2건이면 알림 1건(taskIds 2개)과 게이지 2', async () => {
        listStaleRunningTasks.mockResolvedValue([stale('a', 30 * MIN), stale('b', 16 * MIN)]);
        const r = await runWatchdogTick();
        expect(r.stale).toBe(2);
        expect(listStaleRunningTasks).toHaveBeenCalledWith(900_000);
        const calls = alertsOf('agent_task_stale');
        expect(calls).toHaveLength(1);
        const data = calls[0][3] as { count: number; taskIds: string[]; oldestStalledMs: number };
        expect(data).toEqual({ count: 2, taskIds: ['a', 'b'], oldestStalledMs: 30 * MIN });
        expect(gauge('agent_task_stale_running')).toBe(2);
    });

    it('stale 0건이면 알림 없이 게이지 0', async () => {
        const r = await runWatchdogTick();
        expect(r.stale).toBe(0);
        expect(alertsOf('agent_task_stale')).toHaveLength(0);
        expect(gauge('agent_task_stale_running')).toBe(0);
    });

    it('stale 조회가 던져도 다음 단계(대기열)는 돌고 resolve 한다', async () => {
        listStaleRunningTasks.mockRejectedValue(new Error('db down'));
        stats.mockReturnValue({ globalActive: 2, pending: 25, wait: { oldestPendingMs: 1000 } });
        const r = await runWatchdogTick();
        expect(stats).toHaveBeenCalled();
        expect(r.queueBacklog).toBe(true);
        expect(gauge('agent_task_stale_running')).toBeUndefined();
    });
});

describe('runWatchdogTick — 대기열 적체', () => {
    it('대기 25건이면 적체 알림 1건, 게이지 3종', async () => {
        stats.mockReturnValue({ globalActive: 4, pending: 25, wait: { oldestPendingMs: 12_000 } });
        const r = await runWatchdogTick();
        expect(r.queueBacklog).toBe(true);
        expect(alertsOf('agent_task_queue_backlog')).toHaveLength(1);
        expect(gauge('agent_task_queue_pending')).toBe(25);
        expect(gauge('agent_task_queue_active')).toBe(4);
        expect(gauge('agent_task_queue_oldest_wait_ms')).toBe(12_000);
    });

    it('가장 오래 기다린 시간이 상한을 넘어도 적체로 본다', async () => {
        stats.mockReturnValue({ globalActive: 4, pending: 1, wait: { oldestPendingMs: 300_000 } });
        expect((await runWatchdogTick()).queueBacklog).toBe(true);
    });

    it('대기 3건·10초면 알림 없음, 대기 없으면 가장 오래 기다린 시간 게이지는 0', async () => {
        stats.mockReturnValue({ globalActive: 1, pending: 3, wait: { oldestPendingMs: 10_000 } });
        expect((await runWatchdogTick()).queueBacklog).toBe(false);
        expect(alertsOf('agent_task_queue_backlog')).toHaveLength(0);
        setGauge.mockClear();
        stats.mockReturnValue({ globalActive: 0, pending: 0, wait: { oldestPendingMs: null } });
        await runWatchdogTick();
        expect(gauge('agent_task_queue_oldest_wait_ms')).toBe(0);
    });
});

describe('runWatchdogTick — 모델 대기 장기화', () => {
    it('모델 대기 31분 1건 + 10분 1건이면 알림 1건(count 1), 게이지는 모델 대기 전체 2', async () => {
        listParkedTasks.mockResolvedValue([
            { id: 'm1', reason: 'model_wait', waited_ms: String(31 * MIN) }, // pg bigint 는 문자열로 온다
            { id: 'm2', reason: 'model_wait', waited_ms: 10 * MIN },
            { id: 'h1', reason: 'hitl_parked', waited_ms: 999 * MIN },
        ]);
        const r = await runWatchdogTick();
        expect(listParkedTasks).toHaveBeenCalledWith(200);
        expect(r.modelWaitLong).toBe(1);
        const calls = alertsOf('agent_task_model_wait_long');
        expect(calls).toHaveLength(1);
        expect(calls[0][3]).toMatchObject({ count: 1, taskIds: ['m1'] });
        expect(gauge('agent_task_model_wait_parked')).toBe(2);
    });
});

describe('runWatchdogTick — 상태별 건수 게이지', () => {
    it('네 상태 모두 게이지로 낸다', async () => {
        countActiveAgentTasksByStatus.mockResolvedValue({ queued: 1, running: 2, paused: 3, pending: 4 });
        await runWatchdogTick();
        expect(gauge('agent_task_status_count', { status: 'queued' })).toBe(1);
        expect(gauge('agent_task_status_count', { status: 'running' })).toBe(2);
        expect(gauge('agent_task_status_count', { status: 'paused' })).toBe(3);
        expect(gauge('agent_task_status_count', { status: 'pending' })).toBe(4);
    });
});

describe('runWatchdogTick — 건너뜀', () => {
    it('서버 종료 중이면 아무것도 조회하지 않는다', async () => {
        shuttingDown = true;
        await expect(runWatchdogTick()).resolves.toEqual({ stale: 0, queueBacklog: false, modelWaitLong: 0, skipped: 'shutdown' });
        expect(listStaleRunningTasks).not.toHaveBeenCalled();
        expect(stats).not.toHaveBeenCalled();
        expect(listParkedTasks).not.toHaveBeenCalled();
        expect(countActiveAgentTasksByStatus).not.toHaveBeenCalled();
    });

    it('꺼져 있으면 아무것도 조회하지 않는다', async () => {
        limits.WATCHDOG_ENABLED = false;
        await expect(runWatchdogTick()).resolves.toMatchObject({ skipped: 'disabled' });
        expect(listStaleRunningTasks).not.toHaveBeenCalled();
    });
});
