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
const countRecoveries = jest.fn(async (_id: string) => 0);
const failRecoveryLimit = jest.fn(async (_id: string, _prev: string) => true);

jest.mock('../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ updateAgentTask, getAgentTaskSteps, getUserById }),
    getPool: () => ({}),
}));
jest.mock('../../data/repositories/agent-task-repository', () => ({
    AgentTaskRepository: jest.fn().mockImplementation(() => ({
        getInterruptedAgentTasks: async () => interrupted,
        claimAgentTaskForRecovery: claim,
    })),
}));
jest.mock('../../data/repositories/agent-task-lease-repository', () => ({
    AgentTaskLeaseRepository: jest.fn().mockImplementation(() => ({
        listExpiredLeaseTasks: async () => expired,
        takeOverExpiredLease: takeOver,
    })),
}));
jest.mock('../../data/repositories/agent-task-run-repository', () => ({
    ...jest.requireActual('../../data/repositories/agent-task-run-repository'),
    AgentTaskRunRepository: jest.fn().mockImplementation(() => ({ countRecoveriesWithoutProgress: countRecoveries, failRecoveryLimit })),
}));
// 나머지 export(LOG_REDACT 등 — logger 가 읽는다)는 실제 값을 유지한다
jest.mock('../../config/runtime-limits', () => ({
    ...jest.requireActual('../../config/runtime-limits'),
    AGENT_TASK_LIMITS: { BOOT_RECOVERY_ENABLED: true, BOOT_RECOVERY_WINDOW_MS: 60_000, LEASE_ENABLED: true, LEASE_MS: 60_000, RECOVERY_MAX_ATTEMPTS: 3 },
}));
const localBridge = { ENABLED: false, DEVICE_WAIT_ENABLED: true };
jest.mock('../../config/local-bridge', () => ({ LOCAL_BRIDGE: localBridge }));
const parkForDeviceRecovery = jest.fn(async (_id: string, _prev: string) => true);
jest.mock('../../data/repositories/agent-task-park-repository', () => ({
    AgentTaskParkRepository: jest.fn().mockImplementation(() => ({ parkForDeviceRecovery })),
}));
const resumeParkedTask = jest.fn(async (_id: string) => false);
jest.mock('./hitl-park', () => ({ resumeParkedTask: (id: string) => resumeParkedTask(id) }));
const execute = jest.fn(async () => undefined);
jest.mock('../AgentTaskService', () => ({
    AgentTaskService: Object.assign(jest.fn().mockImplementation(() => ({ execute })), { isRunning: (id: string) => runningHere.has(id) }),
}));
const dispatch = jest.fn(async (entry: { run: () => Promise<void> }) => { await entry.run(); return 'started'; });
const queueHas = jest.fn((_id: string) => false);
jest.mock('./task-queue', () => ({ dispatchAgentTask: (e: never) => dispatch(e), getAgentTaskQueue: () => ({ has: queueHas }) }));

import { recoverInterruptedAgentTasks, sweepExpiredTaskLeases } from './boot-recovery';
import { leaseOwner } from './task-lease';
import { beginAgentTaskShutdown, resetAgentTaskShutdownForTest } from './shutdown-drain';

beforeEach(() => { interrupted.length = 0; expired.length = 0; runningHere.clear(); jest.clearAllMocks(); takeOver.mockResolvedValue(true); claim.mockResolvedValue(true); countRecoveries.mockResolvedValue(0); failRecoveryLimit.mockResolvedValue(true); localBridge.ENABLED = false; localBridge.DEVICE_WAIT_ENABLED = true; parkForDeviceRecovery.mockResolvedValue(true); resumeParkedTask.mockResolvedValue(false); });

const base = { id: 't1', user_id: 'u1', goal: '목표', max_turns: 10, executor: 'server', input_files: null, input_images: null };
/** claim 이 같은 문장에서 쓰는 소유권(2026-10-22 R2) — 모의 AGENT_TASK_LIMITS.LEASE_MS 와 같다 */
const lease = () => ({ owner: leaseOwner(), leaseMs: 60_000 });

