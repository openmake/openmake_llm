/**
 * watchdog tick(R8-b, R9-c) — 진행이 멈춘 실행 중 작업·대기열 적체·모델 대기 장기화를 게이지와 알림으로 드러낸다.
 * 작업 상태는 바꾸지 않는다. 단계 하나가 실패해도 다음 단계는 돈다.
 */
const listStaleRunningTasks = jest.fn();
const summarizeParkedByReason = jest.fn();
const summarizeStalePendingTasks = jest.fn();
jest.mock('../../../data/repositories/agent-task-progress-repository', () => ({
    AgentTaskProgressRepository: jest.fn().mockImplementation(() => ({
        listStaleRunningTasks: (...a: unknown[]) => listStaleRunningTasks(...a),
        summarizeParkedByReason: (...a: unknown[]) => summarizeParkedByReason(...a),
        summarizeStalePendingTasks: (...a: unknown[]) => summarizeStalePendingTasks(...a),
    })),
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
const getMetrics = jest.fn(() => ({ setGauge: (...a: unknown[]) => setGauge(...a) }));
jest.mock('../../../monitoring/metrics', () => ({ getMetrics: () => getMetrics() }));
const markLoopRun = jest.fn();
jest.mock('../background-liveness', () => ({ markLoopRun: (...a: unknown[]) => markLoopRun(...a) }));
let shuttingDown = false;
jest.mock('../shutdown-drain', () => ({ isAgentTaskShutdown: () => shuttingDown }));
const limits = { WATCHDOG_ENABLED: true, STALE_MS: 900_000, QUEUE_BACKLOG_PENDING: 20, QUEUE_BACKLOG_WAIT_MS: 300_000, MODEL_WAIT_ALERT_MS: 1_800_000 };
jest.mock('../../../config/runtime-limits', () => ({ ...jest.requireActual('../../../config/runtime-limits'), AGENT_TASK_LIMITS: limits }));

import { runWatchdogTick } from '../stale-watchdog';
import { ALERT_TEXT } from '../../../monitoring/agent-task-alerts';

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
    summarizeParkedByReason.mockResolvedValue({ count: 0, longCount: 0, oldest: [] });
    summarizeStalePendingTasks.mockResolvedValue({ count: 0, oldestStalledMs: 0, taskIds: [] });
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
    it('DB 집계로 센다 — 200건 목록이 아니라 전체 건수·장기 건수, 알림 taskIds 는 오래 기다린 표본 중 기준을 넘긴 것', async () => {
        summarizeParkedByReason.mockResolvedValue({
            count: 250, longCount: 230,
            oldest: [{ id: 'm1', waited_ms: 90 * MIN }, { id: 'm2', waited_ms: 31 * MIN }, { id: 'm3', waited_ms: 10 * MIN }],
        });
        const r = await runWatchdogTick();
        expect(summarizeParkedByReason).toHaveBeenCalledWith('model_wait', 1_800_000, 5);
        expect(listParkedTasks).not.toHaveBeenCalled();
        expect(r.modelWaitLong).toBe(230);
        const calls = alertsOf('agent_task_model_wait_long');
        expect(calls).toHaveLength(1);
        expect(calls[0][3]).toEqual({ count: 230, taskIds: ['m1', 'm2'], thresholdMs: 1_800_000 });
        expect(gauge('agent_task_model_wait_parked')).toBe(250);
    });

    it('장기 0건이면 알림 없음, 게이지는 모델 대기 전체', async () => {
        summarizeParkedByReason.mockResolvedValue({ count: 3, longCount: 0, oldest: [{ id: 'm1', waited_ms: MIN }] });
        expect((await runWatchdogTick()).modelWaitLong).toBe(0);
        expect(alertsOf('agent_task_model_wait_long')).toHaveLength(0);
        expect(gauge('agent_task_model_wait_parked')).toBe(3);
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
        await expect(runWatchdogTick()).resolves.toEqual({ stale: 0, queueBacklog: false, modelWaitLong: 0, stalePending: 0, skipped: 'shutdown' });
        expect(listStaleRunningTasks).not.toHaveBeenCalled();
        expect(stats).not.toHaveBeenCalled();
        expect(summarizeParkedByReason).not.toHaveBeenCalled();
        expect(summarizeStalePendingTasks).not.toHaveBeenCalled();
        expect(countActiveAgentTasksByStatus).not.toHaveBeenCalled();
    });

    it('꺼져 있으면 아무것도 조회하지 않는다', async () => {
        limits.WATCHDOG_ENABLED = false;
        await expect(runWatchdogTick()).resolves.toMatchObject({ skipped: 'disabled' });
        expect(listStaleRunningTasks).not.toHaveBeenCalled();
        expect(summarizeStalePendingTasks).not.toHaveBeenCalled();
    });
});

describe('runWatchdogTick — 겹친 tick(#1478)', () => {
    it('앞 tick 이 끝나기 전 tick 은 조회하지 않고 생존 기록도 갱신하지 않는다 — 끝나면 다시 돈다', async () => {
        let release: () => void = () => undefined;
        listStaleRunningTasks.mockImplementationOnce(() => new Promise((r) => { release = () => r([]); }));
        const first = runWatchdogTick();
        try {
            await expect(runWatchdogTick()).resolves.toEqual({ stale: 0, queueBacklog: false, modelWaitLong: 0, stalePending: 0, skipped: 'overlap' });
            expect(listStaleRunningTasks).toHaveBeenCalledTimes(1);
            expect(markLoopRun).toHaveBeenCalledTimes(1);
        } finally {
            // 단언이 실패해도 첫 tick 을 끝내 guard 를 푼다 — 남은 tick 이 뒤 테스트를 overlap 으로 오염시키지 않게
            release();
            await first;
        }
        await runWatchdogTick();
        expect(listStaleRunningTasks).toHaveBeenCalledTimes(2);
        expect(markLoopRun).toHaveBeenCalledTimes(2);
        expect(markLoopRun).toHaveBeenCalledWith('watchdog');
    });

    it('tick 이 예외로 끝나도 resolve 하고 guard 를 푼다(finally) — 다음 tick 은 정상으로 돈다', async () => {
        getMetrics.mockImplementationOnce(() => { throw new Error('metrics broken'); });
        await expect(runWatchdogTick()).resolves.toMatchObject({ stale: 0 });
        listStaleRunningTasks.mockResolvedValue([stale('a', 30 * MIN)]);
        const r = await runWatchdogTick();
        expect(r.skipped).toBeUndefined();
        expect(r.stale).toBe(1);
    });
});

describe('runWatchdogTick — 단계 조회 실패와 회복(#1478)', () => {
    const STAGES = ['stale', 'queue', 'model_wait', 'status_count'];
    const stageError = (stage: string) => gauge('agent_task_watchdog_stage_error', { stage });
    const lastSuccess = (stage: string) => gauge('agent_task_watchdog_stage_last_success_seconds', { stage });

    it('모든 단계가 성공하면 단계별 오류 0, 마지막 성공 시각(초)을 남긴다', async () => {
        const before = Date.now() / 1000;
        await runWatchdogTick();
        for (const s of STAGES) {
            expect(stageError(s)).toBe(0);
            expect(lastSuccess(s)).toBeGreaterThanOrEqual(Math.floor(before));
        }
    });

    it('조회 실패는 오류 1 — 그 단계의 알려진 값은 0 으로 덮지 않고 마지막 성공 시각도 갱신하지 않는다', async () => {
        listStaleRunningTasks.mockRejectedValue(new Error('db down'));
        summarizeParkedByReason.mockRejectedValue(new Error('db down'));
        countActiveAgentTasksByStatus.mockRejectedValue(new Error('db down'));
        await runWatchdogTick();
        for (const s of ['stale', 'model_wait', 'status_count']) {
            expect(stageError(s)).toBe(1);
            expect(lastSuccess(s)).toBeUndefined();
        }
        expect(stageError('queue')).toBe(0);
        expect(gauge('agent_task_stale_running')).toBeUndefined();
        expect(gauge('agent_task_model_wait_parked')).toBeUndefined();
        expect(setGauge.mock.calls.filter((c) => c[0] === 'agent_task_status_count')).toHaveLength(0);
    });

    it('실패 뒤 회복하면 최신 값으로 갱신하고 오류를 0 으로 되돌린다', async () => {
        listStaleRunningTasks.mockRejectedValueOnce(new Error('db down'));
        await runWatchdogTick();
        expect(stageError('stale')).toBe(1);
        setGauge.mockClear();
        listStaleRunningTasks.mockResolvedValue([]);
        await runWatchdogTick();
        expect(stageError('stale')).toBe(0);
        expect(gauge('agent_task_stale_running')).toBe(0);
        expect(lastSuccess('stale')).toBeDefined();
    });
});

describe('runWatchdogTick — 해소 알림(#1478)', () => {
    beforeEach(async () => {
        await runWatchdogTick(); // 앞 테스트가 남긴 경고 기억을 정상 tick 으로 비운다
        jest.clearAllMocks();
    });
    const resolvedOf = (type: string) => alertsOf(`${type}_resolved`);

    it('처음부터 정상이고 정상이 반복되면 해소 알림은 없다', async () => {
        await runWatchdogTick();
        await runWatchdogTick();
        expect(sendAgentTaskAlert.mock.calls.filter((c) => String(c[0]).endsWith('_resolved'))).toHaveLength(0);
    });

    it('멈춤 → 정상 전이에 해소 1건, 이후 정상 tick 은 더 보내지 않는다', async () => {
        listStaleRunningTasks.mockResolvedValueOnce([stale('a', 30 * MIN)]);
        await runWatchdogTick();
        expect(alertsOf('agent_task_stale')).toHaveLength(1);
        await runWatchdogTick();
        await runWatchdogTick();
        expect(resolvedOf('agent_task_stale')).toHaveLength(1);
        expect(resolvedOf('agent_task_stale')[0][1]).toBe(ALERT_TEXT.agent_task_stale_resolved.title);
    });

    it('조회 실패는 해소가 아니다 — 경고 기억을 지우지 않고, 다음 성공 정상 tick 에서 해소 1건', async () => {
        listStaleRunningTasks.mockResolvedValueOnce([stale('a', 30 * MIN)]);
        await runWatchdogTick();
        listStaleRunningTasks.mockRejectedValueOnce(new Error('db down'));
        await runWatchdogTick();
        expect(resolvedOf('agent_task_stale')).toHaveLength(0);
        await runWatchdogTick();
        expect(resolvedOf('agent_task_stale')).toHaveLength(1);
    });

    it('두 번 멈췄다 두 번 회복하면 전이마다 해소 1건씩', async () => {
        listStaleRunningTasks.mockResolvedValueOnce([stale('a', 30 * MIN)]);
        await runWatchdogTick();
        await runWatchdogTick();
        listStaleRunningTasks.mockResolvedValueOnce([stale('b', 30 * MIN)]);
        await runWatchdogTick();
        await runWatchdogTick();
        expect(resolvedOf('agent_task_stale')).toHaveLength(2);
    });

    it('대기열 적체 → 정상 전이에 해소 1건(현재 값을 싣는다)', async () => {
        stats.mockReturnValueOnce({ globalActive: 4, pending: 25, wait: { oldestPendingMs: 1000 } });
        await runWatchdogTick();
        stats.mockReturnValue({ globalActive: 1, pending: 2, wait: { oldestPendingMs: 500 } });
        await runWatchdogTick();
        await runWatchdogTick();
        expect(resolvedOf('agent_task_queue_backlog')).toHaveLength(1);
        expect(resolvedOf('agent_task_queue_backlog')[0][3]).toEqual({ pending: 2, active: 1, oldestWaitMs: 500 });
    });

    it('모델 대기 장기화 → 정상 전이에 해소 1건, 집계 실패 tick 은 해소가 아니다', async () => {
        summarizeParkedByReason.mockResolvedValueOnce({ count: 2, longCount: 1, oldest: [{ id: 'm1', waited_ms: 40 * MIN }] });
        await runWatchdogTick();
        summarizeParkedByReason.mockRejectedValueOnce(new Error('db down'));
        await runWatchdogTick();
        expect(resolvedOf('agent_task_model_wait_long')).toHaveLength(0);
        summarizeParkedByReason.mockResolvedValueOnce({ count: 1, longCount: 0, oldest: [{ id: 'm2', waited_ms: MIN }] });
        await runWatchdogTick();
        expect(resolvedOf('agent_task_model_wait_long')).toHaveLength(1);
        expect(resolvedOf('agent_task_model_wait_long')[0][3]).toEqual({ parked: 1, thresholdMs: 1_800_000 });
    });
});

describe('runWatchdogTick — 오래된 pending(#1478)', () => {
    const stageError = () => gauge('agent_task_watchdog_stage_error', { stage: 'stale_pending' });
    const lastSuccess = () => gauge('agent_task_watchdog_stage_last_success_seconds', { stage: 'stale_pending' });
    const pendingGaugeCalls = () => setGauge.mock.calls.filter((c) => c[0] === 'agent_task_stale_pending');
    const many = { count: 57, oldestStalledMs: 95 * MIN, taskIds: ['p1', 'p2', 'p3', 'p4', 'p5'] };

    beforeEach(async () => {
        await runWatchdogTick(); // 앞 테스트가 남긴 경고 기억을 정상 tick 으로 비운다
        jest.clearAllMocks();
    });

    it('기존 STALE_MS 기준·표본 5개로 DB 집계를 부르고, 전체 건수(50건 초과)를 결과·게이지·경고 알림 1건에 싣는다', async () => {
        summarizeStalePendingTasks.mockResolvedValue(many);
        const r = await runWatchdogTick();
        expect(summarizeStalePendingTasks).toHaveBeenCalledWith(900_000, 5);
        expect(r.stalePending).toBe(57);
        expect(gauge('agent_task_stale_pending')).toBe(57);
        const calls = alertsOf('agent_task_stale_pending');
        expect(calls).toHaveLength(1);
        expect(calls[0][1]).toBe(ALERT_TEXT.agent_task_stale_pending.title);
        expect(calls[0][3]).toMatchObject({ count: 57, taskIds: ['p1', 'p2', 'p3', 'p4', 'p5'], oldestStalledMs: 95 * MIN });
        expect(stageError()).toBe(0);
        expect(lastSuccess()).toBeDefined();
    });

    it('성공한 빈 조회는 게이지 0·결과 0, 경고·해소 알림 없음', async () => {
        const before = Math.floor(Date.now() / 1000);
        const r = await runWatchdogTick();
        expect(r.stalePending).toBe(0);
        expect(gauge('agent_task_stale_pending')).toBe(0);
        expect(alertsOf('agent_task_stale_pending')).toHaveLength(0);
        expect(alertsOf('agent_task_stale_pending_resolved')).toHaveLength(0);
        expect(stageError()).toBe(0);
        expect(lastSuccess()).toBeGreaterThanOrEqual(before);
    });

    it('조회 실패는 오류 1 — 게이지를 0 으로 덮지 않고(이전 값 유지) 마지막 성공 시각도 갱신하지 않으며, 다른 단계는 정상으로 돈다', async () => {
        summarizeStalePendingTasks.mockRejectedValue(new Error('db down'));
        listStaleRunningTasks.mockResolvedValue([stale('a', 30 * MIN)]);
        const r = await runWatchdogTick();
        expect(stageError()).toBe(1);
        expect(lastSuccess()).toBeUndefined();
        expect(pendingGaugeCalls()).toHaveLength(0);
        expect(alertsOf('agent_task_stale_pending')).toHaveLength(0);
        for (const s of ['stale', 'queue', 'model_wait', 'status_count']) expect(gauge('agent_task_watchdog_stage_error', { stage: s })).toBe(0);
        expect(r.stale).toBe(1);
        expect(gauge('agent_task_stale_running')).toBe(1);
        expect(gauge('agent_task_status_count', { status: 'running' })).toBe(1);
    });

    it('앞 단계(멈춘 실행 중 작업)가 실패해도 오래된 pending 단계는 돈다', async () => {
        listStaleRunningTasks.mockRejectedValue(new Error('db down'));
        summarizeStalePendingTasks.mockResolvedValue({ count: 2, oldestStalledMs: 40 * MIN, taskIds: ['p1', 'p2'] });
        const r = await runWatchdogTick();
        expect(gauge('agent_task_watchdog_stage_error', { stage: 'stale' })).toBe(1);
        expect(stageError()).toBe(0);
        expect(r.stalePending).toBe(2);
        expect(gauge('agent_task_stale_pending')).toBe(2);
    });

    it('실패 뒤 성공하면 최신 값으로 갱신하고 오류를 0 으로 되돌린다', async () => {
        summarizeStalePendingTasks.mockRejectedValueOnce(new Error('db down'));
        await runWatchdogTick();
        expect(stageError()).toBe(1);
        setGauge.mockClear();
        summarizeStalePendingTasks.mockResolvedValueOnce({ count: 3, oldestStalledMs: 50 * MIN, taskIds: ['p1', 'p2', 'p3'] });
        await runWatchdogTick();
        expect(stageError()).toBe(0);
        expect(gauge('agent_task_stale_pending')).toBe(3);
        expect(lastSuccess()).toBeDefined();
    });

    it('경고 → 성공 정상 전이에 해소 1건, 이후 정상 tick 은 더 보내지 않는다', async () => {
        summarizeStalePendingTasks.mockResolvedValueOnce(many);
        await runWatchdogTick();
        await runWatchdogTick();
        await runWatchdogTick();
        const resolved = alertsOf('agent_task_stale_pending_resolved');
        expect(resolved).toHaveLength(1);
        expect(resolved[0][1]).toBe(ALERT_TEXT.agent_task_stale_pending_resolved.title);
    });

    it('조회 실패는 해소가 아니다 — 경고 기억을 지우지 않고, 다음 성공 정상 tick 에서 해소 1건', async () => {
        summarizeStalePendingTasks.mockResolvedValueOnce(many);
        await runWatchdogTick();
        summarizeStalePendingTasks.mockRejectedValueOnce(new Error('db down'));
        await runWatchdogTick();
        expect(alertsOf('agent_task_stale_pending_resolved')).toHaveLength(0);
        await runWatchdogTick();
        expect(alertsOf('agent_task_stale_pending_resolved')).toHaveLength(1);
    });

    it('두 번 경고했다 두 번 회복하면 전이마다 해소 1건씩', async () => {
        summarizeStalePendingTasks.mockResolvedValueOnce(many);
        await runWatchdogTick();
        await runWatchdogTick();
        summarizeStalePendingTasks.mockResolvedValueOnce({ count: 1, oldestStalledMs: 31 * MIN, taskIds: ['p9'] });
        await runWatchdogTick();
        await runWatchdogTick();
        expect(alertsOf('agent_task_stale_pending_resolved')).toHaveLength(2);
    });

    it('경고 기억은 단계마다 따로다 — 멈춘 실행 중 작업의 회복은 오래된 pending 해소를 보내지 않고, 반대도 같다', async () => {
        listStaleRunningTasks.mockResolvedValueOnce([stale('a', 30 * MIN)]);
        summarizeStalePendingTasks.mockResolvedValueOnce(many);
        await runWatchdogTick();
        // 실행 중 멈춤만 회복, pending 은 조회 실패(경고 유지)
        summarizeStalePendingTasks.mockRejectedValueOnce(new Error('db down'));
        await runWatchdogTick();
        expect(alertsOf('agent_task_stale_resolved')).toHaveLength(1);
        expect(alertsOf('agent_task_stale_pending_resolved')).toHaveLength(0);
        await runWatchdogTick();
        expect(alertsOf('agent_task_stale_resolved')).toHaveLength(1);
        expect(alertsOf('agent_task_stale_pending_resolved')).toHaveLength(1);
    });
});
