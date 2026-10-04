/**
 * turn-call — 시간 예산 abort 분류·마무리 턴 최소 보장·부분 본문 보존 (2026-09-09, 작업 10770ab5 실측 회귀).
 */
jest.mock('../../config/runtime-limits', () => {
    const actual = jest.requireActual('../../config/runtime-limits');
    return {
        ...actual,
        AGENT_TASK_LIMITS: { ...actual.AGENT_TASK_LIMITS, FINAL_TURN_MIN_MS: 5_000, TURN_RETRY_MAX: 0 },
    };
});
jest.mock('./role-client', () => ({
    chatTurnWithRoleFallback: jest.fn(),
    TurnCallCapExceeded: class TurnCallCapExceeded extends Error {},
}));

import { callAgentTurnWithBudget, AgentTaskTurnTimeout, partialResultOf } from './turn-call';
import { chatTurnWithRoleFallback, TurnCallCapExceeded } from './role-client';
import { AgentTaskAbort } from './types';
import { OUTPUT_REPETITION_CUT_MARKER } from '../../prompts/agent-task-turn-loop';

const chat = chatTurnWithRoleFallback as jest.Mock;
const base = () => ({
    roleState: {} as never, conversation: [], tools: [], signal: new AbortController().signal,
    taskId: 't', userId: 'u', totalTimeoutMs: 10_000, elapsedActiveMs: 0, finalTurn: false,
});

/** signal abort 까지 대기하다 SDK 식 임의 메시지로 실패하는 가짜 LLM 호출 — onToken 으로 토큰을 먼저 흘린다. */
function hangingChat(tokens: string[] = []) {
    chat.mockImplementation((_s, p: { signal: AbortSignal; onToken?: (t: string) => void }) =>
        new Promise((_res, rej) => {
            for (const t of tokens) p.onToken?.(t);
            p.signal.addEventListener('abort', () => rej(new Error('Request was aborted.')), { once: true });
        }));
}

beforeEach(() => { jest.useFakeTimers(); chat.mockReset(); });
afterEach(() => jest.useRealTimers());

