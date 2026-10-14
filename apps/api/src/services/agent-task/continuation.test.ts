jest.mock('../../config/agent-task-long-running', () => ({
    AGENT_TASK_LONG_RUNNING: { ENABLED: true, DEFAULT_MS: 1, MAX_MS: 1, DEFAULT_TOKENS: 1, MAX_TOKENS: 1, DEFAULT_SEGMENTS: 1, MAX_SEGMENTS: 1, CONTINUE_AT_RATIO: 0.9, HANDOFF_TURN_MAX_CHARS: 50, HANDOFF_TURN_TIMEOUT_MS: 100 },
}));
const chatMock = jest.fn();
jest.mock('./role-client', () => ({ chatTurnWithRoleFallback: (...a: unknown[]) => chatMock(...a) }));
const snapshotMock = jest.fn().mockResolvedValue(undefined);
jest.mock('./fork-workspace', () => ({ snapshotWorkspaceTurn: (...a: unknown[]) => snapshotMock(...a), turnSnapshotRef: (t: number) => `refs/omk/turn-${t}` }));
const dispatchMock = jest.fn().mockResolvedValue('started');
jest.mock('./task-queue', () => ({ dispatchAgentTask: (...a: unknown[]) => dispatchMock(...a) }));
const db = { createAgentTask: jest.fn().mockResolvedValue(true), updateAgentTask: jest.fn().mockResolvedValue(undefined), getAgentTask: jest.fn() };
const repo = { markForked: jest.fn().mockResolvedValue(undefined) };
const chainRepo = { claimContinuation: jest.fn().mockResolvedValue(true), resetContinuation: jest.fn().mockResolvedValue(undefined) };
jest.mock('../../data/repositories/agent-task-repository', () => ({ AgentTaskRepository: jest.fn(() => repo) }));
jest.mock('../../data/repositories/agent-task-chain-repository', () => ({ AgentTaskChainRepository: jest.fn(() => chainRepo) }));
jest.mock('../../data/repositories/agent-task-park-repository', () => ({ AgentTaskParkRepository: jest.fn(() => ({ setApprovalPolicy: jest.fn().mockResolvedValue(undefined), setThinkingLevel: jest.fn().mockResolvedValue(undefined) })) }));
jest.mock('../../data/models/unified-database', () => ({ getUnifiedDatabase: () => db, getPool: () => ({}) }));
const executeMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../AgentTaskService', () => ({ AgentTaskService: jest.fn(() => ({ execute: (...a: unknown[]) => executeMock(...a) })) }));

import { buildContinuationSummary, chainBudgetState, askNextSteps, continueAsNewSegment } from './continuation';
import { HANDOFF_SUMMARY_MARKER } from '../../prompts/agent-task-context';
import { CONTINUATION_NEXT_STEPS_HEADING, CONTINUATION_NO_NEXT_STEPS } from '../../prompts/agent-task-continuation';
import type { ChatMessage } from '../../llm/types';

const conv = (): ChatMessage[] => [
    { role: 'system', content: 'sys' }, { role: 'user', content: '목표' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'file_ops', arguments: { path: 'a.txt' } } }] },
    { role: 'tool', content: 'ok', tool_call_id: 'c1' } as ChatMessage,
    { role: 'assistant', content: '진행 중' },
];
const budget = { maxDurationMs: 10_000, maxTotalTokens: 1000, maxSegments: 3, startedAt: 0 };
const root = { id: 'root', long_running: budget } as never;

describe('chainBudgetState', () => {
    it('체인이 아니면 null', () => {
        expect(chainBudgetState({ id: 'x' } as never, null, 0, 0)).toBeNull();
    });
    it('루트 세그먼트: 사용량은 현재 값, 다음 세그먼트 번호 1', () => {
        const s = chainBudgetState({ id: 'root', chain_root_task_id: 'root' } as never, root, 5_000, 400);
        expect(s).toMatchObject({ canContinue: true, usedMs: 5_000, usedTokens: 400, segmentIndex: 0 });
    });
    it('후속 세그먼트: continuation 의 누적에 현재 값을 더한다; 시간·토큰·세그먼트 중 하나라도 넘으면 canContinue=false', () => {
        const segRow = { id: 's1', chain_root_task_id: 'root', continuation: { fromTaskId: 'root', segmentIndex: 1, reason: 'context', summary: '', chainUsedMs: 6_000, chainUsedTokens: 700 } };
        const seg = segRow as never;
        expect(chainBudgetState(seg, root, 3_000, 200)).toMatchObject({ canContinue: true, usedMs: 9_000, usedTokens: 900 });
        expect(chainBudgetState(seg, root, 5_000, 200)!.canContinue).toBe(false); // 시간 초과
        expect(chainBudgetState(seg, root, 1_000, 400)!.canContinue).toBe(false); // 토큰 초과
        const last = { ...segRow, continuation: { ...segRow.continuation, segmentIndex: 2 } } as never;
        expect(chainBudgetState(last, root, 0, 0)!.canContinue).toBe(false); // 세그먼트 3개 상한(0,1,2) 도달
    });
    it('루트가 취소 표식이면 canContinue=false', () => {
        expect(chainBudgetState({ id: 'root', chain_root_task_id: 'root' } as never, { id: 'root', long_running: { ...budget, cancelled: true } } as never, 0, 0)!.canContinue).toBe(false);
    });
});

