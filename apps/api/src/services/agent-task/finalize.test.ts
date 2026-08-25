// judge/verify 는 .env 플래그에 좌우되므로 고정해 결정적으로 만든다.
jest.mock('../../config/runtime-limits', () => {
    const actual = jest.requireActual('../../config/runtime-limits');
    return {
        ...actual,
        AGENT_TASK_LIMITS: {
            ...actual.AGENT_TASK_LIMITS,
            GOAL_JUDGE_ENABLED: true,
            VERIFY_DELIVERABLE_ENABLED: true,
            VERIFY_DELIVERABLE_MAX_RETRIES: 1,
        },
    };
});
jest.mock('./goal-judge', () => ({
    judgeGoal: jest.fn(),
    judgeGoalAchieved: jest.fn(),
    buildJudgeExecutionContext: jest.fn(() => 'ctx'),
}));
jest.mock('./deliverable-verify', () => ({ verifyCodeArtifacts: jest.fn(async () => ({ ok: true, report: '' })) }));
jest.mock('./role-client', () => ({ judgeClientFor: jest.fn(async () => ({})) }));
jest.mock('./task-steps', () => ({
    persistArtifactSteps: jest.fn(async (_t: string, _a: unknown[], n: number) => n + 1),
    persistJudgeStep: jest.fn(async (_t: string, n: number) => n + 1),
}));
jest.mock('./code-diff', () => ({ maybePersistCodeDiff: jest.fn(async (_r: unknown, _c: unknown, _t: string, n: number) => n) }));

import { finalizeTask, type FinalizeInput } from './finalize';
import { judgeGoal } from './goal-judge';
import { persistJudgeStep } from './task-steps';
import { verifyCodeArtifacts } from './deliverable-verify';
import { AGENT_TASK_INCOMPLETE_MARKER } from '../../prompts/agent-task-prompt';
import type { TaskRuntime } from '../task-sandbox/runtime';
import type { TaskSandboxConfig } from '../../config/task-sandbox';

const judgeMock = judgeGoal as jest.MockedFunction<typeof judgeGoal>;
const judgeStepMock = persistJudgeStep as jest.MockedFunction<typeof persistJudgeStep>;
const verifyMock = verifyCodeArtifacts as jest.MockedFunction<typeof verifyCodeArtifacts>;

/** 코드 아티팩트 1개를 담은 최종 응답 — 실제 파서를 통과하는 형태. */
const WITH_ARTIFACT = '정리했습니다.\n<artifact kind="code" lang="python" title="t">print(1)</artifact>';

function input(over: Partial<FinalizeInput> = {}): FinalizeInput {
    const updates: Array<Record<string, unknown>> = [];
    const base: FinalizeInput = {
        taskId: 'task-1',
        goal: '보고서를 작성한다',
        userId: '3',
        path: 'final_answer',
        rawContent: '작업을 마쳤습니다.',
        taskRuntime: { getPlanSnapshot: () => [] } as unknown as TaskRuntime,
        sandboxCfg: {} as TaskSandboxConfig,
        usedTools: new Set<string>(['bash']),
        turn: 1,
        stepNumber: 5,
        verifyRetries: 0,
        signal: new AbortController().signal,
        update: async (u) => { updates.push(u as Record<string, unknown>); },
        emitStep: () => { /* noop */ },
        ...over,
    };
    // 마지막 update 페이로드를 검사할 수 있게 배열을 노출한다.
    (base as FinalizeInput & { _updates: typeof updates })._updates = updates;
    return base;
}
const lastUpdate = (i: FinalizeInput): Record<string, unknown> => {
    const us = (i as FinalizeInput & { _updates: Array<Record<string, unknown>> })._updates;
    return us[us.length - 1];
};

beforeEach(() => {
    jest.clearAllMocks();
    verifyMock.mockResolvedValue({ ok: true, report: '' });
});

