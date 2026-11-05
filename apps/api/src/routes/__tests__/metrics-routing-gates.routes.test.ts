/**
 * GET /api/metrics/routing/gates — 사용자 토글 턴 표(toggles[])는 호환 기간(PR-H1-1)에 중립 필드
 * addonToolIntentTurns 와 구 필드 discussionIntentTurns 를 같은 값으로 함께 낸다(웹 관리자 화면은 PR-H1-2 에서 옮긴다).
 * asyncHandler 는 promise 를 기다리지 않으므로 라우터 스택의 마지막 핸들러를 직접 호출하고 흘려보낸다.
 */
const repo = {
    getOrchestrationDispatchSummary: jest.fn(async () => ({
        total_turns: '10', intent_turns: '4', exposed_turns: '3', called_turns: '2', success_turns: '1',
        spawn_intent_turns: '0', spawn_called_turns: '0',
    })),
    getOrchestrationByTool: jest.fn(async () => []),
    getOrchestrationToggleRecall: jest.fn(async () => [
        { user_mode: 'mode-a', turns: '5', addon_tool_intent_turns: '3', discussion_intent_turns: '3', task_delegate_intent_turns: '1' },
    ]),
    getTailShadowSummary: jest.fn(async () => ({
        total_decisions: '0', tail_decisions: '0', labeled_decisions: '0',
        grounding_fired_decisions: '0', grounding_fixed_decisions: '0', last_decision_at: null,
    })),
    getTailShadowByVerifiability: jest.fn(async () => []),
};
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../data/repositories/routing-metrics-repository', () => ({
    RoutingMetricsRepository: jest.fn().mockImplementation(() => repo),
}));
jest.mock('../../auth', () => ({ requireAuth: jest.fn(), requireAdmin: jest.fn() }));

import metricsRouter from '../metrics.routes';

function handler(path: string) {
    const layer = (metricsRouter as any).stack.find((l: any) => l.route?.path === path);
    const stack = layer.route.stack;
    const h = stack[stack.length - 1].handle as (req: any, res: any, next: any) => void;
    return async (req: any, res: any, next: any) => { h(req, res, next); for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r)); };
}
function mockRes() {
    const res: any = { body: undefined };
    res.json = (b: unknown) => { res.body = b; return res; };
    return res;
}

it('toggles[] 에 addonToolIntentTurns 와 discussionIntentTurns 가 같은 값으로 나온다', async () => {
    const res = mockRes(); const next = jest.fn();
    await handler('/routing/gates')({ query: {} }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.body.data.orchestration.toggles).toEqual([
        { userMode: 'mode-a', turns: 5, addonToolIntentTurns: 3, discussionIntentTurns: 3, taskDelegateIntentTurns: 1 },
    ]);
});
