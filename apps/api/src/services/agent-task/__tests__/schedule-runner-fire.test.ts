/**
 * 예약 발화 흐름 — 이전 실행이 돌고 있으면 건너뛰고, 같은 발화의 작업이 이미 있으면 다시 만들지 않는다.
 */
const repo = {
    getDue: jest.fn(),
    getLastTaskState: jest.fn(),
    markSkipped: jest.fn(async () => undefined),
    markRun: jest.fn(async () => undefined),
    markFailure: jest.fn(async () => undefined),
    recordRun: jest.fn(async () => undefined),
};
jest.mock('../../../data/repositories/agent-task-schedule-repository', () => ({ AgentTaskScheduleRepository: jest.fn(() => repo) }));
const createAgentTask = jest.fn();
const findAgentTaskByCreateKey = jest.fn();
jest.mock('../../../data/models/unified-database', () => ({
    getPool: () => ({}),
    getUnifiedDatabase: () => ({ createAgentTask, findAgentTaskByCreateKey, getUserById: async () => ({ role: 'user' }) }),
}));
const dispatchAgentTask = jest.fn(async (_p: { taskId: string; run: () => Promise<void> }) => undefined);
jest.mock('../task-queue', () => ({ dispatchAgentTask: (p: { taskId: string; run: () => Promise<void> }) => dispatchAgentTask(p) }));
const calls: string[] = [];
jest.mock('../../AgentTaskService', () => ({ AgentTaskService: jest.fn(() => ({ execute: async () => { calls.push('execute'); } })) }));
const setUnattended = jest.fn((_taskId: string, _on: boolean) => { calls.push('unattended'); });
jest.mock('../../task-sandbox/approval-gate', () => ({ getApprovalRegistry: () => ({ setUnattended }) }));
jest.mock('../../PushService', () => ({ getPushService: () => ({ sendPush: async () => undefined }) }));
jest.mock('../schedule-publish', () => ({ publishScheduleOutput: async () => undefined }));
jest.mock('../../../data/user-manager', () => ({ isAdminRole: () => false, getUserManager: () => ({ getUserById: async () => ({ role: 'user' }) }) }));

import { runScheduleTick } from '../schedule-runner';
import { scheduleFireKey } from '../schedule-fire';

const NOW = Date.parse('2026-10-04T01:00:00Z');
const schedule = (over: Record<string, unknown> = {}) => ({
    id: 's1', user_id: 'u1', goal: '일일 보고', cron: null, interval_seconds: 600, max_turns: 8,
    next_run_at: '2026-10-04T01:00:00.000Z', enabled: true, last_task_id: 'prev', consecutive_failures: 0, ...over,
});

beforeEach(() => { jest.clearAllMocks(); createAgentTask.mockResolvedValue(true); });

describe('runScheduleTick — 발화', () => {
    it('이전 실행이 아직 돌고 있으면 작업을 만들지 않고 건너뛴 사실을 남긴다', async () => {
        repo.getDue.mockResolvedValue([schedule()]);
        repo.getLastTaskState.mockResolvedValue({ status: 'running', updatedAt: new Date(NOW - 60_000) });
        await runScheduleTick(NOW);
        expect(createAgentTask).not.toHaveBeenCalled();
        expect(dispatchAgentTask).not.toHaveBeenCalled();
        expect(repo.markSkipped).toHaveBeenCalledWith('s1', expect.any(Number));
        expect(repo.recordRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'skipped' }));
        expect(repo.markFailure).not.toHaveBeenCalled();
    });

    it('이전 실행이 끝났으면 발화 멱등 키와 함께 작업을 만들고 제출한다', async () => {
        const s = schedule();
        repo.getDue.mockResolvedValue([s]);
        repo.getLastTaskState.mockResolvedValue({ status: 'completed', updatedAt: new Date(NOW) });
        await runScheduleTick(NOW);
        expect(createAgentTask).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', idempotencyKey: scheduleFireKey('s1', s.next_run_at) }));
        expect(dispatchAgentTask).toHaveBeenCalledTimes(1);
        expect(repo.markRun).toHaveBeenCalledWith('s1', expect.any(Number), dispatchAgentTask.mock.calls[0][0].taskId);
        expect(repo.recordRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'fired' }));
    });

    it('예약 실행은 시작 전에 무인 작업으로 표시한다 — 승인이 필요한 호출을 기다리지 않게', async () => {
        repo.getDue.mockResolvedValue([schedule()]);
        repo.getLastTaskState.mockResolvedValue(null);
        calls.length = 0;
        dispatchAgentTask.mockImplementationOnce(async (p) => { await p.run(); return undefined; });
        await runScheduleTick(NOW);
        expect(setUnattended).toHaveBeenCalledWith(dispatchAgentTask.mock.calls[0][0].taskId, true);
        expect(calls).toEqual(['unattended', 'execute']);
    });

    it('같은 발화의 작업이 이미 있으면(재시작 뒤) 다시 만들거나 제출하지 않고 발화 기록만 맞춘다', async () => {
        repo.getDue.mockResolvedValue([schedule({ last_task_id: null })]);
        repo.getLastTaskState.mockResolvedValue(null);
        createAgentTask.mockResolvedValue(false);
        findAgentTaskByCreateKey.mockResolvedValue({ id: 'existing-task' });
        await runScheduleTick(NOW);
        expect(dispatchAgentTask).not.toHaveBeenCalled();
        expect(repo.markRun).toHaveBeenCalledWith('s1', expect.any(Number), 'existing-task');
        expect(repo.markFailure).not.toHaveBeenCalled();
    });

    it('멈춘 채 남은 진행 중 표시(오래 갱신 없음)는 발화를 막지 않는다', async () => {
        repo.getDue.mockResolvedValue([schedule()]);
        repo.getLastTaskState.mockResolvedValue({ status: 'running', updatedAt: new Date(NOW - 3 * 60 * 60_000) });
        await runScheduleTick(NOW);
        expect(dispatchAgentTask).toHaveBeenCalledTimes(1);
    });
});
