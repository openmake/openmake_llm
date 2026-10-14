const continueMock = jest.fn();
jest.mock('./continuation', () => ({
    chainBudgetState: jest.requireActual('./continuation').chainBudgetState,
    continueAsNewSegment: (...a: unknown[]) => continueMock(...a),
}));
jest.mock('./turn-context', () => ({ contextUsageRatio: () => 0.5 }));
const db = { getAgentTask: jest.fn(), addAgentTaskStep: jest.fn().mockResolvedValue(undefined) };
jest.mock('../../data/models/unified-database', () => ({ getUnifiedDatabase: () => db, getPool: () => ({}) }));
const initWorkspaceBaseline = jest.fn();
jest.mock('./code-diff', () => ({ initWorkspaceBaseline: (...a: unknown[]) => initWorkspaceBaseline(...a) }));
const markChainCancelled = jest.fn().mockResolvedValue(undefined);
jest.mock('../../data/repositories/agent-task-chain-repository', () => ({ AgentTaskChainRepository: jest.fn(() => ({ markChainCancelled })) }));
jest.mock('../../config/runtime-limits', () => {
    const actual = jest.requireActual('../../config/runtime-limits');
    return { ...actual, AGENT_TASK_LIMITS: { ...actual.AGENT_TASK_LIMITS, FINAL_TURN_NUDGE_ENABLED: true } };
});
import { loadChainContext, chainGateInput, finishAsContinued, gateTurnWithContinuation, prepareSegmentWorkspace } from './continuation-hook';
import type { ChatMessage, ToolDefinition } from '../../llm/types';

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
        expect(chainGateInput(ctx, [], [], 'm', 100, 10)).toEqual({ canContinue: true, contextRatio: 0.5, remainingMs: 9_900, timeUp: false });
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
    it('주차 시간은 체인 사용량에 들어가지 않는다 — activeMs 는 호출부가 (지금-시작-주차) 로 넘긴다', () => {
        const ctx = { task: { id: 'r', chain_root_task_id: 'r' } as never, root: { id: 'r', long_running: budget } as never };
        const startedAt = 0, now = 12_000, pausedMs = 5_000;
        expect(chainGateInput(ctx, [], [], 'm', now - startedAt - pausedMs, 0)?.canContinue).toBe(true); // 7,000 < 10,000
        expect(chainGateInput(ctx, [], [], 'm', now - startedAt, 0)?.canContinue).toBe(false); // 12,000 ≥ 10,000 — 주차를 넣으면 멈춘다
    });
    it('chainGateInput — remainingMs 는 체인 시간 예산의 남은 양, timeUp 은 세그먼트 시간 상한 × SEGMENT_TIME_RATIO(기본 0.8) 기준', () => {
        const ctx = { task: { id: 'r', chain_root_task_id: 'r' } as never, root: { id: 'r', long_running: budget } as never };
        expect(chainGateInput(ctx, [], [], 'm', 4_000, 0, 5_000)).toMatchObject({ remainingMs: 6_000, timeUp: true });
        expect(chainGateInput(ctx, [], [], 'm', 3_999, 0, 5_000)).toMatchObject({ timeUp: false });
        expect(chainGateInput(ctx, [], [], 'm', 4_000, 0)).toMatchObject({ timeUp: false }); // 상한을 모르면 판정하지 않는다
    });
});