describe('callAgentTurnWithBudget', () => {
    it('잔여 예산으로 끊긴 호출은 SDK 문구가 아니라 AgentTaskAbort(timeout) 으로 분류된다', async () => {
        hangingChat();
        const p = callAgentTurnWithBudget({ ...base(), totalTimeoutMs: 10_000, elapsedActiveMs: 8_000 });
        const settled = p.catch((e) => e);
        await jest.advanceTimersByTimeAsync(2_100);
        const err = await settled;
        expect(err).toBeInstanceOf(AgentTaskAbort);
        expect((err as AgentTaskAbort).kind).toBe('timeout');
        expect(err.message).not.toContain('Request was aborted');
    });

    it('마무리 턴은 잔여 예산이 적어도 FINAL_TURN_MIN_MS 를 보장하고, 끊기면 부분 본문을 싣는다', async () => {
        hangingChat(['보고서 ', '초안']);
        const p = callAgentTurnWithBudget({ ...base(), totalTimeoutMs: 10_000, elapsedActiveMs: 9_000, finalTurn: true });
        const settled = p.catch((e) => e);
        // 잔여 1초에 끊기지 않아야 한다(최소 5초 보장)
        await jest.advanceTimersByTimeAsync(2_000);
        expect(chat).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(3_100);
        const err = await settled;
        expect(err).toBeInstanceOf(AgentTaskTurnTimeout);
        expect((err as AgentTaskTurnTimeout).partialContent).toBe('보고서 초안');
    });

    it('재시도가 일어나면 이전 시도의 부분 본문을 버린다(끊긴 뒤 다시 받은 출력과 겹치지 않게)', async () => {
        chat.mockImplementation((_s, p: { signal: AbortSignal; onToken?: (t: string) => void; onRetry?: (i: unknown) => void }) =>
            new Promise((_res, rej) => {
                p.onToken?.('절반만');                       // 1차 시도 — 스트림 도중 끊김
                p.onRetry?.({ attempt: 1, maxAttempts: 2, error: 'terminated' });
                p.onToken?.('전체 답변');                    // 재시도 — 처음부터 다시 받는다
                p.signal.addEventListener('abort', () => rej(new Error('Request was aborted.')), { once: true });
            }));
        const onNote = jest.fn();
        const settled = callAgentTurnWithBudget({ ...base(), totalTimeoutMs: 10_000, elapsedActiveMs: 9_000, finalTurn: true, onNote }).catch((e) => e);
        await jest.advanceTimersByTimeAsync(5_100);
        const err = await settled;
        expect((err as AgentTaskTurnTimeout).partialContent).toBe('전체 답변');
        expect(onNote.mock.calls).toEqual([['retry', '일시적 LLM 오류 — 재시도 1/2: terminated']]);
    });

    it('도구 턴은 스트리밍하지 않는다(onToken 미전달) — 종전 비스트림 경로 유지', async () => {
        chat.mockResolvedValue({ role: 'assistant', content: 'ok' });
        const { result, callSignal } = await callAgentTurnWithBudget(base());
        expect(result.content).toBe('ok');
        expect(chat.mock.calls[0][1].onToken).toBeUndefined();
        expect(callSignal.aborted).toBe(false);
    });

    it('사용자 취소(작업 signal)는 timeout 으로 위장하지 않고 원 오류를 그대로 던진다', async () => {
        hangingChat();
        const ac = new AbortController();
        const p = callAgentTurnWithBudget({ ...base(), signal: ac.signal });
        const settled = p.catch((e) => e);
        ac.abort();
        const err = await settled;
        expect(err).not.toBeInstanceOf(AgentTaskAbort);
        expect(err.message).toBe('Request was aborted.');
    });

    it('호출당 상한 초과(재시도 뒤에도)는 timeout 으로 분류된다', async () => {
        chat.mockRejectedValue(new (TurnCallCapExceeded as unknown as new () => Error)());
        const err = await callAgentTurnWithBudget(base()).catch((e) => e);
        expect(err).toBeInstanceOf(AgentTaskTurnTimeout);
    });

    it('도구 턴에는 호출당 상한을 넘기고, 마무리 턴에는 넘기지 않는다', async () => {
        chat.mockResolvedValue({ content: 'ok' });
        await callAgentTurnWithBudget(base());
        expect((chat.mock.calls[0][1] as { callTimeoutMs?: number }).callTimeoutMs).toBeGreaterThan(0);
        await callAgentTurnWithBudget({ ...base(), finalTurn: true });
        expect((chat.mock.calls[1][1] as { callTimeoutMs?: number }).callTimeoutMs).toBeUndefined();
    });

    it('예산 밖의 일반 오류는 그대로 전파된다', async () => {
        chat.mockRejectedValue(new Error('boom'));
        await expect(callAgentTurnWithBudget(base())).rejects.toThrow('boom');
    });
});

describe('callAgentTurnWithBudget — 재시도 소진 뒤 대기 예산', () => {
    it('이 호출의 남은 예산을 넘겨 준다 — 그 안에서만 더 기다리게', async () => {
        chat.mockResolvedValue({ content: 'ok' });
        await callAgentTurnWithBudget({ ...base(), totalTimeoutMs: 10_000, elapsedActiveMs: 4_000 });
        expect((chat.mock.calls[0][1] as { recoveryBudgetMs?: number }).recoveryBudgetMs).toBe(6_000);
    });
});

describe('callAgentTurnWithBudget — 컨텍스트 절단 기록', () => {
    it('창 초과로 오래된 메시지가 잘린 호출은 단계 기록을 남긴다', async () => {
        chat.mockResolvedValue({ content: 'ok', metrics: { prompt_tokens: 9, context_dropped_messages: 4 } });
        const onNote = jest.fn();
        await callAgentTurnWithBudget({ ...base(), onNote });
        expect(onNote).toHaveBeenCalledTimes(1);
        expect(onNote.mock.calls[0][0]).toBe('context_trim');
        expect(onNote.mock.calls[0][1]).toContain('4건');
    });

    it('잘리지 않은 호출은 기록하지 않는다', async () => {
        chat.mockResolvedValue({ content: 'ok', metrics: { prompt_tokens: 9 } });
        const onNote = jest.fn();
        await callAgentTurnWithBudget({ ...base(), onNote });
        expect(onNote).not.toHaveBeenCalled();
    });
});

