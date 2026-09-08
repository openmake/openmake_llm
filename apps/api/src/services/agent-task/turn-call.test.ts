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
jest.mock('./role-client', () => ({ chatTurnWithRoleFallback: jest.fn() }));

import { callAgentTurnWithBudget, AgentTaskTurnTimeout } from './turn-call';
import { chatTurnWithRoleFallback } from './role-client';
import { AgentTaskAbort } from './types';

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

    it('예산 밖의 일반 오류는 그대로 전파된다', async () => {
        chat.mockRejectedValue(new Error('boom'));
        await expect(callAgentTurnWithBudget(base())).rejects.toThrow('boom');
    });
});
