/**
 * 체크포인트 분기 라우트(141) — fork 는 pending 작업을 만들고 체크포인트·계획·첨부·실행기를 물려받는다.
 * asyncHandler 는 promise 를 기다리지 않으므로 라우터 스택의 핸들러를 직접 await 한다.
 */
const createAgentTask = jest.fn(async () => undefined);
const updateAgentTask = jest.fn(async () => undefined);
const getAgentTask = jest.fn();
const getCheckpoint = jest.fn();
const listCheckpoints = jest.fn(async () => [{ turn: 1, messages: 3, created_at: 'x' }]);
const markForked = jest.fn(async () => undefined);
jest.mock('../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ createAgentTask, updateAgentTask, getAgentTask }),
    getPool: () => ({}),
}));
jest.mock('../../data/repositories/agent-task-repository', () => ({
    AgentTaskRepository: jest.fn().mockImplementation(() => ({ getCheckpoint, listCheckpoints, markForked })),
}));
jest.mock('../../auth/ownership', () => ({ assertResourceOwnerOrAdmin: jest.fn() }));
// 작업 공간 복원 플래그는 .env 에 좌우되므로 꺼진 상태로 고정한다.
jest.mock('../../config/runtime-limits', () => {
    const actual = jest.requireActual('../../config/runtime-limits');
    return { ...actual, AGENT_TASK_LIMITS: { ...actual.AGENT_TASK_LIMITS, FORK_WORKSPACE_RESTORE_ENABLED: false } };
});

import { forkRouter } from '../agent-task-fork.routes';
import { FORK_WORKSPACE_NOTICE, buildForkNotice } from '../../prompts/agent-task-prompt';

function handler(method: 'get' | 'post', path: string) {
    const layer = (forkRouter as any).stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
    const h = layer.route.stack[0].handle as (req: any, res: any, next: any) => void;
    // asyncHandler 는 promise 를 기다리지 않는다 — 매크로태스크 두 번으로 체인을 흘려보낸다.
    return async (req: any, res: any, next: any) => { h(req, res, next); for (let i = 0; i < 2; i++) await new Promise((r) => setImmediate(r)); };
}
function mockRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: unknown) => { res.body = b; return res; };
    return res;
}
const src = {
    id: 'src', user_id: 'u1', goal: '원래 목표', max_turns: 12, status: 'failed',
    input_files: [{ name: 'a.txt' }], input_images: null, executor: 'local', device_id: 'dev1', folder_rel: 'proj',
};
const req = (body: Record<string, unknown>) => ({ params: { taskId: 'src' }, body, user: { id: 'u1', role: 'user' } });

beforeEach(() => { jest.clearAllMocks(); getAgentTask.mockResolvedValue(src); });

describe('GET /:taskId/checkpoints', () => {
    it('이력 목록을 돌려준다', async () => {
        const res = mockRes();
        await handler('get', '/:taskId/checkpoints')(req({}), res, jest.fn());
        expect(res.body.data.checkpoints).toEqual([{ turn: 1, messages: 3, created_at: 'x' }]);
    });
});

