/**
 * 작업 지표(Companion P5) — GET /metrics 는 기간을 검증해 집계 저장소로 넘기고, 기간 선택지·상한을 함께 돌려준다.
 * asyncHandler 는 promise 를 기다리지 않으므로 라우터 스택의 마지막 핸들러를 직접 호출하고 흘려보낸다.
 */
const getMetrics = jest.fn(async () => ({ overall: { executor: null, total: 0 }, byExecutor: [], topFailures: [] }));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../data/repositories/agent-task-outcome-metrics-repository', () => ({
    AgentTaskOutcomeMetricsRepository: jest.fn().mockImplementation(() => ({ getMetrics })),
}));
jest.mock('../../auth', () => ({ requireAuth: jest.fn(), requireAdmin: jest.fn() }));

import { agentTaskQueueRouter } from '../agent-task-queue.routes';
import { AGENT_TASK_METRICS } from '../../config/agent-task-metrics';
import { requireAuth, requireAdmin } from '../../auth';

function layer(path: string) {
    return (agentTaskQueueRouter as any).stack.find((l: any) => l.route?.path === path);
}
function handler(path: string) {
    const stack = layer(path).route.stack;
    const h = stack[stack.length - 1].handle as (req: any, res: any, next: any) => void;
    return async (req: any, res: any, next: any) => { h(req, res, next); for (let i = 0; i < 2; i++) await new Promise((r) => setImmediate(r)); };
}
function mockRes() {
    const res: any = { body: undefined };
    res.json = (b: unknown) => { res.body = b; return res; };
    return res;
}

beforeEach(() => jest.clearAllMocks());

describe('GET /metrics', () => {
    it('관리자 전용이다(requireAuth·requireAdmin)', () => {
        const fns = layer('/metrics').route.stack.map((s: any) => s.handle);
        expect(fns).toEqual(expect.arrayContaining([requireAuth, requireAdmin]));
    });

    it('기본 기간으로 집계하고 기간 선택지·상한을 함께 돌려준다', async () => {
        const res = mockRes(); const next = jest.fn();
        await handler('/metrics')({ query: {} }, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(getMetrics).toHaveBeenCalledWith({ days: AGENT_TASK_METRICS.DEFAULT_DAYS, failureTopN: AGENT_TASK_METRICS.FAILURE_TOP_N });
        expect(res.body.data).toMatchObject({
            days: AGENT_TASK_METRICS.DEFAULT_DAYS, dayOptions: [...AGENT_TASK_METRICS.DAY_OPTIONS], maxDays: AGENT_TASK_METRICS.MAX_DAYS,
            byExecutor: [], topFailures: [],
        });
    });

    it('days 를 넘기면 그 기간으로 집계한다', async () => {
        const res = mockRes();
        await handler('/metrics')({ query: { days: '30' } }, res, jest.fn());
        expect(getMetrics).toHaveBeenCalledWith(expect.objectContaining({ days: 30 }));
        expect(res.body.data.days).toBe(30);
    });

    it.each([['0'], [String(AGENT_TASK_METRICS.MAX_DAYS + 1)], ['abc'], ['1.5']])('days=%s 는 400(ValidationError)', async (days) => {
        const next = jest.fn();
        await handler('/metrics')({ query: { days } }, mockRes(), next);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
        expect(getMetrics).not.toHaveBeenCalled();
    });
});
