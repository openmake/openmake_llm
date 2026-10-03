/**
 * 검증이 보류한 답변 보존 — 검증 실패로 턴을 이어가다 턴 상한에 걸리면, 들고 있던 직전 완성 답변을 버리지 않고
 * 미검증 완료로 남긴다. 종전에는 max_turns_exhausted 실패가 됐다.
 */
jest.mock('../../config/runtime-limits', () => {
    const actual = jest.requireActual('../../config/runtime-limits');
    return {
        ...actual,
        AGENT_TASK_LIMITS: {
            ...actual.AGENT_TASK_LIMITS,
            GOAL_JUDGE_ENABLED: true, GOAL_JUDGE_SHADOW_ENABLED: false,
            VERIFY_DELIVERABLE_ENABLED: true, VERIFY_DELIVERABLE_MAX_RETRIES: 1,
            WORKSPACE_TEST_GATE_ENABLED: true, WORKSPACE_TEST_MAX_RETRIES: 2,
        },
    };
});
jest.mock('./goal-judge', () => ({
    ...jest.requireActual('./goal-judge'),
    judgeGoal: jest.fn(async () => ({ achieved: true, reason: 'ok', raw: '' })),
    buildJudgeExecutionContext: jest.fn(() => 'ctx'),
}));
jest.mock('./deliverable-verify', () => ({ verifyCodeArtifacts: jest.fn(async () => ({ ok: true, report: '' })) }));
jest.mock('./workspace-test-verify', () => ({ verifyWorkspaceTests: jest.fn() }));
jest.mock('./role-client', () => ({ judgeClientFor: jest.fn(async () => ({})) }));
jest.mock('./task-steps', () => ({
    persistArtifactSteps: jest.fn(async (_t: string, _a: unknown[], n: number) => n),
    persistJudgeStep: jest.fn(async (_t: string, n: number) => n + 1),
    persistVerifySkippedStep: jest.fn(async (_t: string, n: number) => n + 1),
    verifySkippedMessage: jest.fn((gates: readonly string[]) => `skipped: ${gates.join(',')}`),
}));
jest.mock('./code-diff', () => ({ maybePersistCodeDiff: jest.fn(async (_r: unknown, _c: unknown, _t: string, n: number) => n) }));

import { finalizeTask, finalizeMaxTurnsExhausted, type FinalizeInput, type VerifyHold } from './finalize';
import { persistVerifySkippedStep } from './task-steps';
import { verifyCodeArtifacts } from './deliverable-verify';
import { verifyWorkspaceTests } from './workspace-test-verify';
import { AGENT_TASK_TURN_LOOP } from '../../config/agent-task-turn-loop';
import type { TaskRuntime } from '../task-sandbox/runtime';
import type { TaskSandboxConfig } from '../../config/task-sandbox';

const skippedStepMock = persistVerifySkippedStep as jest.MockedFunction<typeof persistVerifySkippedStep>;
const verifyMock = verifyCodeArtifacts as jest.MockedFunction<typeof verifyCodeArtifacts>;
const testsMock = verifyWorkspaceTests as jest.MockedFunction<typeof verifyWorkspaceTests>;
const testsFail = async (_r: unknown, _t: string, _u: unknown, n: number) => ({ ran: true, ok: false, runner: 'npm test', report: '1 failed', stepNumber: n });

const ANSWER = '수정을 마쳤습니다. 변경 내용은 다음과 같습니다.';
let updates: Array<Record<string, unknown>>;
let emitted: Array<[string, string | undefined, string | null | undefined]>;

