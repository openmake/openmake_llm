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
const dispatchAgentTask = jest.fn(async (_p: { taskId: string }) => undefined);
jest.mock('../task-queue', () => ({ dispatchAgentTask: (p: { taskId: string }) => dispatchAgentTask(p) }));
jest.mock('../../AgentTaskService', () => ({ AgentTaskService: jest.fn(() => ({ execute: async () => undefined })) }));
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
        expect(repo.markRun).toHaveBeenCalledWith('s1', expect.any(Number), dispatchAgentTask.mock.calls[0][0].taskId, false);
        expect(repo.recordRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'fired' }));
    });

    it('같은 발화의 작업이 이미 있으면(재시작 뒤) 다시 만들거나 제출하지 않고 발화 기록만 맞춘다', async () => {
        repo.getDue.mockResolvedValue([schedule({ last_task_id: null })]);
        repo.getLastTaskState.mockResolvedValue(null);
        createAgentTask.mockResolvedValue(false);
        findAgentTaskByCreateKey.mockResolvedValue({ id: 'existing-task' });
        await runScheduleTick(NOW);
        expect(dispatchAgentTask).not.toHaveBeenCalled();
        expect(repo.markRun).toHaveBeenCalledWith('s1', expect.any(Number), 'existing-task', false);
        expect(repo.markFailure).not.toHaveBeenCalled();
    });

    it('멈춘 채 남은 진행 중 표시(오래 갱신 없음)는 발화를 막지 않는다', async () => {
        repo.getDue.mockResolvedValue([schedule()]);
        repo.getLastTaskState.mockResolvedValue({ status: 'running', updatedAt: new Date(NOW - 3 * 60 * 60_000) });
        await runScheduleTick(NOW);
        expect(dispatchAgentTask).toHaveBeenCalledTimes(1);
    });
});

describe('runScheduleTick — 실행 결과 반영', () => {
    it('제출 성공만으로는 연속 실패를 풀지 않고, 작업에 종료 결과 통로를 넘긴다', async () => {
        repo.getDue.mockResolvedValue([schedule()]);
        repo.getLastTaskState.mockResolvedValue(null);
        const execute = jest.fn(async (_input: { onTerminal?: unknown }) => undefined);
        (jest.requireMock('../../AgentTaskService').AgentTaskService as jest.Mock).mockImplementation(() => ({ execute }));
        dispatchAgentTask.mockImplementationOnce(async (p: { taskId: string; run?: () => Promise<void> }) => { await p.run?.(); });
        await runScheduleTick(NOW);
        expect(repo.markRun).toHaveBeenCalledWith('s1', expect.any(Number), expect.any(String), false);
        expect(typeof execute.mock.calls[0][0].onTerminal).toBe('function');
    });
});

describe('runScheduleTick — 모델 미도달 재실행 발화', () => {
    it('정규 발화 시각은 그대로 두고, 정규 발화와 다른 멱등 키로 작업을 만든다', async () => {
        const s = schedule({ next_run_at: '2026-10-04T02:00:00.000Z', retry_at: '2026-10-04T00:59:00.000Z' });
        repo.getDue.mockResolvedValue([s]);
        repo.getLastTaskState.mockResolvedValue({ status: 'failed', updatedAt: new Date(NOW) });
        await runScheduleTick(NOW);
        const key = createAgentTask.mock.calls[0][0].idempotencyKey as string;
        expect(key).not.toBe(scheduleFireKey('s1', s.next_run_at));
        expect(key).toContain('retry');
        expect(repo.markRun).toHaveBeenCalledWith('s1', Date.parse(s.next_run_at as string), expect.any(String), false);
    });
});
