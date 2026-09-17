/**
 * 승인 이관·에스컬레이션·철회가 받는 사용자에게 agent_task_progress 변경 알림을 보내는지(HITL 2단계 D7).
 * asyncHandler 는 promise 를 기다리지 않아 setImmediate 로 흘려보낸다.
 */
const pending = { approvalId: 'apv1', taskId: 't1', userId: 'owner', toolName: 'write_file', args: {} };
const registry = {
    get: jest.fn(async () => pending),
    reassign: jest.fn(async () => true),
    recent: jest.fn(async () => [{ approval_id: 'apv1', task_id: 't1', user_id: 'owner' }]),
    revoke: jest.fn(async () => 'revoked'),
};
jest.mock('../../services/task-sandbox/approval-gate', () => ({ getApprovalRegistry: () => registry }));
const notify = jest.fn(async (_p: unknown) => undefined);
jest.mock('../../services/agent-task/approval-change-notify', () => ({ notifyApprovalChange: (p: unknown) => notify(p) }));
jest.mock('../../services/agent-task/hitl-park', () => ({ resumeParkedTask: jest.fn() }));
jest.mock('../../services/PushService', () => ({ getPushService: () => ({ sendPush: async () => undefined }) }));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../services/org/membership-cache', () => ({ membershipsFor: async () => [{ orgId: 'org1' }] }));
jest.mock('../../data/repositories/organization-repository', () => ({
    OrganizationRepository: jest.fn().mockImplementation(() => ({ listMembers: async () => [{ user_id: 'boss', role: 'owner' }] })),
}));

import { approvalsRouter as router } from '../agent-task-approvals.routes';

function handler(path: string) {
    const layer = (router as any).stack.find((l: any) => l.route?.path === path);
    const stack = layer.route.stack;
    const h = stack[stack.length - 1].handle as (req: any, res: any, next: any) => void;
    return async (req: any, res: any, next: any) => { h(req, res, next); for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };
}
function mockRes() {
    const res: any = { statusCode: 200 };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: unknown) => { res.body = b; return res; };
    return res;
}

beforeEach(() => jest.clearAllMocks());

describe('승인 변경 알림', () => {
    it('이관은 새 담당자에게 assigned 로 알린다', async () => {
        const res = mockRes();
        await handler('/approvals/:approvalId/reassign')({ params: { approvalId: 'apv1' }, body: { toUserId: 'peer' }, user: { id: 'admin1', role: 'admin' } }, res, jest.fn());
        expect(res.statusCode).toBe(200);
        expect(notify).toHaveBeenCalledWith({ userId: 'peer', taskId: 't1', approvalId: 'apv1', reason: 'assigned' });
    });

    it('에스컬레이션은 조직 관리자에게 escalated 로 알린다', async () => {
        const res = mockRes();
        await handler('/approvals/:approvalId/escalate')({ params: { approvalId: 'apv1' }, body: {}, user: { id: 'owner', role: 'user' } }, res, jest.fn());
        expect(res.statusCode).toBe(200);
        expect(notify).toHaveBeenCalledWith({ userId: 'boss', taskId: 't1', approvalId: 'apv1', reason: 'escalated' });
    });

    it('철회는 작업 소유자에게 revoked 로 알리고, 이관이 실패하면 알리지 않는다', async () => {
        const res = mockRes();
        await handler('/approvals/:approvalId/revoke')({ params: { approvalId: 'apv1' }, body: {}, user: { id: 'owner', role: 'user' } }, res, jest.fn());
        expect(notify).toHaveBeenCalledWith({ userId: 'owner', taskId: 't1', approvalId: 'apv1', reason: 'revoked' });

        notify.mockClear();
        registry.reassign.mockResolvedValueOnce(false);
        const res2 = mockRes();
        await handler('/approvals/:approvalId/reassign')({ params: { approvalId: 'apv1' }, body: { toUserId: 'peer' }, user: { id: 'admin1', role: 'admin' } }, res2, jest.fn());
        expect(res2.statusCode).toBe(404);
        expect(notify).not.toHaveBeenCalled();
    });
});