describe('recoverInterruptedAgentTasks — queued 고아', () => {
    it('queued 는 checkpoint 없이도 처음부터 재디스패치된다', async () => {
        interrupted.push({ ...base, status: 'queued', checkpoint: null });
        const r = await recoverInterruptedAgentTasks();
        expect(r).toEqual({ resumed: 1, failed: 0 });
        expect(claim).toHaveBeenCalledWith('t1', 'queued', lease()); // 읽을 때의 상태 — 그 뒤 /execute 가 잡아 바뀐 행은 claim 이 0행이다
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

    it('기기 대기를 쓰지 않는 설정이면 queued 라도 로컬 실행 작업은 종전대로 failed 로 보류한다', async () => {
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
        expect(claim).toHaveBeenCalledWith('t1', 'running', lease());
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

    it('서버 종료 중에는 가져오지 않는다 — 가져와도 실행을 시작하지 못한다', async () => {
        expired.push({ ...base, status: 'running', checkpoint: cp });
        beginAgentTaskShutdown();
        try {
            await expect(sweepExpiredTaskLeases()).resolves.toEqual({ resumed: 0, failed: 0 });
        } finally { resetAgentTaskShutdownForTest(); }
        expect(takeOver).not.toHaveBeenCalled();
        expect(claim).not.toHaveBeenCalled();
    });

    it('조회가 실패해도 던지지 않는다', async () => {
        const { AgentTaskLeaseRepository } = jest.requireMock('../../data/repositories/agent-task-lease-repository') as { AgentTaskLeaseRepository: jest.Mock };
        AgentTaskLeaseRepository.mockImplementationOnce(() => ({ listExpiredLeaseTasks: async () => { throw new Error('db down'); } }));
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
        expect(claim).toHaveBeenCalledWith('t1', 'queued', undefined); // 소유권 컬럼이 없으니 claim 도 종전 문장으로
    });
});

// claim(pending 전이)과 running 사이에서 프로세스가 죽으면 행이 영원히 pending 으로 남았다 — 복구 조회·소유권 점검 어느 쪽도 pending 을
// 보지 않았다. claim 이 소유권을 같이 쓰므로 'pending + 소유권' 이 곧 진행 중이던 claim 이다(2026-10-22 R2).
describe('claim 고아(pending + 소유권) 회수', () => {
    const cp = { conversation: [{ role: 'user', content: '목표' }], completedTurn: 4 };
    const orphan = { ...base, status: 'pending', lease_owner: 'dead:0', lease_until: new Date(Date.now() - 120_000).toISOString(), checkpoint: cp };

    it('소유권 있는 pending 작업을 복구 대상으로 받으면 claim 에 소유권(owner·LEASE_MS)을 넘기고 디스패치한다', async () => {
        interrupted.push(orphan);
        await expect(recoverInterruptedAgentTasks()).resolves.toEqual({ resumed: 1, failed: 0 });
        expect(claim).toHaveBeenCalledWith('t1', 'pending', { owner: expect.any(String), leaseMs: 60_000 });
        expect(dispatch).toHaveBeenCalledTimes(1);
        const input = (execute.mock.calls[0] as unknown[])[0] as { resume?: { fromTurn: number } };
        expect(input.resume?.fromTurn).toBe(5); // 체크포인트 다음 턴부터
        expect(updateAgentTask).not.toHaveBeenCalled();
    });

    it('소유권 점검이 지난 소유권의 pending 행을 받아도 같은 경로로 재개한다', async () => {
        expired.push(orphan);
        await expect(sweepExpiredTaskLeases()).resolves.toEqual({ resumed: 1, failed: 0 });
        expect(takeOver).toHaveBeenCalledWith('t1', leaseOwner(), 60_000);
        expect(claim).toHaveBeenCalledWith('t1', 'pending', lease());
        expect(dispatch).toHaveBeenCalledTimes(1);
        const input = (execute.mock.calls[0] as unknown[])[0] as { resume?: { fromTurn: number } };
        expect(input.resume?.fromTurn).toBe(5);
    });

    it('체크포인트 없는 pending 고아(대기·처음부터 재개를 claim 한 뒤 죽음)는 처음부터 다시 디스패치한다', async () => {
        expired.push({ ...orphan, checkpoint: null });
        await expect(sweepExpiredTaskLeases()).resolves.toEqual({ resumed: 1, failed: 0 });
        expect(claim).toHaveBeenCalledWith('t1', 'pending', lease());
        const input = (execute.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
        expect(input.resume).toBeUndefined();
        expect(updateAgentTask).not.toHaveBeenCalled();
    });

    it('기기 대기를 쓰지 않는 설정의 로컬 작업 pending 고아는 running 과 같이 failed 로 닫는다(skipped 로 남겨 주기마다 다시 가져오지 않게)', async () => {
        expired.push({ ...orphan, executor: 'local' });
        localBridge.ENABLED = false;
        await expect(sweepExpiredTaskLeases()).resolves.toEqual({ resumed: 0, failed: 1 });
        expect(updateAgentTask).toHaveBeenCalledWith('t1', expect.objectContaining({ status: 'failed', error: 'interrupted_local_device' }));
        expect(claim).not.toHaveBeenCalled();
    });

    it('기기 대기를 쓰는 로컬 작업 pending 고아는 읽은 상태(pending)로 기기 대기 주차를 요청한다', async () => {
        expired.push({ ...orphan, executor: 'local' });
        localBridge.ENABLED = true;
        await expect(sweepExpiredTaskLeases()).resolves.toEqual({ resumed: 0, failed: 0 });
        expect(parkForDeviceRecovery).toHaveBeenCalledWith('t1', 'pending');
        expect(claim).not.toHaveBeenCalled();
    });

    it('진행 없는 복구 상한에 닿은 pending 고아는 읽은 상태(pending)로 failed(recovery_limit) 닫기를 요청한다', async () => {
        expired.push(orphan);
        countRecoveries.mockResolvedValueOnce(3);
        await expect(sweepExpiredTaskLeases()).resolves.toEqual({ resumed: 0, failed: 1 });
        expect(failRecoveryLimit).toHaveBeenCalledWith('t1', 'pending');
        expect(dispatch).not.toHaveBeenCalled();
    });

    // claim → running 전 죽음 → 다시 claim 이 끝없이 돌지 않게 — 체크포인트 없는 pending 고아도 상한을 센다(진짜 queued 만 면제)
    it('체크포인트 없는 pending 고아도 진행 없는 복구가 상한에 닿으면 failed(recovery_limit)로 닫는다', async () => {
        expired.push({ ...orphan, checkpoint: null });
        countRecoveries.mockResolvedValueOnce(3);
        await expect(sweepExpiredTaskLeases()).resolves.toEqual({ resumed: 0, failed: 1 });
        expect(failRecoveryLimit).toHaveBeenCalledWith('t1', 'pending');
        expect(claim).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });
});

// 작업 하나가 프로세스를 죽이면(메모리 한도 재시작 등) 재시작 → 자동 재개 → 다시 죽음이 끝없이 돈다
describe('진행 없이 되풀이되는 복구 끊기', () => {
    const resumable = { ...base, status: 'failed', checkpoint: { conversation: [{ role: 'user', content: 'x' }], completedTurn: 2 } };

    it('진행 없는 복구가 상한에 닿은 작업은 다시 재개하지 않고 failed(recovery_limit)로 닫는다', async () => {
        interrupted.push(resumable);
        countRecoveries.mockResolvedValueOnce(3);
        const r = await recoverInterruptedAgentTasks();
        expect(r).toEqual({ resumed: 0, failed: 1 });
        expect(failRecoveryLimit).toHaveBeenCalledWith('t1', 'failed');
        expect(claim).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('상한 미만이면 종전대로 재개한다', async () => {
        interrupted.push(resumable);
        countRecoveries.mockResolvedValueOnce(2);
        await expect(recoverInterruptedAgentTasks()).resolves.toEqual({ resumed: 1, failed: 0 });
        expect(failRecoveryLimit).not.toHaveBeenCalled();
    });

    it('닫는 사이 다른 요청이 잡았으면(0행) 건너뛴다', async () => {
        interrupted.push(resumable);
        countRecoveries.mockResolvedValueOnce(3);
        failRecoveryLimit.mockResolvedValueOnce(false);
        await expect(recoverInterruptedAgentTasks()).resolves.toEqual({ resumed: 0, failed: 0 });
        expect(claim).not.toHaveBeenCalled();
    });

    it('횟수 조회가 실패하면 복구를 막지 않는다', async () => {
        interrupted.push(resumable);
        countRecoveries.mockRejectedValueOnce(new Error('db down'));
        await expect(recoverInterruptedAgentTasks()).resolves.toEqual({ resumed: 1, failed: 0 });
    });

    it('실행한 적 없는 대기(queued) 작업은 세지 않고 다시 제출한다', async () => {
        interrupted.push({ ...base, status: 'queued', checkpoint: null });
        countRecoveries.mockResolvedValue(9);
        await expect(recoverInterruptedAgentTasks()).resolves.toEqual({ resumed: 1, failed: 0 });
        expect(countRecoveries).not.toHaveBeenCalled();
    });

    it('소유권이 지난 작업을 가져올 때도 같은 상한을 쓴다', async () => {
        expired.push({ ...resumable, status: 'running', lease_owner: 'other:0' });
        countRecoveries.mockResolvedValueOnce(3);
        await expect(sweepExpiredTaskLeases()).resolves.toEqual({ resumed: 0, failed: 1 });
        expect(failRecoveryLimit).toHaveBeenCalledWith('t1', 'running');
        expect(dispatch).not.toHaveBeenCalled();
    });
});

// 종전엔 재시작(배포)마다 실행 중이던 로컬 기기 작업이 실패로 남아 사용자가 직접 이어 해야 했다
describe('로컬 기기 작업 — 재시작 뒤 기기 대기로 주차', () => {
    const local = { ...base, executor: 'local', status: 'failed', checkpoint: { conversation: [{ role: 'user', content: 'x' }], completedTurn: 2 } };
    beforeEach(() => { localBridge.ENABLED = true; });

    it('체크포인트가 있는 로컬 작업은 실패로 두지 않고 기기 대기로 주차한다(기기가 붙으면 이어진다)', async () => {
        interrupted.push(local);
        const r = await recoverInterruptedAgentTasks();
        expect(r).toEqual({ resumed: 0, failed: 0 });
        expect(parkForDeviceRecovery).toHaveBeenCalledWith('t1', 'failed');
        expect(updateAgentTask).not.toHaveBeenCalled();
        expect(claim).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
        expect(resumeParkedTask).toHaveBeenCalledWith('t1'); // 기기가 이미 붙어 있으면 스윕을 기다리지 않는다
    });

    it('기기가 이미 연결돼 있어 바로 재개됐으면 재개로 센다', async () => {
        interrupted.push(local);
        resumeParkedTask.mockResolvedValueOnce(true);
        await expect(recoverInterruptedAgentTasks()).resolves.toEqual({ resumed: 1, failed: 0 });
    });

    it('실행한 적 없는 대기(queued) 로컬 작업도 주차한다', async () => {
        interrupted.push({ ...base, executor: 'local', status: 'queued', checkpoint: null });
        await expect(recoverInterruptedAgentTasks()).resolves.toEqual({ resumed: 0, failed: 0 });
        expect(parkForDeviceRecovery).toHaveBeenCalledWith('t1', 'queued');
        expect(updateAgentTask).not.toHaveBeenCalled();
    });

    it('주차하는 사이 다른 요청이 잡았으면(0행) 재개를 시도하지 않는다', async () => {
        interrupted.push(local);
        parkForDeviceRecovery.mockResolvedValueOnce(false);
        await expect(recoverInterruptedAgentTasks()).resolves.toEqual({ resumed: 0, failed: 0 });
        expect(resumeParkedTask).not.toHaveBeenCalled();
    });

    it('즉시 재개 시도가 실패해도 주차는 유지되고 던지지 않는다(스윕이 다시 본다)', async () => {
        interrupted.push(local);
        resumeParkedTask.mockRejectedValueOnce(new Error('boom'));
        await expect(recoverInterruptedAgentTasks()).resolves.toEqual({ resumed: 0, failed: 0 });
    });

    it('진행 없는 복구가 상한에 닿은 로컬 작업은 주차하지 않고 닫는다', async () => {
        interrupted.push(local);
        countRecoveries.mockResolvedValueOnce(3);
        await expect(recoverInterruptedAgentTasks()).resolves.toEqual({ resumed: 0, failed: 1 });
        expect(failRecoveryLimit).toHaveBeenCalledWith('t1', 'failed');
        expect(parkForDeviceRecovery).not.toHaveBeenCalled();
    });

    it('체크포인트 없이 실행 중이던 로컬 작업은 종전대로 failed(interrupted)', async () => {
        interrupted.push({ ...base, executor: 'local', status: 'running', checkpoint: null });
        await expect(recoverInterruptedAgentTasks()).resolves.toEqual({ resumed: 0, failed: 1 });
        expect(updateAgentTask).toHaveBeenCalledWith('t1', expect.objectContaining({ error: 'interrupted' }));
        expect(parkForDeviceRecovery).not.toHaveBeenCalled();
    });
});
