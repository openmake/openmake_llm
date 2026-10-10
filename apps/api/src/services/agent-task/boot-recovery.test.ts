/**
 * 부팅 복구 — 'queued' 고아 회수.
 *
 * 큐(3-B)는 인메모리라 재시작하면 대기열이 증발하는데 DB 행은 'queued' 로 남았다. 종전 복구는
 * running/paused/restart-마킹만 봐서 이 행은 영원히 '대기 중' 이었다(2026-08-25 발견).
 * queued 는 시작한 적이 없으므로 checkpoint 없이 처음부터 다시 디스패치되어야 한다.
 */
const updateAgentTask = jest.fn(async () => undefined);
const getAgentTaskSteps = jest.fn(async () => []);
const getUserById = jest.fn(async () => ({ role: 'user' }));
const claim = jest.fn(async () => true);
const interrupted: unknown[] = [];
const expired: unknown[] = [];
const takeOver = jest.fn(async () => true);
const runningHere = new Set<string>();

jest.mock('../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ updateAgentTask, getAgentTaskSteps, getUserById }),
    getPool: () => ({}),
}));
jest.mock('../../data/repositories/agent-task-repository', () => ({
    AgentTaskRepository: jest.fn().mockImplementation(() => ({
        getInterruptedAgentTasks: async () => interrupted,
        claimAgentTaskForRecovery: claim,
        listExpiredLeaseTasks: async () => expired,
        takeOverExpiredLease: takeOver,
    })),
}));
// 나머지 export(LOG_REDACT 등 — logger 가 읽는다)는 실제 값을 유지한다
jest.mock('../../config/runtime-limits', () => ({
    ...jest.requireActual('../../config/runtime-limits'),
    AGENT_TASK_LIMITS: { BOOT_RECOVERY_ENABLED: true, BOOT_RECOVERY_WINDOW_MS: 60_000, LEASE_ENABLED: true, LEASE_MS: 60_000 },
}));
const execute = jest.fn(async () => undefined);
jest.mock('../AgentTaskService', () => ({
    AgentTaskService: Object.assign(jest.fn().mockImplementation(() => ({ execute })), { isRunning: (id: string) => runningHere.has(id) }),
}));
const dispatch = jest.fn(async (entry: { run: () => Promise<void> }) => { await entry.run(); return 'started'; });
const queueHas = jest.fn((_id: string) => false);
jest.mock('./task-queue', () => ({ dispatchAgentTask: (e: never) => dispatch(e), getAgentTaskQueue: () => ({ has: queueHas }) }));

import { recoverInterruptedAgentTasks, sweepExpiredTaskLeases } from './boot-recovery';
import { leaseOwner } from './task-lease';

beforeEach(() => { interrupted.length = 0; expired.length = 0; runningHere.clear(); jest.clearAllMocks(); takeOver.mockResolvedValue(true); claim.mockResolvedValue(true); });

const base = { id: 't1', user_id: 'u1', goal: '목표', max_turns: 10, executor: 'server', input_files: null, input_images: null };

describe('recoverInterruptedAgentTasks — queued 고아', () => {
    it('queued 는 checkpoint 없이도 처음부터 재디스패치된다', async () => {
        interrupted.push({ ...base, status: 'queued', checkpoint: null });
        const r = await recoverInterruptedAgentTasks();
        expect(r).toEqual({ resumed: 1, failed: 0 });
        expect(claim).toHaveBeenCalledWith('t1');
        expect(execute).toHaveBeenCalledTimes(1);
        const input = (execute.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
        expect(input.resume).toBeUndefined();          // 처음부터
        expect(input.goal).toBe('목표');
        expect(updateAgentTask).not.toHaveBeenCalled(); // failed 로 정리하지 않는다
    });

    it('queued 재디스패치는 DB 에 남은 대기 등록 시각(updated_at)을 넘겨 대기 시간을 이어 잰다', async () => {
        interrupted.push({ ...base, status: 'queued', checkpoint: null, updated_at: '2026-10-05T00:00:00.000Z' });
        await recoverInterruptedAgentTasks();
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ enqueuedAt: Date.parse('2026-10-05T00:00:00.000Z') }));
    });

    it('checkpoint 재개는 새로 줄 서므로 등록 시각을 넘기지 않는다', async () => {
        interrupted.push({ ...base, status: 'failed', updated_at: '2026-10-05T00:00:00.000Z', checkpoint: { conversation: [{ role: 'user', content: 'x' }], completedTurn: 1 } });
        await recoverInterruptedAgentTasks();
        expect((dispatch.mock.calls[0] as unknown[])[0]).not.toHaveProperty('enqueuedAt');
    });

    it('running 인데 checkpoint 가 없으면 종전대로 failed(interrupted)', async () => {
        interrupted.push({ ...base, status: 'running', checkpoint: null });
        const r = await recoverInterruptedAgentTasks();
        expect(r).toEqual({ resumed: 0, failed: 1 });
        // 재시작으로 중단돼 실패 처리 — 알림 표식을 남긴다(174)
        expect(updateAgentTask).toHaveBeenCalledWith('t1', expect.objectContaining({ status: 'failed', error: 'interrupted', terminalNotifyPending: true }));
        expect(execute).not.toHaveBeenCalled();
    });

    it('checkpoint 가 있으면 resume 으로 재개된다 (기존 동작 보존)', async () => {
        interrupted.push({ ...base, status: 'failed', checkpoint: { conversation: [{ role: 'user', content: 'x' }], completedTurn: 2 } });
        const r = await recoverInterruptedAgentTasks();
        expect(r.resumed).toBe(1);
        const input = (execute.mock.calls[0] as unknown[])[0] as Record<string, { fromTurn: number }>;
        expect(input.resume.fromTurn).toBe(3);
    });

    it('queued 라도 로컬 실행 작업은 디바이스 미연결이라 failed 로 보류한다', async () => {
        interrupted.push({ ...base, status: 'queued', executor: 'local', checkpoint: null });
        const r = await recoverInterruptedAgentTasks();
        expect(r).toEqual({ resumed: 0, failed: 1 });
        expect(updateAgentTask).toHaveBeenCalledWith('t1', expect.objectContaining({ error: 'interrupted_local_device' }));
    });

    it('이 프로세스의 큐에 이미 실행·대기 중인 작업은 claim 하지 않고 건너뛴다(부팅 직후 /execute·/resume 가 먼저 제출)', async () => {
        interrupted.push({ ...base, status: 'queued', checkpoint: null });
        queueHas.mockReturnValueOnce(true);
        const r = await recoverInterruptedAgentTasks();
        expect(r).toEqual({ resumed: 0, failed: 0 });
        expect(queueHas).toHaveBeenCalledWith('t1');
        expect(claim).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('claim 에 실패하면(다른 프로세스가 선점) 건너뛴다', async () => {
        claim.mockResolvedValueOnce(false);
        interrupted.push({ ...base, status: 'queued', checkpoint: null });
        const r = await recoverInterruptedAgentTasks();
        expect(r).toEqual({ resumed: 0, failed: 0 });
        expect(execute).not.toHaveBeenCalled();
    });
});