describe('gateTurnWithContinuation', () => {
    beforeEach(() => jest.clearAllMocks());
    const tool = { type: 'function', function: { name: 'shell', description: '', parameters: {} } } as unknown as ToolDefinition;
    const chain = () => ({ task: { id: 'r', chain_root_task_id: 'r' } as never, root: { id: 'r', long_running: budget } as never });
    const gateInput = (turn: number, conversation: ChatMessage[], flags: { searchLimitNotified: boolean; browserLimitNotified: boolean; finalTurnNotified: boolean; approvalDegradeNotified: boolean }) => ({
        taskId: 'r', turn, startTurn: 0, turnCeiling: 32, totalTokens: 0, searchCalls: 0, browserCalls: 0, approvalTimeouts: 0,
        tools: [tool], sandboxCfg: { approvalPolicy: 'none', deviceGatesShell: false } as never, conversation, flags, stepNumber: 0, emitStep: jest.fn(),
    });
    const cont = { roleState: {} as never, signal: new AbortController().signal, taskRuntime: null, userRole: 'user' as const, activeMs: 1, update: jest.fn().mockResolvedValue(undefined) };

    it('이어가기에 성공하면 gate 없이(null) 돌려준다 — 호출부는 루프를 끝낸다', async () => {
        continueMock.mockResolvedValueOnce({ successorId: 's2' });
        const flags = { searchLimitNotified: false, browserLimitNotified: false, finalTurnNotified: false, approvalDegradeNotified: false };
        const r = await gateTurnWithContinuation({ chain: chain(), model: 'm', cont, gate: gateInput(31, [], flags) });
        expect(r.gate).toBeNull();
        expect(continueMock).toHaveBeenCalledWith(expect.objectContaining({ reason: 'turns', turn: 31 }));
    });
    it('이어가기에 실패하면 같은 턴이 종전 마무리 턴이 되고(사유·도구 차단·nudge) 체인을 끈다 — 다음 턴엔 다시 시도하지 않는다', async () => {
        continueMock.mockResolvedValueOnce({ skipped: '디스패치 실패' });
        const flags = { searchLimitNotified: false, browserLimitNotified: false, finalTurnNotified: false, approvalDegradeNotified: false };
        const conversation: ChatMessage[] = [{ role: 'user', content: 'g' }];
        const big = { task: { id: 'r', chain_root_task_id: 'r' } as never, root: { id: 'r', long_running: { ...budget, maxTotalTokens: 1e12 } } as never }; // 체인 예산은 남고 세그먼트 토큰 상한만 넘음
        const r = await gateTurnWithContinuation({ chain: big, model: 'm', cont, gate: { ...gateInput(30, conversation, flags), totalTokens: 10_000_000 } });
        expect(continueMock).toHaveBeenCalledWith(expect.objectContaining({ reason: 'tokens' }));
        expect(r.gate?.finalTurnReason).toBe('tokens');
        expect(r.gate?.effectiveTools).toEqual([]);
        expect(r.gate?.continuationReason).toBeNull();
        expect(flags.finalTurnNotified).toBe(true);
        expect(conversation.length).toBe(2); // 마무리 nudge 주입
        expect(r.chain).toBeNull();
        const next = await gateTurnWithContinuation({ chain: r.chain, model: 'm', cont, gate: { ...gateInput(31, conversation, flags), totalTokens: 10_000_000 } });
        expect(next.gate?.finalTurnReason).toBe('tokens');
        expect(continueMock).toHaveBeenCalledTimes(1);
    });
    it('세그먼트 활성 시간이 시간 상한의 SEGMENT_TIME_RATIO 이상이면 time 사유로 이어간다(timeout 으로 failed 가 되기 전에)', async () => {
        continueMock.mockResolvedValueOnce({ successorId: 's2' });
        const flags = { searchLimitNotified: false, browserLimitNotified: false, finalTurnNotified: false, approvalDegradeNotified: false };
        const r = await gateTurnWithContinuation({ chain: chain(), model: 'm', cont: { ...cont, activeMs: 800, segmentTimeoutMs: 1_000 }, gate: gateInput(3, [], flags) });
        expect(r.gate).toBeNull();
        expect(continueMock).toHaveBeenCalledWith(expect.objectContaining({ reason: 'time' }));
    });
    it('시간 상한 비율 미만이면 time 사유 없음', async () => {
        const flags = { searchLimitNotified: false, browserLimitNotified: false, finalTurnNotified: false, approvalDegradeNotified: false };
        const r = await gateTurnWithContinuation({ chain: chain(), model: 'm', cont: { ...cont, activeMs: 799, segmentTimeoutMs: 1_000 }, gate: gateInput(3, [], flags) });
        expect(r.gate?.continuationReason).toBeNull();
        expect(continueMock).not.toHaveBeenCalled();
    });
    it('체인이 아니면 시간 비율을 넘어도 time 사유가 없다 — 종전과 같다(시간 초과는 assertWithinLimits 가 처리)', async () => {
        const flags = { searchLimitNotified: false, browserLimitNotified: false, finalTurnNotified: false, approvalDegradeNotified: false };
        const r = await gateTurnWithContinuation({ chain: null, model: 'm', cont: { ...cont, activeMs: 999, segmentTimeoutMs: 1_000 }, gate: gateInput(3, [], flags) });
        expect(r.gate?.continuationReason).toBeNull();
        expect(r.gate?.finalTurnReason).toBeNull();
        expect(continueMock).not.toHaveBeenCalled();
    });
    it('체인이 아니면 게이트만 한 번 — 종전과 같다', async () => {
        const flags = { searchLimitNotified: false, browserLimitNotified: false, finalTurnNotified: false, approvalDegradeNotified: false };
        const r = await gateTurnWithContinuation({ chain: null, model: 'm', cont, gate: gateInput(31, [], flags) });
        expect(r.gate?.finalTurnReason).toBe('turns');
        expect(continueMock).not.toHaveBeenCalled();
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
