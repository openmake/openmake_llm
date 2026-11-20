/**
 * 목록(GET /)의 대기 사유 — 멈춘(paused) 작업에만 waitReason 을 싣는다(웹 목록이 "기기 대기"를 진행중과 나눠 보인다).
 * 사유는 한 번에 읽고, 조회가 실패해도 목록은 그대로 돌려준다.
 */
const getUserAgentTasks = jest.fn();
const getAllAgentTasks = jest.fn();
jest.mock('../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ getUserAgentTasks, getAllAgentTasks }),
    getPool: () => ({}),
}));
const getParkReasons = jest.fn();
jest.mock('../../data/repositories/agent-task-park-repository', () => ({
    AgentTaskParkRepository: jest.fn().mockImplementation(() => ({ getParkReasons })),
}));
jest.mock('../../services/AgentTaskService', () => ({ AgentTaskService: jest.fn() }));
jest.mock('../../services/agent-task/task-queue', () => ({
    dispatchAgentTask: jest.fn(), resolveQueuePriority: () => 0,
    getAgentTaskQueue: () => ({ cancelPending: () => false, position: () => null }),
}));
jest.mock('../../auth/ownership', () => ({ assertResourceOwnerOrAdmin: jest.fn() }));

import router from '../agent-task.routes';

function listHandler() {
    const layer = (router as any).stack.find((l: any) => l.route?.path === '/' && l.route.methods.get);
    const h = layer.route.stack[layer.route.stack.length - 1].handle as (req: any, res: any, next: any) => void;
    return async (req: any, res: any) => { h(req, res, jest.fn()); for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r)); };
}
function mockRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: unknown) => { res.body = b; return res; };
    return res;
}
const req = () => ({ query: {}, params: {}, user: { id: 'u1', role: 'user' } });

beforeEach(() => jest.clearAllMocks());

describe('GET / — 대기 사유', () => {
    const list = listHandler();
    it('멈춘 작업만 한 번에 조회해 waitReason 을 싣는다', async () => {
        getUserAgentTasks.mockResolvedValue([
            { id: 'p1', status: 'paused', chain_root_task_id: null },
            { id: 'p2', status: 'paused', chain_root_task_id: null },
            { id: 'r1', status: 'running', chain_root_task_id: null },
        ]);
        getParkReasons.mockResolvedValue(new Map([['p1', 'device_wait']]));
        const res = mockRes();
        await list(req(), res);
        expect(getParkReasons).toHaveBeenCalledTimes(1);
        expect(getParkReasons).toHaveBeenCalledWith(['p1', 'p2']);
        const tasks = res.body.data.tasks as Array<Record<string, unknown>>;
        expect(tasks.find((t) => t.id === 'p1')?.waitReason).toBe('device_wait');
        expect(tasks.find((t) => t.id === 'p2')).not.toHaveProperty('waitReason');
        expect(tasks.find((t) => t.id === 'r1')).not.toHaveProperty('waitReason');
    });
    it('멈춘 작업이 없으면 조회하지 않는다', async () => {
        getUserAgentTasks.mockResolvedValue([{ id: 'r1', status: 'running', chain_root_task_id: null }]);
        const res = mockRes();
        await list(req(), res);
        expect(getParkReasons).not.toHaveBeenCalled();
        expect(res.body.data.tasks).toHaveLength(1);
    });
    it('조회가 실패해도 목록은 그대로 돌려준다', async () => {
        getUserAgentTasks.mockResolvedValue([{ id: 'p1', status: 'paused', chain_root_task_id: null }]);
        getParkReasons.mockRejectedValue(new Error('db down'));
        const res = mockRes();
        await list(req(), res);
        expect(res.statusCode).toBe(200);
        expect(res.body.data.tasks[0]).not.toHaveProperty('waitReason');
    });
});