describe('sweepExpiredTaskLeases — 소유권이 지난 작업을 가져와 이어 실행한다', () => {
    const cp = { conversation: [{ role: 'user', content: '목표' }], completedTurn: 2 };

    it('체크포인트가 있으면 소유권을 가져온 뒤 그 지점에서 재개한다', async () => {
        expired.push({ ...base, status: 'running', checkpoint: cp });
        const r = await sweepExpiredTaskLeases();
        expect(r).toEqual({ resumed: 1, failed: 0 });
        expect(takeOver).toHaveBeenCalledWith('t1', leaseOwner(), 60_000);
        expect(claim).toHaveBeenCalledWith('t1');
        const input = (execute.mock.calls[0] as unknown[])[0] as { resume?: { fromTurn: number } };
        expect(input.resume?.fromTurn).toBe(3);
    });

    it('체크포인트가 없으면 failed(interrupted)로 닫고 알림 표식을 남긴다', async () => {
        expired.push({ ...base, status: 'running', checkpoint: null });
        const r = await sweepExpiredTaskLeases();
        expect(r).toEqual({ resumed: 0, failed: 1 });
        expect(updateAgentTask).toHaveBeenCalledWith('t1', expect.objectContaining({ status: 'failed', error: 'interrupted', terminalNotifyPending: true }));
        expect(execute).not.toHaveBeenCalled();
    });

    it('다른 서버가 먼저 가져갔으면(가져오기 0행) 건드리지 않는다', async () => {
        takeOver.mockResolvedValue(false);
        expired.push({ ...base, status: 'running', checkpoint: cp });
        const r = await sweepExpiredTaskLeases();
        expect(r).toEqual({ resumed: 0, failed: 0 });
        expect(claim).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
        expect(updateAgentTask).not.toHaveBeenCalled();
    });

    it('이 프로세스가 실행 중인 작업은 가져오지 않는다(연장이 잠깐 밀린 것 — 다음 연장이 복구한다)', async () => {
        runningHere.add('t1');
        expired.push({ ...base, status: 'running', checkpoint: cp });
        const r = await sweepExpiredTaskLeases();
        expect(r).toEqual({ resumed: 0, failed: 0 });
        expect(takeOver).not.toHaveBeenCalled();
    });

    it('조회가 실패해도 던지지 않는다', async () => {
        const { AgentTaskRepository } = jest.requireMock('../../data/repositories/agent-task-repository') as { AgentTaskRepository: jest.Mock };
        AgentTaskRepository.mockImplementationOnce(() => ({ listExpiredLeaseTasks: async () => { throw new Error('db down'); } }));
        await expect(sweepExpiredTaskLeases()).resolves.toEqual({ resumed: 0, failed: 0 });
    });
});

describe('recoverInterruptedAgentTasks — 소유권 컬럼이 아직 없는 DB(176 적용 전)', () => {
    it('소유권 조건이 붙은 조회가 실패하면 종전 조회로 다시 시도해 복구를 이어간다', async () => {
        const { AgentTaskRepository } = jest.requireMock('../../data/repositories/agent-task-repository') as { AgentTaskRepository: jest.Mock };
        const getInterruptedAgentTasks = jest.fn(async (_w: number, owner?: string) => {
            if (owner) throw new Error('column "lease_owner" does not exist');
            return [{ ...base, status: 'queued', checkpoint: null }];
        });
        AgentTaskRepository.mockImplementationOnce(() => ({ getInterruptedAgentTasks, claimAgentTaskForRecovery: claim }));
        const r = await recoverInterruptedAgentTasks();
        expect(getInterruptedAgentTasks).toHaveBeenCalledTimes(2);
        expect(r).toEqual({ resumed: 1, failed: 0 });
    });
});
