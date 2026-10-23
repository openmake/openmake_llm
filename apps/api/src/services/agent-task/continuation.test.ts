jest.mock('../../config/agent-task-long-running', () => ({
    AGENT_TASK_LONG_RUNNING: { ENABLED: true, DEFAULT_MS: 1, MAX_MS: 1, DEFAULT_TOKENS: 1, MAX_TOKENS: 1, DEFAULT_SEGMENTS: 1, MAX_SEGMENTS: 1, CONTINUE_AT_RATIO: 0.9, HANDOFF_TURN_MAX_CHARS: 50, HANDOFF_TURN_TIMEOUT_MS: 100 },
}));
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('../../utils/logger', () => ({ createLogger: () => mockLogger }));
const chatMock = jest.fn();
jest.mock('./role-client', () => ({ chatTurnWithRoleFallback: (...a: unknown[]) => chatMock(...a) }));
const snapshotMock = jest.fn().mockResolvedValue(undefined);
jest.mock('./fork-workspace', () => ({ snapshotWorkspaceTurn: (...a: unknown[]) => snapshotMock(...a), turnSnapshotRef: (t: number) => `refs/omk/turn-${t}` }));
const dispatchMock = jest.fn().mockResolvedValue('started');
jest.mock('./task-queue', () => ({ dispatchAgentTask: (...a: unknown[]) => dispatchMock(...a) }));
const db = { createAgentTask: jest.fn().mockResolvedValue(true), updateAgentTask: jest.fn().mockResolvedValue(undefined), getAgentTask: jest.fn() };
// 선점과 완전한 후속 INSERT 는 한 트랜잭션(createContinuationSuccessor, #1473) — 실제 PG 동작은 __tests__/continuation-atomicity.db.test.ts
const repo = { createContinuationSuccessor: jest.fn().mockResolvedValue(true) };
const chainRepo = { resetContinuation: jest.fn().mockResolvedValue(undefined) };
const leaseRepo = { claimUnleasedPendingForRedispatch: jest.fn().mockResolvedValue(true) };
jest.mock('../../data/repositories/agent-task-repository', () => ({ AgentTaskRepository: jest.fn(() => repo) }));
jest.mock('../../data/repositories/agent-task-chain-repository', () => ({ AgentTaskChainRepository: jest.fn(() => chainRepo) }));
jest.mock('../../data/repositories/agent-task-lease-repository', () => ({
    ...jest.requireActual('../../data/repositories/agent-task-lease-repository'),
    AgentTaskLeaseRepository: jest.fn(() => leaseRepo),
}));
jest.mock('../../data/models/unified-database', () => ({ getUnifiedDatabase: () => db, getPool: () => ({}) }));
const executeMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../AgentTaskService', () => ({ AgentTaskService: jest.fn(() => ({ execute: (...a: unknown[]) => executeMock(...a) })) }));

import { buildContinuationSummary, chainBudgetState, askNextSteps, continueAsNewSegment } from './continuation';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { leaseOwner } from '../../config/lease-owner';
import { HANDOFF_SUMMARY_MARKER } from '../../prompts/agent-task-context';
import { CONTINUATION_NEXT_STEPS_HEADING, CONTINUATION_NO_NEXT_STEPS } from '../../prompts/agent-task-continuation';
import type { ChatMessage } from '../../llm/types';
import * as continuationPrompts from '../../prompts/agent-task-continuation';

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
    const p = () => ({ roleState: {} as never, conversation: conv(), signal: new AbortController().signal, taskId: 't', userId: 'u', plan: null, reason: 'context' as const });
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
    it.each([
        ['context', '컨텍스트 한도'], ['tokens', '토큰 예산'], ['time', '세그먼트 시간 상한'], ['turns', '턴 상한'],
    ] as const)('인계 턴 질문은 실제 이어가기 사유(%s)를 말한다', async (reason, label) => {
        chatMock.mockResolvedValueOnce({ content: '1. 다음' });
        await askNextSteps({ ...p(), reason });
        const asked = chatMock.mock.calls.at(-1)[1].conversation.at(-1).content as string;
        expect(asked).toContain(`이 작업은 ${label} 때문에 새 세션으로 이어집니다.`);
        if (reason !== 'context') expect(asked).not.toContain('컨텍스트 한도');
    });
});

