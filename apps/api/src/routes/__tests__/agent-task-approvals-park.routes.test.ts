/**
 * 질문 응답 대기 주차(F16.7) — 승인함의 답·승인·거절이 저장되면 그 작업이 주차 중일 때 재개를 시도한다.
 * 재개 실패는 응답을 막지 않는다(결정은 이미 저장, 스윕이 재시도). asyncHandler 는 promise 를 기다리지 않아 흘려보낸다.
 */
const pending = { approvalId: 'apv1', taskId: 't1', userId: 'u1', toolName: 'ask_human', args: {} };
const registry = {
    get: jest.fn(async () => pending),
    answer: jest.fn(async () => true),
    approve: jest.fn(async () => true),
    reject: jest.fn(async () => true),
};
jest.mock('../../services/task-sandbox/approval-gate', () => ({ getApprovalRegistry: () => registry }));
const resumeParkedTask = jest.fn();
jest.mock('../../services/agent-task/hitl-park', () => ({ resumeParkedTask: (id: string) => resumeParkedTask(id) }));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));

import { approvalsRouter as router } from '../agent-task-approvals.routes';

function handler(path: string) {
    const layer = (router as any).stack.find((l: any) => l.route?.path === path);
    const stack = layer.route.stack;
    const h = stack[stack.length - 1].handle as (req: any, res: any, next: any) => void;
    return async (req: any, res: any, next: any) => { h(req, res, next); for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r)); };
}
function mockRes() {
    const res: any = { statusCode: 200 };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: unknown) => { res.body = b; return res; };
    return res;
}
const user = { id: 'u1', role: 'user' };

beforeEach(() => jest.clearAllMocks());

describe('승인 결정 후 주차 작업 재개', () => {
    it('answer 는 결정 저장 후 재개 결과를 resumed 로 돌려준다', async () => {
        resumeParkedTask.mockResolvedValue(true);
        const res = mockRes();
        await handler('/approvals/:approvalId/answer')({ params: { approvalId: 'apv1' }, body: { text: '서울' }, user }, res, jest.fn());
        expect(registry.answer).toHaveBeenCalledWith('apv1', '서울', 'u1');
        expect(resumeParkedTask).toHaveBeenCalledWith('t1');
        expect(res.body.data).toEqual({ approvalId: 'apv1', answered: true, resumed: true });
    });

    it('approve/reject 도 재개를 시도하고, 재개 실패는 resumed:false 로 응답한다', async () => {
        resumeParkedTask.mockRejectedValue(new Error('dispatch down'));
        const res = mockRes();
        await handler('/approvals/:approvalId/:decision')({ params: { approvalId: 'apv1', decision: 'reject' }, body: {}, user }, res, jest.fn());
        expect(registry.reject).toHaveBeenCalled();
        expect(res.body.data).toEqual({ approvalId: 'apv1', decision: 'reject', resumed: false });
    });

    it('결정 저장에 실패하면 재개하지 않는다', async () => {
        registry.approve.mockResolvedValueOnce(false);
        const res = mockRes();
        await handler('/approvals/:approvalId/:decision')({ params: { approvalId: 'apv1', decision: 'approve' }, body: {}, user }, res, jest.fn());
        expect(res.statusCode).toBe(404);
        expect(resumeParkedTask).not.toHaveBeenCalled();
    });
});
