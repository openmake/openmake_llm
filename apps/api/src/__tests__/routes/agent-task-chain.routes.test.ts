import { buildChainInfo } from '../../routes/agent-task-chain';

describe('buildChainInfo', () => {
    const budget = { maxDurationMs: 10_000, maxTotalTokens: 1000, maxSegments: 3, startedAt: 0 };
    it('체인이 아니면 undefined', () => {
        expect(buildChainInfo({ id: 'x' } as never, null, [])).toBeUndefined();
    });
    it('마지막 세그먼트의 continuation 누적 + 그 세그먼트의 total_tokens 를 사용량으로, 진행 중 세그먼트를 activeSegmentId 로', () => {
        const root = { id: 'r', chain_root_task_id: 'r', long_running: budget, status: 'completed', completion_path: 'continued', continued_by_task_id: 's1', total_tokens: 300 } as never;
        const s1 = { id: 's1', status: 'running', total_tokens: 50, continuation: { fromTaskId: 'r', segmentIndex: 1, reason: 'context', summary: '', chainUsedMs: 4_000, chainUsedTokens: 300 }, continued_by_task_id: null, created_at: '2026-10-14T00:00:01Z' } as never;
        const info = buildChainInfo(root, root, [{ ...(root as object), created_at: '2026-10-14T00:00:00Z' } as never, s1]);
        expect(info).toMatchObject({ rootId: 'r', segmentIndex: 0, segmentCount: 2, continuedBy: 's1', activeSegmentId: 's1', cancelled: false });
        expect(info?.budget).toMatchObject({ usedMs: 4_000, usedTokens: 350, segments: 2, maxMs: 10_000, maxTokens: 1000, maxSegments: 3 });
    });
});

const db = { getAgentTask: jest.fn() };
const repo = { listChain: jest.fn(), markChainCancelled: jest.fn().mockResolvedValue(undefined) };
jest.mock('../../data/models/unified-database', () => ({ getUnifiedDatabase: () => db, getPool: () => ({}) }));
jest.mock('../../data/repositories/agent-task-chain-repository', () => ({ AgentTaskChainRepository: jest.fn(() => repo) }));
import { chainInfoOf, cancelChainIfAny, chainTaskList, detailPayload } from '../../routes/agent-task-chain';

describe('chainInfoOf / cancelChainIfAny', () => {
    beforeEach(() => jest.clearAllMocks());
    it('체인이 아니면 빈 객체 — DB 를 부르지 않는다', async () => {
        expect(await chainInfoOf({ id: 'x' } as never)).toEqual({});
        expect(repo.listChain).not.toHaveBeenCalled();
    });
    it('후속 세그먼트면 루트를 읽고 listChain 으로 chain 을 만든다', async () => {
        const budget = { maxDurationMs: 10_000, maxTotalTokens: 1000, maxSegments: 3, startedAt: 0 };
        db.getAgentTask.mockResolvedValueOnce({ id: 'r', long_running: budget });
        repo.listChain.mockResolvedValueOnce([{ id: 'r', status: 'completed', total_tokens: 300, completion_path: 'continued', continuation: null, continued_by_task_id: 's1', created_at: '2026-10-14T00:00:00Z' }, { id: 's1', status: 'running', total_tokens: 50, completion_path: null, continuation: { fromTaskId: 'r', segmentIndex: 1, reason: 'context', summary: '', chainUsedMs: 4_000, chainUsedTokens: 300 }, continued_by_task_id: null, created_at: '2026-10-14T00:00:01Z' }]);
        const r = await chainInfoOf({ id: 's1', chain_root_task_id: 'r', continued_from_task_id: 'r', continuation: { segmentIndex: 1 } } as never);
        expect(r.chain).toMatchObject({ rootId: 'r', segmentIndex: 1, segmentCount: 2, continuedFrom: 'r', activeSegmentId: 's1' });
        expect(repo.listChain).toHaveBeenCalledWith('r');
    });
    it('cancelChainIfAny 는 chain_root_task_id 가 있을 때만 루트에 취소 표식을 남긴다', async () => {
        await cancelChainIfAny({ id: 'x' } as never);
        expect(repo.markChainCancelled).not.toHaveBeenCalled();
        await cancelChainIfAny({ id: 's1', chain_root_task_id: 'r' } as never);
        expect(repo.markChainCancelled).toHaveBeenCalledWith('r');
    });
});

describe('detailPayload', () => {
    beforeEach(() => jest.clearAllMocks());
    it('체인이 아니면 chain 필드 없이 공개 task + steps, 내부 열은 뺀다', async () => {
        const p = await detailPayload({ id: 'x', status: 'completed', checkpoint: { a: 1 } } as never, [{ n: 1 }] as never);
        expect(p.steps).toEqual([{ n: 1 }]);
        expect(p.task).toMatchObject({ id: 'x', status: 'completed' });
        expect(p.task).not.toHaveProperty('chain');
        expect(p.task).not.toHaveProperty('checkpoint');
    });
    it('루트 세그먼트면 루트를 다시 읽지 않고 chain 을 붙인다', async () => {
        const root = { id: 'r', status: 'running', chain_root_task_id: 'r', long_running: { maxDurationMs: 1, maxTotalTokens: 2, maxSegments: 3, startedAt: 0, cancelled: true } };
        repo.listChain.mockResolvedValueOnce([{ id: 'r', status: 'running', total_tokens: 5, continuation: null, continued_by_task_id: null }]);
        const p = await detailPayload(root as never, []);
        expect(db.getAgentTask).not.toHaveBeenCalled();
        expect((p.task as { chain?: unknown }).chain).toMatchObject({ rootId: 'r', segmentIndex: 0, segmentCount: 1, activeSegmentId: 'r', cancelled: true, budget: { usedTokens: 5 } });
    });
});

describe('chainTaskList', () => {
    beforeEach(() => jest.clearAllMocks());
    const req = (id: string, role = 'user') => ({ query: { chain: 'r' }, user: { id, role } }) as never;
    it('루트가 없으면 404', async () => {
        db.getAgentTask.mockResolvedValueOnce(undefined);
        await expect(chainTaskList(req('u1'))).rejects.toMatchObject({ statusCode: 404 });
    });
    it('남의 체인이면 403 — admin 은 허용', async () => {
        db.getAgentTask.mockResolvedValue({ id: 'r', user_id: 'owner' });
        repo.listChain.mockResolvedValue([{ id: 'r' }, { id: 's1' }]);
        await expect(chainTaskList(req('u1'))).rejects.toMatchObject({ statusCode: 403 });
        await expect(chainTaskList(req('u1', 'admin'))).resolves.toHaveLength(2);
        expect(repo.listChain).toHaveBeenCalledWith('r');
    });
    it('내 체인이면 세그먼트 목록', async () => {
        db.getAgentTask.mockResolvedValue({ id: 'r', user_id: 7 });
        repo.listChain.mockResolvedValue([{ id: 'r' }]);
        await expect(chainTaskList(req('7'))).resolves.toEqual([{ id: 'r' }]);
    });
});