describe('buildContinuationSummary', () => {
    it('인계 요약 마커로 시작하고 다음에 할 일 절을 붙인다', () => {
        const s = buildContinuationSummary(conv(), '목표', '1. b.txt 만들기');
        expect(s.startsWith(HANDOFF_SUMMARY_MARKER)).toBe(true);
        expect(s).toContain('a.txt');
        expect(s).toContain(`${CONTINUATION_NEXT_STEPS_HEADING}\n1. b.txt 만들기`);
    });
});

describe('askNextSteps', () => {
    const p = () => ({ roleState: {} as never, conversation: conv(), signal: new AbortController().signal, taskId: 't', userId: 'u', plan: null });
    it('모델 답을 상한 글자로 자른다', async () => {
        chatMock.mockResolvedValueOnce({ content: 'x'.repeat(80) });
        expect((await askNextSteps(p())).length).toBe(50);
        expect(chatMock.mock.calls[0][1].tools).toEqual([]);
    });
    it('모델이 실패하면 계획의 미완 항목으로 대신한다', async () => {
        chatMock.mockRejectedValueOnce(new Error('timeout'));
        const r = await askNextSteps({ ...p(), plan: { items: [{ title: '끝난 일', status: 'done' }, { title: '남은 일', status: 'pending' }] } });
        expect(r).toContain('남은 일');
        expect(r).not.toContain('끝난 일');
    });
    it('모델도 계획도 없으면 고정 문구', async () => {
        chatMock.mockResolvedValueOnce({ content: '   ' });
        expect(await askNextSteps(p())).toBe(CONTINUATION_NO_NEXT_STEPS);
    });
});

