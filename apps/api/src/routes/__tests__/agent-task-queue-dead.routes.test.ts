/**
 * 실패 큐 뷰(131) — GET /queue/dead 는 분류·기간·상한을 검증해 저장소로 넘긴다. 잘못된 값은 ValidationError(400).
 * asyncHandler 는 promise 를 기다리지 않으므로 라우터 스택의 마지막 핸들러를 직접 호출하고 흘려보낸다.
 */
const listFailedAgentTasks = jest.fn(async () => ({ items: [], byClass: { timeout: 1 } }));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../data/repositories/agent-task-repository', () => ({
    AgentTaskRepository: jest.fn().mockImplementation(() => ({ listFailedAgentTasks })),
}));
jest.mock('../../auth', () => ({ requireAuth: jest.fn(), requireAdmin: jest.fn() }));

import { agentTaskQueueRouter } from '../agent-task-queue.routes';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';

function handler(path: string) {
    const layer = (agentTaskQueueRouter as any).stack.find((l: any) => l.route?.path === path);
    const stack = layer.route.stack;
    const h = stack[stack.length - 1].handle as (req: any, res: any, next: any) => void;
    return async (req: any, res: any, next: any) => { h(req, res, next); for (let i = 0; i < 2; i++) await new Promise((r) => setImmediate(r)); };
}
function mockRes() {
    const res: any = { body: undefined };
    res.json = (b: unknown) => { res.body = b; return res; };
    return res;
}

beforeEach(() => jest.clearAllMocks());

describe('GET /queue/dead', () => {
    it('기본 기간·상한으로 조회하고 분류 목록을 함께 돌려준다', async () => {
        const res = mockRes();
        const next = jest.fn();
        await handler('/queue/dead')({ query: {} }, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(listFailedAgentTasks).toHaveBeenCalledWith({ failureClass: undefined, sinceDays: AGENT_TASK_LIMITS.DEAD_QUEUE_DAYS, limit: AGENT_TASK_LIMITS.DEAD_QUEUE_LIMIT });
        expect(res.body.data).toMatchObject({ class: null, byClass: { timeout: 1 } });
        expect(res.body.data.classes).toContain('llm_error');
    });

    it('분류·기간·상한을 넘긴다', async () => {
        const res = mockRes();
        await handler('/queue/dead')({ query: { class: 'timeout', days: '3', limit: '20' } }, res, jest.fn());
        expect(listFailedAgentTasks).toHaveBeenCalledWith({ failureClass: 'timeout', sinceDays: 3, limit: 20 });
    });

    it.each([[{ class: 'nope' }], [{ days: '0' }], [{ limit: 'abc' }], [{ limit: '9999' }]])('잘못된 쿼리 %j 는 ValidationError', async (query) => {
        const next = jest.fn();
        await handler('/queue/dead')({ query }, mockRes(), next);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
        expect(listFailedAgentTasks).not.toHaveBeenCalled();
    });
});