describe('POST /:taskId/fork', () => {
    it('fromTurn 검증 실패는 400', async () => {
        const res = mockRes();
        await handler('post', '/:taskId/fork')(req({ fromTurn: -2 }), res, jest.fn());
        expect(res.statusCode).toBe(400);
        expect(createAgentTask).not.toHaveBeenCalled();
    });
    it('체크포인트가 없으면 404', async () => {
        getCheckpoint.mockResolvedValue(null);
        const res = mockRes();
        await handler('post', '/:taskId/fork')(req({ fromTurn: 7 }), res, jest.fn());
        expect(res.statusCode).toBe(404);
    });
    it('pending 작업을 만들고 체크포인트·계획·첨부·실행기를 물려받아 forked 표시한다', async () => {
        getCheckpoint.mockResolvedValue({ conversation: [{ role: 'user', content: 'hi' }], plan: [{ step: 1 }] });
        const res = mockRes();
        await handler('post', '/:taskId/fork')(req({ fromTurn: 2, goal: '  새 목표 ' }), res, jest.fn());
        expect(res.statusCode).toBe(201);
        const newId = res.body.data.taskId;
        expect(newId).not.toBe('src');
        expect(createAgentTask).toHaveBeenCalledWith(expect.objectContaining({
            id: newId, userId: 'u1', goal: '새 목표', maxTurns: 12, inputFiles: [{ name: 'a.txt' }], executor: 'local', deviceId: 'dev1', folderRel: 'proj',
        }));
        const upd = updateAgentTask.mock.calls[0] as unknown as [string, { checkpoint: { conversation: unknown[]; completedTurn: number }; plan: unknown }];
        expect(upd[0]).toBe(newId);
        expect(upd[1].checkpoint.completedTurn).toBe(2);
        // 목표를 바꿔 분기했으므로 안내에 새 목표가 실린다
        expect(upd[1].checkpoint.conversation).toEqual([{ role: 'user', content: 'hi' }, { role: 'user', content: buildForkNotice({ restoreEnabled: false, newGoal: '새 목표' }) }]);
        expect(upd[1].plan).toEqual([{ step: 1 }]);
        expect(markForked).toHaveBeenCalledWith(newId, 'src', 2);
        expect(res.body.data.next).toBe(`/api/agent-tasks/${newId}/resume`);
    });
    it.each([-1, 0])('0 기준 체크포인트 턴 %i 도 분기한다', async (turn) => {
        getCheckpoint.mockResolvedValue({ conversation: [{ role: 'user', content: 'hi' }], plan: null });
        const res = mockRes();
        await handler('post', '/:taskId/fork')(req({ fromTurn: turn }), res, jest.fn());
        expect(res.statusCode).toBe(201);
        expect(getCheckpoint).toHaveBeenCalledWith('src', turn);
        expect((updateAgentTask.mock.calls[0] as any)[1].checkpoint.completedTurn).toBe(turn);
    });
    it('턴 중간 체크포인트는 결과 없는 tool_call 의 assistant 부터 잘라 호출·결과 짝을 깨지 않는다', async () => {
        const conversation = [
            { role: 'user', content: 'goal' },
            { role: 'assistant', content: '', tool_calls: [{ id: 'a', type: 'function', function: { name: 'x', arguments: '{}' } }, { id: 'b', type: 'function', function: { name: 'y', arguments: '{}' } }] },
            { role: 'tool', tool_call_id: 'a', content: 'ok' },
        ];
        getCheckpoint.mockResolvedValue({ conversation, plan: null });
        const res = mockRes();
        await handler('post', '/:taskId/fork')(req({ fromTurn: 0 }), res, jest.fn());
        expect(res.statusCode).toBe(201);
        expect((updateAgentTask.mock.calls[0] as any)[1].checkpoint.conversation).toEqual([
            { role: 'user', content: 'goal' }, { role: 'user', content: FORK_WORKSPACE_NOTICE },
        ]);
    });
    it('목표를 바꿔 분기하면 대화 끝 안내에 새 목표가 실린다 — 재개는 옛 대화를 그대로 쓰기 때문이다', async () => {
        getCheckpoint.mockResolvedValue({ conversation: [{ role: 'user', content: '원래 목표' }], plan: null });
        const res = mockRes();
        await handler('post', '/:taskId/fork')(req({ fromTurn: 1, goal: '새 목표로 진행' }), res, jest.fn());
        expect(res.statusCode).toBe(201);
        const conv = ((updateAgentTask.mock.calls.at(-1) as unknown[])[1] as { checkpoint: { conversation: Array<{ content: string }> } }).checkpoint.conversation;
        expect(conv.at(-1)!.content).toContain('새 목표로 진행');
    });

    it('goal 을 생략하면 원 작업 목표를 쓰고 markForked 실패는 삼킨다', async () => {
        getCheckpoint.mockResolvedValue({ conversation: [], plan: null });
        markForked.mockRejectedValueOnce(new Error('db'));
        const res = mockRes();
        await handler('post', '/:taskId/fork')(req({ fromTurn: 1 }), res, jest.fn());
        expect(res.statusCode).toBe(201);
        expect(createAgentTask).toHaveBeenCalledWith(expect.objectContaining({ goal: '원래 목표' }));
        expect((updateAgentTask.mock.calls[0] as unknown[])[1]).not.toHaveProperty('plan');
    });
    it('일회성 안내(검색 한도 등)는 fork 한 대화에서 뺀다 — 새 작업은 횟수가 다시 시작한다', async () => {
        getCheckpoint.mockResolvedValue({ conversation: [
            { role: 'user', content: '원래 목표' },
            { role: 'user', content: '검색 횟수 한도에 도달했습니다.', oneShot: true },
            { role: 'assistant', content: '정리 중' },
        ] });
        const res = mockRes();
        await handler('post', '/:taskId/fork')(req({ fromTurn: 3 }), res, jest.fn());
        const upd = updateAgentTask.mock.calls[0] as unknown as [string, { checkpoint: { conversation: Array<{ content: string }> } }];
        expect(upd[1].checkpoint.conversation.map((m) => m.content)).toEqual(['원래 목표', '정리 중', FORK_WORKSPACE_NOTICE]);
    });
});