describe('continueAsNewSegment', () => {
    const input = () => ({
        task: { id: 'root', user_id: 'u', goal: '목표', max_turns: 32, chain_root_task_id: 'root', long_running: budget, approval_policy: 'all', thinking_level: 'low', executor: 'sandbox', input_files: null, input_images: null } as never,
        root,
        reason: 'context' as const, conversation: conv(), turn: 7,
        roleState: {} as never, signal: new AbortController().signal, taskRuntime: {} as never,
        userRole: 'user' as const, activeMs: 1_000, totalTokens: 100,
    });
    beforeEach(() => { jest.clearAllMocks(); chainRepo.claimContinuation.mockResolvedValue(true); chatMock.mockResolvedValue({ content: '1. 다음' }); db.getAgentTask.mockResolvedValue(root); db.updateAgentTask.mockResolvedValue(undefined); dispatchMock.mockResolvedValue('started'); });

    it('스냅숏 → 선점 → 후속 생성(체크포인트 시드·fork 표시·정책 물려주기) → 디스패치 순으로 하고 successorId 를 돌려준다', async () => {
        const r = await continueAsNewSegment(input());
        expect(r).toHaveProperty('successorId');
        expect(snapshotMock).toHaveBeenCalledWith(expect.anything(), 7, { force: true });
        expect(chainRepo.claimContinuation).toHaveBeenCalledWith('root', (r as { successorId: string }).successorId);
        const created = db.createAgentTask.mock.calls[0][0];
        expect(created).toMatchObject({ goal: '목표', maxTurns: 32, chainRootTaskId: 'root', continuedFromTaskId: 'root' });
        expect(created.continuation).toMatchObject({ fromTaskId: 'root', segmentIndex: 1, reason: 'context', chainUsedMs: 1_000, chainUsedTokens: 100 });
        expect(created.continuation.summary.startsWith(HANDOFF_SUMMARY_MARKER)).toBe(true);
        const cp = db.updateAgentTask.mock.calls.find((c) => c[1].checkpoint)![1].checkpoint;
        expect(cp.conversation.map((m: ChatMessage) => m.role)).toEqual(['system', 'user', 'user']);
        expect(cp.completedTurn).toBe(-1);
        expect(repo.markForked).toHaveBeenCalledWith(created.id, 'root', 7);
        const entry = dispatchMock.mock.calls[0][0];
        expect(entry.taskId).toBe(created.id);
        await entry.run();
        expect(executeMock.mock.calls[0][0].resume).toEqual({ conversation: cp.conversation, fromTurn: 0, fromStep: 0 });
    });
    it('선점에 실패하면(이미 이어짐) 후속을 만들지 않고 skipped', async () => {
        chainRepo.claimContinuation.mockResolvedValueOnce(false);
        const r = await continueAsNewSegment(input());
        expect(r).toEqual({ skipped: expect.stringMatching(/이미/) });
        expect(db.createAgentTask).not.toHaveBeenCalled();
    });
    it('현재 작업이 취소됐거나 루트에 취소 표식이면 skipped', async () => {
        const r = await continueAsNewSegment({ ...input(), root: { id: 'root', long_running: { ...budget, cancelled: true } } as never });
        expect(r).toEqual({ skipped: expect.stringMatching(/취소/) });
    });
    it('현재 작업 상태가 cancelled 면 skipped', async () => {
        const r = await continueAsNewSegment({ ...input(), task: { ...(input().task as object), status: 'cancelled' } as never });
        expect(r).toEqual({ skipped: expect.stringMatching(/취소/) });
        expect(db.createAgentTask).not.toHaveBeenCalled();
    });
    it('인계 턴 중 중단 신호가 오면(AbortError) 선점·생성 없이 skipped', async () => {
        const ac = new AbortController();
        chatMock.mockImplementationOnce(async () => { ac.abort(); const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
        const r = await continueAsNewSegment({ ...input(), signal: ac.signal });
        expect(r).toEqual({ skipped: expect.stringMatching(/취소/) });
        expect(chainRepo.claimContinuation).not.toHaveBeenCalled();
        expect(db.createAgentTask).not.toHaveBeenCalled();
    });
    it('인계 턴 동안 루트에 취소 표식이 생기면 skipped', async () => {
        db.getAgentTask.mockResolvedValueOnce({ id: 'root', long_running: { ...budget, cancelled: true } });
        const r = await continueAsNewSegment(input());
        expect(r).toEqual({ skipped: expect.stringMatching(/취소/) });
        expect(db.createAgentTask).not.toHaveBeenCalled();
    });
    it('행 생성 뒤 체크포인트 저장이 실패하면 후속을 failed 로 닫고 선점을 되돌린다', async () => {
        db.updateAgentTask.mockRejectedValueOnce(new Error('db down'));
        const r = await continueAsNewSegment(input());
        expect(r).toEqual({ skipped: expect.stringMatching(/저장/) });
        const sid = db.createAgentTask.mock.calls[0][0].id;
        expect(db.updateAgentTask).toHaveBeenCalledWith(sid, expect.objectContaining({ status: 'failed', error: expect.stringMatching(/이어가기 준비 실패/) }));
        expect(chainRepo.resetContinuation).toHaveBeenCalledWith('root', sid);
        expect(dispatchMock).not.toHaveBeenCalled();
    });
    it('디스패치가 실패하면 후속을 failed 로 닫고 선점을 되돌린다', async () => {
        dispatchMock.mockRejectedValueOnce(new Error('queue full'));
        const r = await continueAsNewSegment(input());
        expect(r).toEqual({ skipped: expect.stringMatching(/디스패치 실패/) });
        const sid = db.createAgentTask.mock.calls[0][0].id;
        expect(db.updateAgentTask).toHaveBeenCalledWith(sid, expect.objectContaining({ status: 'failed' }));
        expect(chainRepo.resetContinuation).toHaveBeenCalledWith('root', sid);
    });
    it('인계 턴이 실패해도 후속은 만든다', async () => {
        chatMock.mockRejectedValueOnce(new Error('timeout'));
        expect(await continueAsNewSegment(input())).toHaveProperty('successorId');
    });
    it('후속 생성이 실패하면 선점을 되돌리고 skipped', async () => {
        db.createAgentTask.mockResolvedValueOnce(false);
        const r = await continueAsNewSegment(input());
        expect(r).toEqual({ skipped: expect.stringMatching(/저장/) });
        const sid = chainRepo.claimContinuation.mock.calls[0][1];
        expect(chainRepo.resetContinuation).toHaveBeenCalledWith('root', sid);
    });
});
