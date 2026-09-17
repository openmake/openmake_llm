/**
 * 승인·계획 변경 알림(HITL 2단계 D7) — 작업의 현재 상태를 DB 에서 읽어 선택 필드와 함께 발행, 실패는 삼킨다.
 */
const getAgentTask = jest.fn();
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../../data/repositories/agent-task-repository', () => ({
    AgentTaskRepository: jest.fn().mockImplementation(() => ({ getAgentTask })),
}));

import { notifyApprovalChange } from '../approval-change-notify';
import { AGENT_TASK_PROGRESS, getEventBus, type AgentTaskProgressEvent } from '../../../utils/event-bus';

describe('notifyApprovalChange', () => {
    const events: AgentTaskProgressEvent[] = [];
    const listener = (ev: AgentTaskProgressEvent) => events.push(ev);
    beforeAll(() => getEventBus().on(AGENT_TASK_PROGRESS, listener));
    afterAll(() => getEventBus().off(AGENT_TASK_PROGRESS, listener));
    beforeEach(() => { events.length = 0; getAgentTask.mockReset(); });

    it('받는 사용자에게 작업의 현재 상태와 approvalId·reason 을 싣는다', async () => {
        getAgentTask.mockResolvedValue({ id: 't1', status: 'paused', progress: 40, current_turn: 3 });
        await notifyApprovalChange({ userId: 'u2', taskId: 't1', approvalId: 'apv1', reason: 'assigned' });
        expect(events).toEqual([{ userId: 'u2', taskId: 't1', status: 'paused', progress: 40, currentTurn: 3, reason: 'assigned', approvalId: 'apv1' }]);
    });

    it('계획 편집처럼 approvalId 가 없으면 필드를 싣지 않는다', async () => {
        getAgentTask.mockResolvedValue({ id: 't1', status: 'running', progress: 10, current_turn: 1 });
        await notifyApprovalChange({ userId: 'u1', taskId: 't1', reason: 'plan_edited' });
        expect(events[0]).not.toHaveProperty('approvalId');
        expect(events[0].reason).toBe('plan_edited');
    });

    it('작업이 없거나 조회가 실패하면 발행하지 않고 throw 하지 않는다', async () => {
        getAgentTask.mockResolvedValueOnce(undefined);
        await notifyApprovalChange({ userId: 'u1', taskId: 'gone', reason: 'revoked', approvalId: 'a' });
        getAgentTask.mockRejectedValueOnce(new Error('db down'));
        await expect(notifyApprovalChange({ userId: 'u1', taskId: 't1', reason: 'revoked', approvalId: 'a' })).resolves.toBeUndefined();
        expect(events).toHaveLength(0);
    });
});
