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
jest.mock('../../config/runtime-limits', () => ({
    AGENT_TASK_LIMITS: { BOOT_RECOVERY_ENABLED: true, BOOT_RECOVERY_WINDOW_MS: 60_000 },
}));
const execute = jest.fn(async () => undefined);
jest.mock('../AgentTaskService', () => ({ AgentTaskService: jest.fn().mockImplementation(() => ({ execute })) }));
const dispatch = jest.fn(async (entry: { run: () => Promise<void> }) => { await entry.run(); return 'started'; });
jest.mock('./task-queue', () => ({ dispatchAgentTask: (e: never) => dispatch(e) }));

import { recoverInterruptedAgentTasks } from './boot-recovery';

beforeEach(() => { interrupted.length = 0; jest.clearAllMocks(); });

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

    it('running 인데 checkpoint 가 없으면 종전대로 failed(interrupted)', async () => {
        interrupted.push({ ...base, status: 'running', checkpoint: null });
        const r = await recoverInterruptedAgentTasks();
        expect(r).toEqual({ resumed: 0, failed: 1 });
        expect(updateAgentTask).toHaveBeenCalledWith('t1', expect.objectContaining({ status: 'failed', error: 'interrupted' }));
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

    it('claim 에 실패하면(다른 프로세스가 선점) 건너뛴다', async () => {
        claim.mockResolvedValueOnce(false);
        interrupted.push({ ...base, status: 'queued', checkpoint: null });
        const r = await recoverInterruptedAgentTasks();
        expect(r).toEqual({ resumed: 0, failed: 0 });
        expect(execute).not.toHaveBeenCalled();
    });
});
