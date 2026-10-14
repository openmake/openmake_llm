/**
 * 목록(GET /)의 체인 세그먼트 수 — 루트 행에 서버 집계 chain_segment_count 를 싣는다(웹 카드가 받은 목록 행으로 세면 필터·개수 제한에 틀린다).
 * asyncHandler 는 promise 를 기다리지 않으므로 라우터 스택의 핸들러를 직접 부르고 매크로태스크로 체인을 흘려보낸다.
 */
const getUserAgentTasks = jest.fn();
const getAllAgentTasks = jest.fn();
jest.mock('../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ getUserAgentTasks, getAllAgentTasks }),
    getPool: () => ({}),
}));
const countChainSegments = jest.fn();
jest.mock('../../data/repositories/agent-task-chain-repository', () => ({
    AgentTaskChainRepository: jest.fn().mockImplementation(() => ({ countChainSegments })),
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
const req = (query: Record<string, string> = {}) => ({ query, params: {}, user: { id: 'u1', role: 'user' } });

beforeEach(() => jest.clearAllMocks());

describe('GET / — 체인 세그먼트 수', () => {
    const list = listHandler();
    it('루트 행에만 서버 집계 chain_segment_count 를 싣는다 — 목록에 루트만 보여도(필터) 전체 세그먼트 수', async () => {
        getUserAgentTasks.mockResolvedValue([
            { id: 'root', status: 'completed', chain_root_task_id: 'root' },
            { id: 'plain', status: 'completed', chain_root_task_id: null },
        ]);
        countChainSegments.mockResolvedValue(new Map([['root', 5]]));
        const res = mockRes();
        await list(req({ status: 'completed' }), res);
        expect(countChainSegments).toHaveBeenCalledWith(['root']);
        const tasks = res.body.data.tasks as Array<Record<string, unknown>>;
        expect(tasks.find((t) => t.id === 'root')?.chain_segment_count).toBe(5);
        expect(tasks.find((t) => t.id === 'plain')).not.toHaveProperty('chain_segment_count');
    });
    it('체인 루트가 없으면 집계를 부르지 않는다(종전과 같다)', async () => {
        getUserAgentTasks.mockResolvedValue([{ id: 'plain', status: 'running', chain_root_task_id: null }]);
        const res = mockRes();
        await list(req(), res);
        expect(countChainSegments).not.toHaveBeenCalled();
        expect(res.body.data.tasks).toHaveLength(1);
    });
    it('집계가 실패해도 목록은 그대로 돌려준다(웹은 종전 계산으로 폴백)', async () => {
        getUserAgentTasks.mockResolvedValue([{ id: 'root', status: 'running', chain_root_task_id: 'root' }]);
        countChainSegments.mockRejectedValue(new Error('db down'));
        const res = mockRes();
        await list(req(), res);
        expect(res.statusCode).toBe(200);
        expect(res.body.data.tasks[0]).not.toHaveProperty('chain_segment_count');
    });
});