function input(over: Partial<FinalizeInput> = {}): FinalizeInput {
    return {
        taskId: 'task-1', goal: '버그를 고친다', userId: '3', path: 'final_answer', rawContent: ANSWER,
        taskRuntime: { getPlanSnapshot: () => [] } as unknown as TaskRuntime, sandboxCfg: {} as TaskSandboxConfig,
        usedTools: new Set<string>(['str_replace_editor']), turn: 4, stepNumber: 9, verifyRetries: 0,
        signal: new AbortController().signal,
        update: async (u) => { updates.push(u as Record<string, unknown>); },
        emitStep: (t, n, c) => { emitted.push([t, n, c]); },
        ...over,
    };
}
const exhausted = (held?: FinalizeInput) => finalizeMaxTurnsExhausted({
    taskId: 'task-1', userId: '3', turnCeiling: 5,
    conversation: [{ role: 'user', content: 'g' }, { role: 'assistant', content: '테스트를 다시 돌려 보겠' }],
    taskRuntime: null, sandboxCfg: {} as TaskSandboxConfig, stepNumber: 14,
    update: async (u) => { updates.push(u as Record<string, unknown>); }, emitStep: (t, n, c) => { emitted.push([t, n, c]); },
    ...(held ? { held } : {}),
});

beforeEach(() => {
    jest.clearAllMocks();
    updates = []; emitted = [];
    verifyMock.mockResolvedValue({ ok: true, report: '' });
    testsMock.mockImplementation(testsFail as never);
});

describe('검증이 보류한 답변 보존', () => {
    it('검증 실패로 되돌려 보낼 때 그 답변을 들고 있는다', async () => {
        const hold: VerifyHold = {};
        const i = input({ hold });
        const out = await finalizeTask(i);
        expect(out.kind).toBe('verify_retry');
        expect(hold.answer?.rawContent).toBe(ANSWER);
    });

    it('턴 상한에 걸리면 들고 있던 답변을 결과로 쓰고 "검증 미통과" 표시를 남긴다', async () => {
        const hold: VerifyHold = {};
        await finalizeTask(input({ hold }));
        testsMock.mockClear();

        await exhausted(hold.answer);

        const last = updates[updates.length - 1];
        expect(last).toMatchObject({ status: 'completed', result: ANSWER, completionPath: 'final_answer' });
        expect(testsMock).not.toHaveBeenCalled(); // 실패한 검증을 다시 돌리지 않는다
        expect(skippedStepMock).toHaveBeenCalledTimes(1);
        expect(skippedStepMock.mock.calls[0][1]).toBe(15); // 지금의 스텝 번호(14)에서 이어 쓴다 — 판정 스텝 14, 표시 15(보류 당시 번호 9 가 아니다)
        expect(String(skippedStepMock.mock.calls[0][3])).toContain('검증 미통과');
        expect(emitted.some(([t, , c]) => t === 'verify_skipped' && String(c).includes('검증 미통과'))).toBe(true);
    });

    it('들고 있는 답변이 없으면 종전대로 max_turns_exhausted 실패다', async () => {
        await exhausted();
        expect(updates[updates.length - 1]).toMatchObject({ status: 'failed', error: 'max_turns_exhausted' });
        expect(skippedStepMock).not.toHaveBeenCalled();
    });

    it('끄면 들고 있던 답변을 쓰지 않는다', async () => {
        const cfg = AGENT_TASK_TURN_LOOP as { KEEP_HELD_ANSWER: boolean };
        const hold: VerifyHold = {};
        await finalizeTask(input({ hold }));
        cfg.KEEP_HELD_ANSWER = false;
        try {
            await exhausted(hold.answer);
            expect(updates[updates.length - 1]).toMatchObject({ status: 'failed', error: 'max_turns_exhausted' });
        } finally { cfg.KEEP_HELD_ANSWER = true; }
    });

    it('나중 답변이 검증을 통과하면 종전대로 완료하고 표시를 남기지 않는다', async () => {
        const hold: VerifyHold = {};
        await finalizeTask(input({ hold }));
        testsMock.mockImplementation((async (_r: unknown, _t: string, _u: unknown, n: number) => ({ ran: true, ok: true, runner: 'npm test', report: '', stepNumber: n })) as never);
        const out = await finalizeTask(input({ hold, rawContent: '고쳤고 테스트도 통과했습니다.', verifyRetries: 1 }));
        expect(out.kind).toBe('completed');
        expect(skippedStepMock).not.toHaveBeenCalled();
    });
});
