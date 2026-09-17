/**
 * 주차 재개·스윕(F16.7) — 재개는 주차 작업만 claim 후 체크포인트로 dispatch, 스윕은 결정 도착 재개·상한 초과 실패·대기 workspace 갱신.
 */
const getAgentTask = jest.fn();
const getAgentTaskSteps = jest.fn(async () => [{}, {}, {}]);
const updateAgentTask = jest.fn(async () => undefined);
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getAgentTask, getAgentTaskSteps, updateAgentTask }), getPool: () => ({}) }));
const claimParkedTask = jest.fn(async () => true);
const listParkedTasks = jest.fn();
jest.mock('../../../data/repositories/agent-task-repository', () => ({ AgentTaskRepository: jest.fn().mockImplementation(() => ({ claimParkedTask, listParkedTasks })) }));
const expirePendingForTask = jest.fn(async () => undefined);
jest.mock('../../../data/repositories/agent-task-approval-repository', () => ({ AgentTaskApprovalRepository: jest.fn().mockImplementation(() => ({ expirePendingForTask })) }));
const execute = jest.fn(async () => undefined);
jest.mock('../../AgentTaskService', () => ({ AgentTaskService: jest.fn().mockImplementation(() => ({ execute })) }));
const dispatchAgentTask = jest.fn(async (e: { run: () => Promise<void> }) => { await e.run(); return 'started'; });
jest.mock('../task-queue', () => ({ dispatchAgentTask: (e: { run: () => Promise<void> }) => dispatchAgentTask(e) }));
jest.mock('../boot-recovery', () => ({ resolveUserRole: async () => 'user' }));
let bridgeEnabled = true;
jest.mock('../../../config/local-bridge', () => ({ LOCAL_BRIDGE: { get ENABLED() { return bridgeEnabled; } } }));
const getDevice = jest.fn();
jest.mock('../../local-bridge/registry', () => ({ getLocalBridgeRegistry: () => ({ getDevice }) }));
const utimes = jest.fn(async () => undefined);
jest.mock('fs/promises', () => ({ utimes: (...a: unknown[]) => utimes(...(a as [])) }));

import { resumeParkedTask, sweepParkedTasks, AGENT_TASK_PARK_EXPIRED_ERROR } from '../hitl-park';

const parkedTask = {
    id: 't1', user_id: 'u1', goal: 'g', status: 'paused', max_turns: 10, priority: 2, executor: 'sandbox',
    checkpoint: { conversation: [{ role: 'user', content: 'g' }], completedTurn: 3 }, plan: [{ text: 'a', status: 'in_progress' }],
    input_files: null, input_images: null,
};

beforeEach(() => { jest.clearAllMocks(); bridgeEnabled = true; claimParkedTask.mockResolvedValue(true); });

describe('resumeParkedTask', () => {
    it('주차 작업을 claim 하고 체크포인트 다음 턴부터 같은 우선순위로 재개한다', async () => {
        getAgentTask.mockResolvedValue(parkedTask);
        await expect(resumeParkedTask('t1')).resolves.toBe(true);
        expect(claimParkedTask).toHaveBeenCalledWith('t1');
        expect(dispatchAgentTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: 't1', userId: 'u1', priority: 2 }));
        expect(execute).toHaveBeenCalledWith(expect.objectContaining({
            taskId: 't1', resume: expect.objectContaining({ fromTurn: 4, fromStep: 3, plan: parkedTask.plan }),
        }));
    });

    it('paused 가 아니거나 체크포인트가 없거나 claim 에 지면 재개하지 않는다', async () => {
        getAgentTask.mockResolvedValueOnce({ ...parkedTask, status: 'running' });
        await expect(resumeParkedTask('t1')).resolves.toBe(false);
        getAgentTask.mockResolvedValueOnce({ ...parkedTask, checkpoint: null });
        await expect(resumeParkedTask('t1')).resolves.toBe(false);
        getAgentTask.mockResolvedValueOnce(parkedTask);
        claimParkedTask.mockResolvedValueOnce(false);
        await expect(resumeParkedTask('t1')).resolves.toBe(false);
        expect(dispatchAgentTask).not.toHaveBeenCalled();
    });

    it('로컬 실행 작업은 디바이스가 연결돼 있을 때만 재개(claim 전에 판단)', async () => {
        getAgentTask.mockResolvedValue({ ...parkedTask, executor: 'local', device_id: 'd1' });
        getDevice.mockReturnValueOnce(undefined);
        await expect(resumeParkedTask('t1')).resolves.toBe(false);
        expect(claimParkedTask).not.toHaveBeenCalled();
        getDevice.mockReturnValueOnce({ id: 'd1' });
        await expect(resumeParkedTask('t1')).resolves.toBe(true);
        expect(execute).toHaveBeenCalledWith(expect.objectContaining({ executor: 'local', deviceId: 'd1' }));
    });
});

describe('sweepParkedTasks', () => {
    it('결정 도착은 재개, 대기 상한 초과는 실패, 대기 중은 workspace mtime 갱신', async () => {
        listParkedTasks.mockResolvedValue([
            { id: 't1', workspace_path: '/ws/t1', has_decision: true, has_live_pending: false },
            { id: 't2', workspace_path: '/ws/t2', has_decision: false, has_live_pending: false },
            { id: 't3', workspace_path: '/ws/t3', has_decision: false, has_live_pending: true },
            { id: 't4', workspace_path: null, has_decision: false, has_live_pending: true },
        ]);
        getAgentTask.mockResolvedValue(parkedTask);
        await expect(sweepParkedTasks()).resolves.toEqual({ resumed: 1, expired: 1, touched: 1 });
        expect(expirePendingForTask).toHaveBeenCalledWith('t2', 'expired');
        expect(updateAgentTask).toHaveBeenCalledWith('t2', { status: 'failed', error: AGENT_TASK_PARK_EXPIRED_ERROR });
        expect(utimes).toHaveBeenCalledWith('/ws/t3', expect.any(Date), expect.any(Date));
    });

    it('조회·개별 처리 실패는 삼킨다', async () => {
        listParkedTasks.mockRejectedValueOnce(new Error('db'));
        await expect(sweepParkedTasks()).resolves.toEqual({ resumed: 0, expired: 0, touched: 0 });
        listParkedTasks.mockResolvedValueOnce([{ id: 't2', workspace_path: null, has_decision: false, has_live_pending: false }]);
        expirePendingForTask.mockRejectedValueOnce(new Error('boom'));
        await expect(sweepParkedTasks()).resolves.toEqual({ resumed: 0, expired: 0, touched: 0 });
    });
});