describe('finalizeTask — 완료 관문 단일화(091)', () => {
    it('terminate 경로도 goal judge 를 거친다 (종전엔 우회)', async () => {
        judgeMock.mockResolvedValue({ achieved: true, reason: '파일이 생성됨', raw: '' });
        const i = input({ path: 'terminate', terminateSummary: '완료했습니다.' });

        const out = await finalizeTask(i);

        expect(judgeMock).toHaveBeenCalledTimes(1);
        expect(out.kind).toBe('completed');
        expect(lastUpdate(i)).toMatchObject({
            status: 'completed', completionPath: 'terminate', judgeVerdict: 'achieved',
        });
    });

    it('terminate 인데 목표 미달성이면 completed 가 아니라 failed(goal_incomplete)', async () => {
        judgeMock.mockResolvedValue({ achieved: false, reason: '자료 없음', raw: '' });
        const i = input({ path: 'terminate', terminateSummary: '' });

        const out = await finalizeTask(i);

        expect(out.kind).toBe('goal_incomplete');
        expect(lastUpdate(i)).toMatchObject({
            status: 'failed', error: 'goal_incomplete', completionPath: 'terminate', judgeVerdict: 'not_achieved',
        });
    });

    it('judge 판정 불가는 fail-open — 완료 유지하되 verdict=unknown 으로 남긴다', async () => {
        judgeMock.mockResolvedValue({ achieved: null, reason: '', raw: '판정 불가' });
        const i = input();

        const out = await finalizeTask(i);

        expect(out.kind).toBe('completed');
        expect(lastUpdate(i)).toMatchObject({ status: 'completed', judgeVerdict: 'unknown' });
    });

    it('judge 판정·사유는 스텝으로 영속되고 WS 로도 나간다 (오판 사후 규명용)', async () => {
        judgeMock.mockResolvedValue({ achieved: false, reason: '입력 파일이 없음', raw: '' });
        const emit = jest.fn();
        const i = input({ path: 'terminate', terminateSummary: '', emitStep: emit });
        await finalizeTask(i);
        expect(judgeStepMock).toHaveBeenCalledWith(expect.any(String), expect.any(Number), 'not_achieved', '입력 파일이 없음', '', 'ctx');
        const emitted = emit.mock.calls.find((c: unknown[]) => c[0] === 'judge');
        expect(emitted?.[2]).toContain('입력 파일이 없음');
    });

    it('아티팩트가 있으면 judge 를 생략하고 verdict=skipped (발동 조건 유지)', async () => {
        const i = input({ rawContent: WITH_ARTIFACT });

        const out = await finalizeTask(i);

        expect(judgeMock).not.toHaveBeenCalled();
        expect(out.kind).toBe('completed');
        expect(lastUpdate(i)).toMatchObject({ status: 'completed', judgeVerdict: 'skipped' });
    });

    it('미달성 마커는 judge 없이 failed(goal_incomplete) — 마커는 결과 본문에서 제거', async () => {
        const i = input({ rawContent: `${AGENT_TASK_INCOMPLETE_MARKER}\n권한이 없어 수행하지 못했습니다.` });

        const out = await finalizeTask(i);

        expect(judgeMock).not.toHaveBeenCalled();
        expect(out.kind).toBe('goal_incomplete');
        const u = lastUpdate(i);
        expect(u).toMatchObject({ status: 'failed', error: 'goal_incomplete', judgeVerdict: 'skipped' });
        expect(String(u.result)).not.toContain(AGENT_TASK_INCOMPLETE_MARKER);
        expect(String(u.result)).toContain('권한이 없어');
    });

    it('산출물 검증 실패는 완료시키지 않고 자가수정 nudge 를 돌려준다', async () => {
        verifyMock.mockResolvedValue({ ok: false, report: 'SyntaxError' });
        const i = input({ rawContent: WITH_ARTIFACT });

        const out = await finalizeTask(i);

        expect(out.kind).toBe('verify_retry');
        expect(out.kind === 'verify_retry' && out.nudge).toContain('SyntaxError');
        const us = (i as FinalizeInput & { _updates: unknown[] })._updates;
        expect(us).toHaveLength(0); // 상태 전이 없음 — 루프가 계속된다
    });

    it('verify 재시도 상한을 넘으면 검증을 건너뛰고 완료한다(무한루프 방지)', async () => {
        verifyMock.mockResolvedValue({ ok: false, report: 'SyntaxError' });
        const i = input({ rawContent: WITH_ARTIFACT, verifyRetries: 1 });

        const out = await finalizeTask(i);

        expect(verifyMock).not.toHaveBeenCalled();
        expect(out.kind).toBe('completed');
    });

    it('terminate summary 가 결과 본문이 된다', async () => {
        judgeMock.mockResolvedValue({ achieved: true, reason: '파일이 생성됨', raw: '' });
        const i = input({ path: 'terminate', terminateSummary: '3개 파일을 생성했습니다.', rawContent: '' });

        await finalizeTask(i);

        expect(lastUpdate(i).result).toBe('3개 파일을 생성했습니다.');
    });
});