describe('callAgentTurnWithBudget — 출력 반복 기록', () => {
    const loop = '같은 문장을 계속 되풀이하는 모델 출력입니다. 설정을 확인하고 다시 시도하겠습니다. 잠시만 기다려 주세요. ';

    it('본문에서 짧은 구간이 여러 번 반복되면 단계 기록을 남기고, 반복이 시작된 뒤를 잘라 돌려준다', async () => {
        chat.mockResolvedValue({ content: `결과입니다.\n${loop.repeat(8)}` });
        const onNote = jest.fn();
        const out = await callAgentTurnWithBudget({ ...base(), onNote });
        expect(out.result.content).toBe(`결과입니다.\n${loop.trimEnd()}${OUTPUT_REPETITION_CUT_MARKER}`);
        expect(out.repetitionCut).toBe(true);
        expect(onNote).toHaveBeenCalledTimes(1);
        expect(onNote.mock.calls[0][0]).toBe('output_repetition');
        expect(onNote.mock.calls[0][1]).toContain('반복');
    });

    it('작업 목표가 반복 출력을 요청했으면 자르지 않는다 — 기록은 남긴다', async () => {
        chat.mockResolvedValue({ content: loop.repeat(8) });
        const onNote = jest.fn();
        const conversation = [{ role: 'system', content: 's' }, { role: 'user', content: `다음 문장을 8번 반복해서 써 줘: ${loop}` }];
        const out = await callAgentTurnWithBudget({ ...base(), conversation: conversation as never, onNote });
        expect(out.result.content).toBe(loop.repeat(8));
        expect(out.repetitionCut).toBeFalsy();
        expect(onNote.mock.calls[0][0]).toBe('output_repetition');
        expect(onNote.mock.calls[0][1]).toContain('기록만');
    });

    it('도구 호출이 함께 온 응답은 본문만 자르고 호출은 그대로 둔다', async () => {
        const tool_calls = [{ id: 'c1', type: 'function', function: { name: 'bash', arguments: { command: 'ls' } } }];
        chat.mockResolvedValue({ content: loop.repeat(8), tool_calls });
        const out = await callAgentTurnWithBudget({ ...base(), onNote: jest.fn() });
        expect(out.result.content).toBe(`${loop.trimEnd()}${OUTPUT_REPETITION_CUT_MARKER}`);
        expect(out.result.tool_calls).toBe(tool_calls);
    });

    it('본문이 텍스트 도구 호출(XML)이면 자르지 않는다 — 호출문이 깨지지 않게', async () => {
        const xml = `<tool_call>\n{"name": "bash", "arguments": {"command": "echo ${loop.repeat(8)}"}}\n</tool_call>`;
        chat.mockResolvedValue({ content: xml });
        const out = await callAgentTurnWithBudget({ ...base(), onNote: jest.fn() });
        expect(out.result.content).toBe(xml);
        expect(out.repetitionCut).toBeFalsy();
    });

    it('반복이 없으면 기록하지 않는다', async () => {
        chat.mockResolvedValue({ content: '작업을 마쳤습니다.' });
        const onNote = jest.fn();
        await callAgentTurnWithBudget({ ...base(), onNote });
        expect(onNote).not.toHaveBeenCalled();
    });
});

describe('partialResultOf', () => {
    it('시간 예산으로 끊긴 마무리 턴의 부분 본문만 결과로 남긴다', () => {
        expect(partialResultOf(new AgentTaskTurnTimeout('보고서 초안')).result).toContain('보고서 초안');
        expect(partialResultOf(new AgentTaskTurnTimeout(null))).toEqual({});
        expect(partialResultOf(new Error('x'))).toEqual({});
    });
});