describe('이어가기 프롬프트 사유 문구', () => {
    it('인계 턴 질문과 후속 첫 메시지가 같은 사유 문구를 쓴다', () => {
        for (const [reason, label] of [['context', '컨텍스트 한도'], ['tokens', '토큰 예산'], ['time', '세그먼트 시간 상한'], ['turns', '턴 상한']]) {
            expect(continuationPrompts.getContinuationNextStepsPrompt(50, reason)).toContain(label);
            expect(continuationPrompts.getContinuationNotice(2, reason)).toContain(label);
        }
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
    beforeEach(() => { jest.clearAllMocks(); repo.createContinuationSuccessor.mockResolvedValue(true); chatMock.mockResolvedValue({ content: '1. 다음' }); db.getAgentTask.mockResolvedValue(root); db.updateAgentTask.mockResolvedValue(undefined); dispatchMock.mockResolvedValue('started'); });

    it('스냅숏 → 선점+완전한 후속(체크포인트 시드·fork 표시·정책·소유권) 한 번에 저장 → 디스패치 순으로 하고 successorId 를 돌려준다', async () => {
        const r = await continueAsNewSegment(input());
        expect(r).toHaveProperty('successorId');
        expect(snapshotMock).toHaveBeenCalledWith(expect.anything(), 7, { force: true });
        expect(snapshotMock.mock.invocationCallOrder[0]).toBeLessThan(repo.createContinuationSuccessor.mock.invocationCallOrder[0]);
        const seed = repo.createContinuationSuccessor.mock.calls[0][0];
        const created = seed.create;
        expect(created.id).toBe((r as { successorId: string }).successorId);
        expect(seed.parentTaskId).toBe('root');
        expect(created).toMatchObject({ goal: '목표', maxTurns: 32, chainRootTaskId: 'root', continuedFromTaskId: 'root' });
        expect(created.continuation).toMatchObject({ fromTaskId: 'root', segmentIndex: 1, reason: 'context', chainUsedMs: 1_000, chainUsedTokens: 100 });
        expect(created.continuation.summary.startsWith(HANDOFF_SUMMARY_MARKER)).toBe(true);
        const cp = seed.checkpoint;
        expect(cp.conversation.map((m: ChatMessage) => m.role)).toEqual(['system', 'user', 'user']);
        expect(cp.completedTurn).toBe(-1);
        expect(seed).toMatchObject({ forkedFromTurn: 7, approvalPolicy: 'all', thinkingLevel: 'low', lease: { owner: leaseOwner(), leaseMs: AGENT_TASK_LIMITS.LEASE_MS } });
        // 저장은 한 번 — 별도 생성·체크포인트·fork·정책 쓰기가 없다
        expect(db.createAgentTask).not.toHaveBeenCalled();
        expect(db.updateAgentTask).not.toHaveBeenCalled();
        expect(repo.createContinuationSuccessor.mock.invocationCallOrder[0]).toBeLessThan(dispatchMock.mock.invocationCallOrder[0]);
        const entry = dispatchMock.mock.calls[0][0];
        expect(entry.taskId).toBe(created.id);
        await entry.run();
        expect(executeMock.mock.calls[0][0].resume).toEqual({ conversation: cp.conversation, fromTurn: 0, fromStep: 0 });
    });
    it('선점에 실패하면(이미 이어짐) 후속을 만들지 않고 skipped', async () => {
        repo.createContinuationSuccessor.mockResolvedValueOnce(false);
        const r = await continueAsNewSegment(input());
        expect(r).toEqual({ skipped: expect.stringMatching(/이미/) });
        expect(dispatchMock).not.toHaveBeenCalled();
        expect(chainRepo.resetContinuation).not.toHaveBeenCalled();
    });
    it('소유권을 끄면(LEASE_ENABLED=false) 후속은 소유권 없이 저장된다', async () => {
        const limits = AGENT_TASK_LIMITS as unknown as Record<string, unknown>;
        const before = limits.LEASE_ENABLED;
        limits.LEASE_ENABLED = false;
        try {
            await continueAsNewSegment(input());
        } finally { limits.LEASE_ENABLED = before; }
        expect(repo.createContinuationSuccessor.mock.calls[0][0].lease).toBeUndefined();
    });
    it('현재 작업이 취소됐거나 루트에 취소 표식이면 skipped', async () => {
        const r = await continueAsNewSegment({ ...input(), root: { id: 'root', long_running: { ...budget, cancelled: true } } as never });
        expect(r).toEqual({ skipped: expect.stringMatching(/취소/) });
    });
    it('현재 작업 상태가 cancelled 면 skipped', async () => {
        const r = await continueAsNewSegment({ ...input(), task: { ...(input().task as object), status: 'cancelled' } as never });
        expect(r).toEqual({ skipped: expect.stringMatching(/취소/) });
        expect(repo.createContinuationSuccessor).not.toHaveBeenCalled();
    });
    it('인계 턴 중 중단 신호가 오면(AbortError) 선점·생성 없이 skipped', async () => {
        const ac = new AbortController();
        chatMock.mockImplementationOnce(async () => { ac.abort(); const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
        const r = await continueAsNewSegment({ ...input(), signal: ac.signal });
        expect(r).toEqual({ skipped: expect.stringMatching(/취소/) });
        expect(repo.createContinuationSuccessor).not.toHaveBeenCalled();
    });
    it('인계 턴 동안 루트에 취소 표식이 생기면 skipped', async () => {
        db.getAgentTask.mockResolvedValueOnce({ id: 'root', long_running: { ...budget, cancelled: true } });
        const r = await continueAsNewSegment(input());
        expect(r).toEqual({ skipped: expect.stringMatching(/취소/) });
        expect(repo.createContinuationSuccessor).not.toHaveBeenCalled();
    });
    it('원자 저장이 실패하면(트랜잭션이 되돌렸다) 되돌릴 것도 디스패치할 것도 없이 skipped', async () => {
        repo.createContinuationSuccessor.mockRejectedValueOnce(new Error('db down'));
        const r = await continueAsNewSegment(input());
        expect(r).toEqual({ skipped: expect.stringMatching(/저장 실패: db down/) });
        expect(db.updateAgentTask).not.toHaveBeenCalled();
        expect(chainRepo.resetContinuation).not.toHaveBeenCalled();
        expect(dispatchMock).not.toHaveBeenCalled();
    });
    it('저장 오류여도 COMMIT 이 실제로 됐으면(응답 유실) 부모 링크를 다시 읽어 그 후속을 디스패치한다', async () => {
        let sid = '';
        repo.createContinuationSuccessor.mockImplementationOnce(async (seed: { create: { id: string } }) => { sid = seed.create.id; throw new Error('Connection terminated unexpectedly'); });
        db.getAgentTask.mockImplementation(async (id: string) => (id === 'root' ? { ...(root as object), continued_by_task_id: sid } : undefined));
        const r = await continueAsNewSegment(input());
        expect(r).toEqual({ successorId: sid });
        expect(dispatchMock).toHaveBeenCalledTimes(1);
        expect(dispatchMock.mock.calls[0][0].taskId).toBe(sid);
        expect(chainRepo.resetContinuation).not.toHaveBeenCalled();
    });
    it('저장 오류 뒤 부모 링크가 이 후속이 아니면(되돌려졌다) 디스패치 없이 skipped', async () => {
        repo.createContinuationSuccessor.mockRejectedValueOnce(new Error('Connection terminated unexpectedly'));
        const r = await continueAsNewSegment(input());
        expect(r).toEqual({ skipped: expect.stringMatching(/저장 실패/) });
        expect(dispatchMock).not.toHaveBeenCalled();
    });
    it('디스패치가 실패하면 후속을 failed 로 닫고 선점을 되돌린다', async () => {
        dispatchMock.mockRejectedValueOnce(new Error('queue full'));
        const r = await continueAsNewSegment(input());
        expect(r).toEqual({ skipped: expect.stringMatching(/디스패치 실패/) });
        const sid = repo.createContinuationSuccessor.mock.calls[0][0].create.id;
        expect(db.updateAgentTask).toHaveBeenCalledWith(sid, expect.objectContaining({ status: 'failed' }));
        expect(chainRepo.resetContinuation).toHaveBeenCalledWith('root', sid);
    });
    it('인계 턴이 실패해도 후속은 만든다', async () => {
        chatMock.mockRejectedValueOnce(new Error('timeout'));
        expect(await continueAsNewSegment(input())).toHaveProperty('successorId');
    });
});

describe('continueAsNewSegment — 최종 검토 수정', () => {
    const input = () => ({
        task: { id: 'root', user_id: 'u', goal: '목표', max_turns: 32, chain_root_task_id: 'root', long_running: budget, executor: 'sandbox', input_files: null, input_images: null } as never,
        root, reason: 'context' as const, conversation: conv(), turn: 7,
        roleState: {} as never, signal: new AbortController().signal, taskRuntime: null,
        userRole: 'user' as const, activeMs: 1_000, totalTokens: 100,
    });
    beforeEach(() => {
        jest.clearAllMocks();
        repo.createContinuationSuccessor.mockResolvedValue(true); chainRepo.resetContinuation.mockResolvedValue(undefined);
        chatMock.mockResolvedValue({ content: '1. 다음' }); db.getAgentTask.mockResolvedValue(root);
        db.updateAgentTask.mockResolvedValue(undefined); dispatchMock.mockResolvedValue('started');
    });

    it('후속은 실행의 승인 정책·추론 수준을 물려받는다 — 같은 트랜잭션으로 행에 저장하고 execute 입력에도 싣는다', async () => {
        const r = await continueAsNewSegment({ ...input(), approvalPolicy: 'none', thinkingLevel: 'high' });
        const sid = (r as { successorId: string }).successorId;
        expect(repo.createContinuationSuccessor.mock.calls[0][0]).toMatchObject({ create: { id: sid }, approvalPolicy: 'none', thinkingLevel: 'high' });
        await dispatchMock.mock.calls[0][0].run();
        expect(executeMock.mock.calls[0][0]).toMatchObject({ taskId: sid, approvalPolicy: 'none', thinkingLevel: 'high' });
    });
    it('실행 값이 없으면 현재 행의 정책·수준을 쓴다', async () => {
        await continueAsNewSegment({ ...input(), task: { ...(input().task as object), approval_policy: 'high-risk', thinking_level: 'low' } as never });
        await dispatchMock.mock.calls[0][0].run();
        expect(executeMock.mock.calls[0][0]).toMatchObject({ approvalPolicy: 'high-risk', thinkingLevel: 'low' });
    });
    it('원자 저장 자체가 예외(예: FK 23503)여도 던지지 않고 skipped — 트랜잭션이 되돌려 쥔 선점이 없으니 되돌리지 않는다', async () => {
        repo.createContinuationSuccessor.mockRejectedValueOnce(Object.assign(new Error('violates foreign key constraint'), { code: '23503' }));
        const r = await continueAsNewSegment(input());
        expect(r).toEqual({ skipped: expect.stringMatching(/^후속 작업 저장 실패: .*foreign key/) });
        expect(chainRepo.resetContinuation).not.toHaveBeenCalled();
        expect(dispatchMock).not.toHaveBeenCalled();
    });
    it('저장 전 시드 준비의 예상 밖 예외도 던지지 않고 skipped — 아직 선점·행이 없다', async () => {
        const spy = jest.spyOn(continuationPrompts, 'getContinuationNotice').mockImplementationOnce(() => { throw new Error('boom'); });
        const r = await continueAsNewSegment(input());
        spy.mockRestore();
        expect(r).toEqual({ skipped: '이어가기 예외: boom' });
        expect(repo.createContinuationSuccessor).not.toHaveBeenCalled();
        expect(chainRepo.resetContinuation).not.toHaveBeenCalled();
    });
    it('abandon 의 정리 갱신이 실패하면 logger.warn 으로 남긴다', async () => {
        dispatchMock.mockRejectedValueOnce(new Error('queue full'));
        db.updateAgentTask.mockRejectedValueOnce(new Error('close fail'));
        chainRepo.resetContinuation.mockRejectedValueOnce(new Error('reset fail'));
        const r = await continueAsNewSegment(input());
        expect(r).toEqual({ skipped: expect.stringMatching(/디스패치 실패/) });
        const warned = mockLogger.warn.mock.calls.map((c) => String(c[0])).join('\n');
        expect(warned).toMatch(/close fail/);
        expect(warned).toMatch(/reset fail/);
    });
    it('선점 실패 — 이미 만들어진 후속이 살아 있으면 그 id 를 돌려준다(호출부는 이어짐으로 마감, 알림 없음)', async () => {
        repo.createContinuationSuccessor.mockResolvedValueOnce(false);
        db.getAgentTask.mockImplementation(async (id: string) => (id === 'root' ? { ...(root as object), continued_by_task_id: 's-old' } : id === 's-old' ? { id: 's-old', status: 'running' } : undefined));
        const r = await continueAsNewSegment(input());
        expect(r).toEqual({ successorId: 's-old' });
        expect(dispatchMock).not.toHaveBeenCalled();
        expect(chainRepo.resetContinuation).not.toHaveBeenCalled();
    });
    it.each([
        ['후속이 failed', { id: 's-old', status: 'failed' }],
        ['후속이 cancelled', { id: 's-old', status: 'cancelled' }],
        ['후속 행이 없음', undefined],
    ])('선점 실패 — %s 이면 skipped(종전 마무리)', async (_label, succ) => {
        repo.createContinuationSuccessor.mockResolvedValueOnce(false);
        db.getAgentTask.mockImplementation(async (id: string) => (id === 'root' ? { ...(root as object), continued_by_task_id: 's-old' } : id === 's-old' ? succ : undefined));
        const r = await continueAsNewSegment(input());
        expect(r).toEqual({ skipped: expect.stringMatching(/이미 다른 실행이 이어갔습니다/) });
        expect(dispatchMock).not.toHaveBeenCalled();
    });
});

describe('followExistingSuccessor — 후속 생존 판정(R3)', () => {
    const input = () => ({
        task: { id: 'root', user_id: 'u', goal: '목표', max_turns: 32, chain_root_task_id: 'root', long_running: budget, executor: 'sandbox', input_files: null, input_images: null } as never,
        root, reason: 'context' as const, conversation: conv(), turn: 7,
        roleState: {} as never, signal: new AbortController().signal, taskRuntime: null,
        userRole: 'admin' as const, activeMs: 1_000, totalTokens: 100,
    });
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    const seeded: ChatMessage[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: '목표' }, { role: 'user', content: '인계' }];
    const succ = (over: Record<string, unknown>) => ({
        id: 's-old', user_id: 'u', goal: '목표', max_turns: 32, executor: 'sandbox', input_files: null, input_images: null,
        approval_policy: 'none', thinking_level: 'high', lease_until: null, checkpoint: { conversation: seeded, completedTurn: -1 }, ...over,
    });
    const withSuccessor = (s: unknown) => db.getAgentTask.mockImplementation(async (id: string) => (id === 'root' ? { ...(root as object), continued_by_task_id: 's-old' } : id === 's-old' ? s : undefined));
    beforeEach(() => {
        jest.clearAllMocks();
        repo.createContinuationSuccessor.mockResolvedValue(false);
        leaseRepo.claimUnleasedPendingForRedispatch.mockResolvedValue(true);
        chatMock.mockResolvedValue({ content: '1. 다음' });
        dispatchMock.mockResolvedValue('started');
    });

    it('(a) pending·lease 없음·updated_at 2분 전·체크포인트 있음 → 원자 claim 뒤 저장된 대화로 재디스패치하고 successorId', async () => {
        withSuccessor(succ({ status: 'pending', updated_at: ago(120_000) }));
        const r = await continueAsNewSegment(input());
        expect(r).toEqual({ successorId: 's-old' });
        expect(leaseRepo.claimUnleasedPendingForRedispatch).toHaveBeenCalledWith('s-old', AGENT_TASK_LIMITS.LEASE_MS, { owner: leaseOwner(), leaseMs: AGENT_TASK_LIMITS.LEASE_MS });
        expect(leaseRepo.claimUnleasedPendingForRedispatch.mock.invocationCallOrder[0]).toBeLessThan(dispatchMock.mock.invocationCallOrder[0]);
        expect(dispatchMock).toHaveBeenCalledTimes(1);
        const entry = dispatchMock.mock.calls[0][0];
        expect(entry).toMatchObject({ taskId: 's-old', userId: 'u' });
        await entry.run();
        expect(executeMock.mock.calls[0][0]).toMatchObject({ taskId: 's-old', goal: '목표', userRole: 'admin', maxTurns: 32, approvalPolicy: 'none', thinkingLevel: 'high' });
        expect(executeMock.mock.calls[0][0].resume).toEqual({ conversation: seeded, fromTurn: 0, fromStep: 0 });
    });
    it('(a-1) 원자 claim 을 다른 복구자가 잡았으면 디스패치 없이 successorId', async () => {
        withSuccessor(succ({ status: 'pending', updated_at: ago(120_000) }));
        leaseRepo.claimUnleasedPendingForRedispatch.mockResolvedValueOnce(false);
        expect(await continueAsNewSegment(input())).toEqual({ successorId: 's-old' });
        expect(dispatchMock).not.toHaveBeenCalled();
    });
    it('(a-2) 재디스패치가 실패하면 skipped(후속 재디스패치 실패)', async () => {
        withSuccessor(succ({ status: 'pending', updated_at: ago(120_000) }));
        dispatchMock.mockRejectedValueOnce(new Error('queue full'));
        const r = await continueAsNewSegment(input());
        expect(r).toEqual({ skipped: expect.stringMatching(/^후속 재디스패치 실패: .*queue full/) });
    });
    it('(b) 후속 running → 디스패치 없이 successorId', async () => {
        withSuccessor(succ({ status: 'running', updated_at: ago(120_000) }));
        expect(await continueAsNewSegment(input())).toEqual({ successorId: 's-old' });
        expect(dispatchMock).not.toHaveBeenCalled();
    });
    it('(c) 후속 pending·updated_at 10초 전(다른 실행이 디스패치 중) → 디스패치 없이 successorId', async () => {
        withSuccessor(succ({ status: 'pending', updated_at: ago(10_000) }));
        expect(await continueAsNewSegment(input())).toEqual({ successorId: 's-old' });
        expect(dispatchMock).not.toHaveBeenCalled();
    });
    it('(d) 후속 pending·오래됨·체크포인트 없음 → skipped', async () => {
        withSuccessor(succ({ status: 'pending', updated_at: ago(120_000), checkpoint: null }));
        expect(await continueAsNewSegment(input())).toEqual({ skipped: expect.any(String) });
        expect(dispatchMock).not.toHaveBeenCalled();
    });
    it('(e) 후속 pending·lease_until 미래 → 디스패치 없이 successorId', async () => {
        withSuccessor(succ({ status: 'pending', updated_at: ago(120_000), lease_until: new Date(Date.now() + 30_000).toISOString() }));
        expect(await continueAsNewSegment(input())).toEqual({ successorId: 's-old' });
        expect(dispatchMock).not.toHaveBeenCalled();
    });
    it('(f) 후속 pending·lease_until 지남 → R2 의 원자 takeover 에 맡긴다(claim·디스패치 없이 successorId)', async () => {
        withSuccessor(succ({ status: 'pending', updated_at: ago(120_000), lease_until: new Date(Date.now() - 30_000).toISOString() }));
        expect(await continueAsNewSegment(input())).toEqual({ successorId: 's-old' });
        expect(leaseRepo.claimUnleasedPendingForRedispatch).not.toHaveBeenCalled();
        expect(dispatchMock).not.toHaveBeenCalled();
    });
});
