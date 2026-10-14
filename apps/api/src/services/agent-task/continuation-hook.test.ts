const continueMock = jest.fn();
jest.mock('./continuation', () => ({
    chainBudgetState: jest.requireActual('./continuation').chainBudgetState,
    continueAsNewSegment: (...a: unknown[]) => continueMock(...a),
}));
const ratioMock = jest.fn(() => 0.5);
jest.mock('./turn-context', () => ({ contextUsageRatio: () => ratioMock() }));
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('../../utils/logger', () => ({ createLogger: () => mockLogger }));
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
import { loadChainContext, chainGateInput, finishAsContinued, gateTurnWithContinuation, prepareSegmentWorkspace, segmentHasProgress, effectiveSegmentTimeoutMs } from './continuation-hook';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { AGENT_TASK_LONG_RUNNING } from '../../config/agent-task-long-running';
import { HANDOFF_SUMMARY_MARKER } from '../../prompts/agent-task-context';
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
        expect(chainGateInput(ctx, [], [], 'm', 100, 10)).toEqual({ canContinue: true, contextRatio: 0.5, timeUp: false });
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
    it('chainGateInput — timeUp 은 세그먼트 시간 상한 × SEGMENT_TIME_RATIO(기본 0.8) 기준', () => {
        const ctx = { task: { id: 'r', chain_root_task_id: 'r' } as never, root: { id: 'r', long_running: budget } as never };
        expect(chainGateInput(ctx, [], [], 'm', 4_000, 0, 5_000)).toMatchObject({ timeUp: true });
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
    /** 이 세그먼트에서 한 턴 일한 대화(assistant 도구 호출 + 결과) */
    const worked = (): ChatMessage[] => [{ role: 'user', content: 'g' }, { role: 'assistant', content: '', tool_calls: [{ id: 'c', type: 'function', function: { name: 'shell', arguments: {} } }] }, { role: 'tool', content: 'ok', tool_call_id: 'c' } as ChatMessage];
    const freshFlags = () => ({ searchLimitNotified: false, browserLimitNotified: false, finalTurnNotified: false, approvalDegradeNotified: false });
    const seed = (): ChatMessage[] => [{ role: 'system', content: 's' }, { role: 'user', content: 'g' }, { role: 'user', content: `${HANDOFF_SUMMARY_MARKER} 메시지 0개를 정리` }];

    it('폭주 방지 — 세그먼트 첫 턴(시드뿐)에 컨텍스트 0.95 여도 이어가지 않고 경고만 남긴다', async () => {
        ratioMock.mockReturnValue(0.95);
        const r = await gateTurnWithContinuation({ chain: chain(), model: 'm', cont, gate: gateInput(0, seed(), freshFlags()) });
        ratioMock.mockReturnValue(0.5);
        expect(continueMock).not.toHaveBeenCalled();
        expect(r.gate?.continuationReason).toBeNull();
        expect(r.chain).not.toBeNull(); // 체인은 끄지 않는다 — 다음 턴에 일을 하면 이어갈 수 있다
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringMatching(/진행 없음/));
    });
    it('폭주 방지 — 두 번째 턴이어도 시드 뒤 assistant/도구 메시지가 없으면 이어가지 않는다', async () => {
        ratioMock.mockReturnValue(0.95);
        await gateTurnWithContinuation({ chain: chain(), model: 'm', cont, gate: gateInput(1, seed(), freshFlags()) });
        ratioMock.mockReturnValue(0.5);
        expect(continueMock).not.toHaveBeenCalled();
    });
    it('폭주 방지 — 한 턴 일한 뒤(assistant+tool)에는 0.95 면 context 로 이어간다', async () => {
        ratioMock.mockReturnValue(0.95);
        continueMock.mockResolvedValueOnce({ successorId: 's2' });
        const r = await gateTurnWithContinuation({ chain: chain(), model: 'm', cont, gate: gateInput(1, [...seed(), ...worked().slice(1)], freshFlags()) });
        ratioMock.mockReturnValue(0.5);
        expect(r.gate).toBeNull();
        expect(continueMock).toHaveBeenCalledWith(expect.objectContaining({ reason: 'context' }));
    });
    it('segmentHasProgress — turn > startTurn 이고 마지막 인계 요약 뒤에 도구 일(tool, tool_calls 있는 assistant)이 있어야 한다', () => {
        expect(segmentHasProgress(worked(), 0, 0)).toBe(false);
        expect(segmentHasProgress(worked(), 1, 0)).toBe(true);
        expect(segmentHasProgress(seed(), 3, 0)).toBe(false);
        expect(segmentHasProgress([...worked(), ...seed()], 3, 0)).toBe(false); // 인계 요약 앞의 일은 세지 않는다
        // 도구 없는 텍스트 답은 진행이 아니다 — 채택됐으면 작업이 끝났고, 채택되지 않았으면(산출물 재촉 등) 일이 아니다
        expect(segmentHasProgress([...seed(), { role: 'assistant', content: '답' }], 3, 0)).toBe(false);
        expect(segmentHasProgress([...seed(), worked()[1]], 3, 0)).toBe(true); // tool_calls 있는 assistant
        expect(segmentHasProgress([...seed(), worked()[2]], 3, 0)).toBe(true); // tool 메시지
    });
    it('이어가기를 건너뛰면 사유를 info 로그로 남긴다', async () => {
        continueMock.mockResolvedValueOnce({ skipped: '체인 예산 소진' });
        await gateTurnWithContinuation({ chain: chain(), model: 'm', cont, gate: gateInput(31, worked(), freshFlags()) });
        expect(mockLogger.info).toHaveBeenCalledWith('[Continuation] 이어가기 건너뜀: r — 체인 예산 소진');
    });

    const cont = { roleState: {} as never, signal: new AbortController().signal, taskRuntime: null, userRole: 'user' as const, activeMs: 1, update: jest.fn().mockResolvedValue(undefined) };

    it('이어가기에 성공하면 gate 없이(null) 돌려준다 — 호출부는 루프를 끝낸다', async () => {
        continueMock.mockResolvedValueOnce({ successorId: 's2' });
        const flags = { searchLimitNotified: false, browserLimitNotified: false, finalTurnNotified: false, approvalDegradeNotified: false };
        const r = await gateTurnWithContinuation({ chain: chain(), model: 'm', cont, gate: gateInput(31, worked(), flags) });
        expect(r.gate).toBeNull();
        expect(continueMock).toHaveBeenCalledWith(expect.objectContaining({ reason: 'turns', turn: 31 }));
    });
    it('이어가기에 실패하면 같은 턴이 종전 마무리 턴이 되고(사유·도구 차단·nudge) 체인을 끈다 — 다음 턴엔 다시 시도하지 않는다', async () => {
        continueMock.mockResolvedValueOnce({ skipped: '디스패치 실패' });
        const flags = { searchLimitNotified: false, browserLimitNotified: false, finalTurnNotified: false, approvalDegradeNotified: false };
        const conversation: ChatMessage[] = worked();
        const big = { task: { id: 'r', chain_root_task_id: 'r' } as never, root: { id: 'r', long_running: { ...budget, maxTotalTokens: 1e12 } } as never }; // 체인 예산은 남고 세그먼트 토큰 상한만 넘음
        const r = await gateTurnWithContinuation({ chain: big, model: 'm', cont, gate: { ...gateInput(30, conversation, flags), totalTokens: 10_000_000 } });
        expect(continueMock).toHaveBeenCalledWith(expect.objectContaining({ reason: 'tokens' }));
        expect(r.gate?.finalTurnReason).toBe('tokens');
        expect(r.gate?.effectiveTools).toEqual([]);
        expect(r.gate?.continuationReason).toBeNull();
        expect(flags.finalTurnNotified).toBe(true);
        expect(conversation.length).toBe(4); // 마무리 nudge 주입
        expect(r.chain).toBeNull();
        const next = await gateTurnWithContinuation({ chain: r.chain, model: 'm', cont, gate: { ...gateInput(31, conversation, flags), totalTokens: 10_000_000 } });
        expect(next.gate?.finalTurnReason).toBe('tokens');
        expect(continueMock).toHaveBeenCalledTimes(1);
    });
    it('세그먼트 활성 시간이 시간 상한의 SEGMENT_TIME_RATIO 이상이면 time 사유로 이어간다(timeout 으로 failed 가 되기 전에)', async () => {
        continueMock.mockResolvedValueOnce({ successorId: 's2' });
        const flags = { searchLimitNotified: false, browserLimitNotified: false, finalTurnNotified: false, approvalDegradeNotified: false };
        const r = await gateTurnWithContinuation({ chain: chain(), model: 'm', cont: { ...cont, activeMs: 800, segmentTimeoutMs: 1_000 }, gate: gateInput(3, worked(), flags) });
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

describe('effectiveSegmentTimeoutMs — 세그먼트 시간 상한을 체인 남은 시간으로 묶는다', () => {
    const HOUR = 3_600_000;
    const TURN = AGENT_TASK_LIMITS.TURN_TIME_BUDGET_MS;
    const seg = (maxDurationMs: number, chainUsedMs?: number) => ({
        task: { id: 's', chain_root_task_id: 'r', ...(chainUsedMs != null ? { continuation: { chainUsedMs } } : {}) } as never,
        root: { id: 'r', long_running: { ...budget, maxDurationMs } } as never,
    });
    it('체인이 아니면(또는 루트에 예산이 없으면) 세그먼트 상한 그대로', () => {
        expect(effectiveSegmentTimeoutMs(null, 900_000)).toBe(900_000);
        expect(effectiveSegmentTimeoutMs({ task: { id: 't' } as never, root: { id: 'r' } as never }, 900_000)).toBe(900_000);
    });
    it('체인 남은 시간이 세그먼트 상한보다 길면 세그먼트 상한', () => {
        expect(effectiveSegmentTimeoutMs(seg(8 * HOUR), 900_000)).toBe(900_000); // 루트: 앞 누적 0
        expect(effectiveSegmentTimeoutMs(seg(8 * HOUR, 2 * HOUR), 900_000)).toBe(900_000);
    });
    it('체인 남은 시간(maxDurationMs − 앞 세그먼트 누적)이 더 짧으면 남은 시간', () => {
        expect(effectiveSegmentTimeoutMs(seg(HOUR, HOUR - 300_000), 900_000)).toBe(300_000);
    });
    it('남은 시간이 0 이하이거나 한 턴도 안 되면 하한(지금까지의 활성 시간 + 한 턴 예산) — 최소 한 턴은 돈다, 세그먼트 상한은 넘지 않는다', () => {
        expect(effectiveSegmentTimeoutMs(seg(HOUR, HOUR + 5_000), 900_000)).toBe(TURN); // 음수
        expect(effectiveSegmentTimeoutMs(seg(HOUR, HOUR), 900_000, 12_000)).toBe(12_000 + TURN); // 0, 준비에 12초 썼다
        expect(effectiveSegmentTimeoutMs(seg(HOUR, HOUR - 1_000), 900_000)).toBe(TURN); // 1초 남음
        expect(effectiveSegmentTimeoutMs(seg(HOUR, HOUR + 5_000), TURN / 2)).toBe(TURN / 2);
    });
    it('SEGMENT_TIME_RATIO 는 실효 상한에 곱한다 — 체인에 시간이 남아 있으면 남은 시간 × 비율에서 time 사유로 잇는다', () => {
        const ctx = seg(HOUR, HOUR - 300_000); // 남은 5분 < 세그먼트 상한 15분
        const eff = effectiveSegmentTimeoutMs(ctx, 900_000);
        const at = eff * AGENT_TASK_LONG_RUNNING.SEGMENT_TIME_RATIO;
        expect(chainGateInput(ctx, [], [], 'm', at, 0, eff)).toMatchObject({ canContinue: true, timeUp: true });
        expect(chainGateInput(ctx, [], [], 'm', at - 1, 0, eff)).toMatchObject({ timeUp: false });
        expect(chainGateInput(ctx, [], [], 'm', at, 0, 900_000)).toMatchObject({ timeUp: false }); // 종전(세그먼트 상한 기준)이면 판정하지 못했다
    });
    it('남은 시간이 0 이하면 timeUp 이어도 canContinue=false — time 으로 잇지 않고 예산 소진으로 끝난다(하한 시간 뒤 assertWithinLimits 의 timeout)', async () => {
        const ctx = seg(HOUR, HOUR + 5_000);
        const eff = effectiveSegmentTimeoutMs(ctx, 900_000);
        expect(chainGateInput(ctx, [], [], 'm', eff, 0, eff)).toMatchObject({ canContinue: false, timeUp: true });
        continueMock.mockClear();
        const flags = { searchLimitNotified: false, browserLimitNotified: false, finalTurnNotified: false, approvalDegradeNotified: false };
        const cont = { roleState: {} as never, signal: new AbortController().signal, taskRuntime: null, userRole: 'user' as const, activeMs: eff, segmentTimeoutMs: eff, update: jest.fn() };
        const worked: ChatMessage[] = [{ role: 'user', content: 'g' }, { role: 'assistant', content: '', tool_calls: [{ id: 'c', type: 'function', function: { name: 'shell', arguments: {} } }] }, { role: 'tool', content: 'ok', tool_call_id: 'c' } as ChatMessage];
        const r = await gateTurnWithContinuation({ chain: ctx, model: 'm', cont, gate: {
            taskId: 's', turn: 3, startTurn: 0, turnCeiling: 32, totalTokens: 0, searchCalls: 0, browserCalls: 0, approvalTimeouts: 0,
            tools: [], sandboxCfg: { approvalPolicy: 'none', deviceGatesShell: false } as never, conversation: worked, flags, stepNumber: 0, emitStep: jest.fn(),
        } });
        expect(r.gate?.continuationReason).toBeNull();
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
