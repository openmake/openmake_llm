/**
 * 실행 시작 원자화(2026-10-09 점검 ①) — /execute·/resume 는 조기 검사 뒤 claimForExecute 로 게이트하고, 0행이면 400·디스패치 없음.
 * asyncHandler 는 promise 를 기다리지 않으므로 라우터 스택의 핸들러를 직접 부르고 매크로태스크로 체인을 흘려보낸다.
 */
const getAgentTask = jest.fn();
const updateAgentTask = jest.fn(async () => undefined);
const getAgentTaskSteps = jest.fn(async () => []);
jest.mock('../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ getAgentTask, updateAgentTask, getAgentTaskSteps }),
    getPool: () => ({}),
}));
const claimForExecute = jest.fn();
const revertClaim = jest.fn(async () => true);
jest.mock('../../data/repositories/agent-task-run-repository', () => ({
    AgentTaskRunRepository: jest.fn().mockImplementation(() => ({ claimForExecute, revertClaim })),
}));
const dispatchAgentTask = jest.fn();
jest.mock('../../services/agent-task/task-queue', () => ({
    dispatchAgentTask: (...a: unknown[]) => dispatchAgentTask(...a),
    resolveQueuePriority: () => 0,
    getAgentTaskQueue: () => ({ cancelPending: () => false, position: () => null }),
}));
jest.mock('../../services/AgentTaskService', () => ({ AgentTaskService: jest.fn().mockImplementation(() => ({ execute: jest.fn(async () => undefined) })) }));
jest.mock('../../services/org/effective-policy', () => ({ resolveEffectivePolicy: async () => ({}), strictestApprovalPolicy: (p: unknown) => p }));
jest.mock('../../auth/ownership', () => ({ assertResourceOwnerOrAdmin: jest.fn() }));

import router from '../agent-task.routes';

function handler(method: 'post', path: string, idx: number) {
    const layer = (router as any).stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
    const h = layer.route.stack[idx].handle as (req: any, res: any, next: any) => void;
    return async (req: any, res: any, next: any) => { h(req, res, next); for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r)); };
}
function mockRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: unknown) => { res.body = b; return res; };
    return res;
}
const base = { id: 't1', user_id: 'u1', goal: 'g', max_turns: 5, status: 'failed', executor: null, input_files: null, input_images: null, plan: null,
    checkpoint: { conversation: [{ role: 'user', content: 'g' }], completedTurn: 1 } };
const claim = { prev: 'failed', claimedAt: 'ts' };
const req = (body: Record<string, unknown> = {}) => ({ params: { taskId: 't1' }, body, user: { id: 'u1', role: 'user' } });

beforeEach(() => { jest.clearAllMocks(); getAgentTask.mockResolvedValue(base); claimForExecute.mockResolvedValue(claim); dispatchAgentTask.mockResolvedValue('started'); });

describe('POST /:taskId/execute', () => {
    const execute = handler('post', '/:taskId/execute', 1);
    it('claim 성공이면 202 이고 pending 리셋 없이 디스패치한다', async () => {
        const res = mockRes();
        await execute(req({ approvalPolicy: 'high-risk' }), res, jest.fn());
        expect(res.statusCode).toBe(202);
        expect(claimForExecute).toHaveBeenCalledWith('t1', { resetProgress: true, reason: 'execute claim' });
        expect(updateAgentTask).not.toHaveBeenCalled();
        expect(dispatchAgentTask).toHaveBeenCalledTimes(1);
    });
    it('claim 0행이면 400 이고 디스패치하지 않는다(동시 /execute 의 두 번째)', async () => {
        claimForExecute.mockResolvedValue(null);
        const res = mockRes();
        await execute(req(), res, jest.fn());
        expect(res.statusCode).toBe(400);
        expect(dispatchAgentTask).not.toHaveBeenCalled();
    });
    it('이미 running 이면 claim 전에 400', async () => {
        getAgentTask.mockResolvedValue({ ...base, status: 'running' });
        const res = mockRes();
        await execute(req(), res, jest.fn());
        expect(res.statusCode).toBe(400);
        expect(claimForExecute).not.toHaveBeenCalled();
    });
    it('completed 는 전용 메시지로 400', async () => {
        getAgentTask.mockResolvedValue({ ...base, status: 'completed' });
        const res = mockRes();
        await execute(req(), res, jest.fn());
        expect(res.statusCode).toBe(400);
        expect(res.body.error.message).toContain('완료');
        expect(claimForExecute).not.toHaveBeenCalled();
    });
    it('큐가 duplicate 를 돌려주면 400 이고 claim 을 되돌린다(종료 정리 중 재시도 — queued 고아 방지)', async () => {
        dispatchAgentTask.mockResolvedValue('duplicate');
        const res = mockRes();
        await execute(req(), res, jest.fn());
        expect(res.statusCode).toBe(400);
        expect(revertClaim).toHaveBeenCalledWith('t1', claim);
    });
    it('디스패치가 받아들여지면 claim 을 되돌리지 않는다', async () => {
        const res = mockRes();
        await execute(req(), res, jest.fn());
        expect(revertClaim).not.toHaveBeenCalled();
    });
});

describe('POST /:taskId/resume', () => {
    const resume = handler('post', '/:taskId/resume', 0);
    it('claim(progress 유지) 뒤 202', async () => {
        const res = mockRes();
        await resume(req(), res, jest.fn());
        expect(res.statusCode).toBe(202);
        expect(claimForExecute).toHaveBeenCalledWith('t1', { resetProgress: false, reason: 'resume claim' });
        expect(dispatchAgentTask).toHaveBeenCalledTimes(1);
    });
    it('claim 0행이면 400·디스패치 없음', async () => {
        claimForExecute.mockResolvedValue(null);
        const res = mockRes();
        await resume(req(), res, jest.fn());
        expect(res.statusCode).toBe(400);
        expect(dispatchAgentTask).not.toHaveBeenCalled();
    });
    it('체크포인트가 없으면 claim 전에 400', async () => {
        getAgentTask.mockResolvedValue({ ...base, checkpoint: null });
        const res = mockRes();
        await resume(req(), res, jest.fn());
        expect(res.statusCode).toBe(400);
        expect(claimForExecute).not.toHaveBeenCalled();
    });
    it('큐가 duplicate 를 돌려주면 400 이고 claim 을 되돌린다', async () => {
        dispatchAgentTask.mockResolvedValue('duplicate');
        const res = mockRes();
        await resume(req(), res, jest.fn());
        expect(res.statusCode).toBe(400);
        expect(revertClaim).toHaveBeenCalledWith('t1', claim);
    });
});
