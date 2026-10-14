const continueMock = jest.fn();
jest.mock('./continuation', () => ({
    chainBudgetState: jest.requireActual('./continuation').chainBudgetState,
    continueAsNewSegment: (...a: unknown[]) => continueMock(...a),
}));
jest.mock('./turn-context', () => ({ contextUsageRatio: () => 0.5 }));
const db = { getAgentTask: jest.fn() };
jest.mock('../../data/models/unified-database', () => ({ getUnifiedDatabase: () => db, getPool: () => ({}) }));
const initWorkspaceBaseline = jest.fn();
jest.mock('./code-diff', () => ({ initWorkspaceBaseline: (...a: unknown[]) => initWorkspaceBaseline(...a) }));
const markChainCancelled = jest.fn().mockResolvedValue(undefined);
jest.mock('../../data/repositories/agent-task-chain-repository', () => ({ AgentTaskChainRepository: jest.fn(() => ({ markChainCancelled })) }));
import { loadChainContext, chainGateInput, finishAsContinued, tryContinue, prepareSegmentWorkspace } from './continuation-hook';

const budget = { maxDurationMs: 10_000, maxTotalTokens: 1000, maxSegments: 3, startedAt: 0 };
const rt = {} as never;

describe('continuation-hook', () => {
    beforeEach(() => jest.clearAllMocks());
    it('체인이 아니면 loadChainContext 는 null, chainGateInput 은 undefined', async () => {
        db.getAgentTask.mockResolvedValueOnce({ id: 't' });
        expect(await loadChainContext('t')).toBeNull();
        expect(chainGateInput(null, [], [], 'm', 0, 0)).toBeUndefined();
    });
    it('이미 읽은 행을 넘기면 체인이 아닐 때 DB 를 다시 읽지 않는다(장기 실행이 아닌 작업은 종전과 같다)', async () => {
        expect(await loadChainContext('t', { id: 't' } as never)).toBeNull();
        expect(db.getAgentTask).not.toHaveBeenCalled();
    });
    it('루트 행과 현재 행을 읽어 게이트 입력을 만든다', async () => {
        db.getAgentTask.mockResolvedValueOnce({ id: 's1', chain_root_task_id: 'root' }).mockResolvedValueOnce({ id: 'root', long_running: budget });
        const ctx = await loadChainContext('s1');
        expect(ctx?.root.id).toBe('root');
        expect(chainGateInput(ctx, [], [], 'm', 100, 10)).toEqual({ canContinue: true, contextRatio: 0.5 });
    });
    it('finishAsContinued — 성공하면 completed/continued 로 마감하고 true, 알림은 보내지 않는다', async () => {
        continueMock.mockResolvedValueOnce({ successorId: 's2' });
        const update = jest.fn().mockResolvedValue(undefined);
        const ok = await finishAsContinued({ ctx: { task: { id: 's1', goal: 'g' } as never, root: { id: 'root' } as never }, reason: 'context', conversation: [], turn: 3, roleState: {} as never, signal: new AbortController().signal, taskRuntime: null, userRole: 'user', activeMs: 1, totalTokens: 1, update });
        expect(ok).toBe(true);
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', completionPath: 'continued', result: expect.stringContaining('s2') }));
    });
    it('finishAsContinued — 실패하면 false 만 돌려주고 상태를 바꾸지 않는다', async () => {
        continueMock.mockResolvedValueOnce({ skipped: '체인 예산 소진' });
        const update = jest.fn();
        const ok = await finishAsContinued({ ctx: { task: { id: 's1', goal: 'g' } as never, root: { id: 'root' } as never }, reason: 'turns', conversation: [], turn: 3, roleState: {} as never, signal: new AbortController().signal, taskRuntime: null, userRole: 'user', activeMs: 1, totalTokens: 1, update });
        expect(ok).toBe(false);
        expect(update).not.toHaveBeenCalled();
    });
    it('tryContinue — 실패하면 다음 턴에 종전 마무리 nudge 가 들어가도록 finalTurnNotified 를 되돌린다', async () => {
        continueMock.mockResolvedValueOnce({ skipped: 'x' });
        const gateFlags = { finalTurnNotified: true } as never as { finalTurnNotified: boolean };
        const ok = await tryContinue({ ctx: { task: { id: 's1' } as never, root: { id: 'root' } as never }, reason: 'turns', conversation: [], turn: 3, roleState: {} as never, signal: new AbortController().signal, taskRuntime: null, userRole: 'user', activeMs: 1, totalTokens: 1, update: jest.fn(), gateFlags: gateFlags as never });
        expect(ok).toBe(false);
        expect(gateFlags.finalTurnNotified).toBe(false);
    });
    it('주차 시간은 체인 사용량에 들어가지 않는다 — activeMs 는 호출부가 (지금-시작-주차) 로 넘긴다', () => {
        const ctx = { task: { id: 'r', chain_root_task_id: 'r' } as never, root: { id: 'r', long_running: budget } as never };
        const startedAt = 0, now = 9_000, pausedMs = 5_000;
        expect(chainGateInput(ctx, [], [], 'm', now - startedAt - pausedMs, 0)?.canContinue).toBe(true); // 4,000 < 10,000
        expect(chainGateInput(ctx, [], [], 'm', now - startedAt, 0)?.canContinue).toBe(true);
    });
});

describe('prepareSegmentWorkspace', () => {
    beforeEach(() => jest.clearAllMocks());
    it('이어받은 세그먼트가 아니면 종전대로 code-diff 설정일 때만 기준점을 만든다', async () => {
        await prepareSegmentWorkspace(rt, { id: 't' } as never, false, undefined);
        expect(initWorkspaceBaseline).not.toHaveBeenCalled();
        initWorkspaceBaseline.mockResolvedValueOnce(false);
        await prepareSegmentWorkspace(rt, { id: 't' } as never, true, undefined);
        expect(initWorkspaceBaseline).toHaveBeenCalledWith(rt, { id: 't' }, { forceRestore: false });
    });
    it('이어받은 세그먼트는 code-diff 와 무관하게 강제 복원하고, 성공하면 계속', async () => {
        initWorkspaceBaseline.mockResolvedValueOnce(true);
        const pre = { id: 's1', continuation: {}, chain_root_task_id: 'root' } as never;
        await prepareSegmentWorkspace(rt, pre, false, undefined);
        expect(initWorkspaceBaseline).toHaveBeenCalledWith(rt, pre, { forceRestore: true });
        expect(markChainCancelled).not.toHaveBeenCalled();
    });
    it('샌드박스에서 복원 실패면 루트에 취소 표식 후 workspace_restore_failed 로 던진다', async () => {
        initWorkspaceBaseline.mockResolvedValueOnce(false);
        const pre = { id: 's1', continuation: {}, chain_root_task_id: 'root' } as never;
        await expect(prepareSegmentWorkspace(rt, pre, true, 'sandbox')).rejects.toThrow('workspace_restore_failed');
        expect(markChainCancelled).toHaveBeenCalledWith('root');
    });
    it('로컬 실행기는 같은 폴더를 쓰므로 복원 실패여도 계속', async () => {
        initWorkspaceBaseline.mockResolvedValueOnce(false);
        await prepareSegmentWorkspace(rt, { id: 's1', continuation: {}, chain_root_task_id: 'root' } as never, false, 'local');
        expect(markChainCancelled).not.toHaveBeenCalled();
    });
});
