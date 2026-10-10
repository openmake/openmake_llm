/**
 * 부팅 복구 — 큐 비활성(기본)에서 이미 이 프로세스가 실행 중인 작업을 claim 하지 않는다.
 *
 * 복구가 대상 목록을 읽은 뒤 /execute·/resume 가 먼저 시작한 작업을 claimAgentTaskForRecovery 로 잡으면 실행 중인 행이
 * pending 으로 덮이고, 두 번째 실행은 AgentTaskService.execute 가 조용히 버린다. 큐가 꺼져 있어도 디스패치가 실행 중 표시를
 * 남기므로(task-queue runDirect) 복구는 claim 전에 건너뛴다. task-queue 는 실제 모듈을 쓴다.
 */
const claim = jest.fn(async () => true);
const interrupted: unknown[] = [];
jest.mock('../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ updateAgentTask: jest.fn(async () => undefined), getAgentTaskSteps: async () => [], getUserById: async () => ({ role: 'user' }) }),
    getPool: () => ({}),
}));
jest.mock('../../data/repositories/agent-task-repository', () => ({
    AgentTaskRepository: jest.fn().mockImplementation(() => ({ getInterruptedAgentTasks: async () => interrupted, claimAgentTaskForRecovery: claim })),
}));
const execute = jest.fn(async () => undefined);
jest.mock('../AgentTaskService', () => ({ AgentTaskService: Object.assign(jest.fn().mockImplementation(() => ({ execute })), { isRunning: () => false }) }));

import { recoverInterruptedAgentTasks } from './boot-recovery';
import { dispatchAgentTask } from './task-queue';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';

const task = { id: 'boot-off-1', user_id: 'u1', goal: '목표', max_turns: 10, executor: 'server', input_files: null, input_images: null, status: 'running', checkpoint: { conversation: [{ role: 'user', content: 'x' }], completedTurn: 1 } };

it('큐가 꺼져 있어도, 조회 뒤 먼저 시작해 실행 중인 작업은 claim·재디스패치하지 않는다 — 실행이 끝난 뒤에는 복구한다', async () => {
    expect(AGENT_TASK_LIMITS.QUEUE_ENABLED).toBe(false); // 기본 설정
    let finish!: () => void;
    const running = new Promise<void>((r) => { finish = r; });
    await expect(dispatchAgentTask({ taskId: task.id, userId: 'u1', run: () => running })).resolves.toBe('started');
    interrupted.push(task);

    await expect(recoverInterruptedAgentTasks()).resolves.toEqual({ resumed: 0, failed: 0 });
    expect(claim).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();

    finish();
    await new Promise((r) => setImmediate(r));
    await expect(recoverInterruptedAgentTasks()).resolves.toEqual({ resumed: 1, failed: 0 });
    expect(claim).toHaveBeenCalledWith(task.id, 'running');
    expect(execute).toHaveBeenCalledTimes(1);
});
