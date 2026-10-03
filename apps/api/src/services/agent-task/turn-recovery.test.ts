/**
 * 재시도 소진 뒤 대기 — 짧은 재시도가 다 실패한 일시적 오류를 더 긴 간격으로 몇 번 더 기다린다.
 */
jest.mock('../../config/runtime-limits', () => {
    const actual = jest.requireActual('../../config/runtime-limits');
    return { ...actual, AGENT_TASK_LIMITS: { ...actual.AGENT_TASK_LIMITS, TURN_RETRY_MAX: 1, TURN_RETRY_BACKOFF_MS: 1, TURN_CALL_TIMEOUT_RETRY_MAX: 1 } };
});
jest.mock('../../config/agent-task-turn-loop', () => {
    const actual = jest.requireActual('../../config/agent-task-turn-loop');
    return { ...actual, AGENT_TASK_TURN_LOOP: { ...actual.AGENT_TASK_TURN_LOOP, RECOVERY_WAIT_ENABLED: true, RECOVERY_WAIT_MAX_CYCLES: 3, RECOVERY_WAIT_BASE_MS: 10, RECOVERY_WAIT_CAP_MS: 25 } };
});
jest.mock('../../llm', () => ({ createClient: jest.fn() }));
jest.mock('../model-role-resolver', () => ({ resolveRoleClientForUser: jest.fn() }));

import { recoveryWaitMs } from './turn-recovery';
import { chatTurnWithRoleFallback, type AgentRoleState } from './role-client';
import { AGENT_TASK_TURN_LOOP } from '../../config/agent-task-turn-loop';
import type { LLMClient } from '../../llm';

function fakeState(impls: Array<() => Promise<unknown>>): { state: AgentRoleState; calls: () => number } {
    let i = 0;
    const chat = jest.fn(() => impls[Math.min(i++, impls.length - 1)]());
    return { state: { client: { derive: () => ({ chat }) } as unknown as LLMClient, external: false, fallbackDone: true }, calls: () => i };
}
const params = () => ({ conversation: [], tools: [], signal: new AbortController().signal, taskId: 't1', userId: 'u1' });
const down = () => Promise.reject(Object.assign(new Error('upstream down'), { status: 503 }));

describe('recoveryWaitMs', () => {
    it('주기마다 두 배로 늘고 상한에서 멈춘다', () => {
        expect(recoveryWaitMs(1, 1_000)).toBe(10);
        expect(recoveryWaitMs(2, 1_000)).toBe(20);
        expect(recoveryWaitMs(3, 1_000)).toBe(25);
    });

    it('주기를 다 썼거나 남은 예산보다 길게 기다려야 하면 기다리지 않는다', () => {
        expect(recoveryWaitMs(4, 1_000)).toBeNull();
        expect(recoveryWaitMs(1, 10)).toBeNull();
        expect(recoveryWaitMs(1, undefined)).toBeNull();
    });

    it('끄면 기다리지 않는다', () => {
        const cfg = AGENT_TASK_TURN_LOOP as { RECOVERY_WAIT_ENABLED: boolean };
        cfg.RECOVERY_WAIT_ENABLED = false;
        try { expect(recoveryWaitMs(1, 1_000)).toBeNull(); } finally { cfg.RECOVERY_WAIT_ENABLED = true; }
    });
});

describe('chatTurnWithRoleFallback — 재시도 소진 뒤 대기', () => {
    it('짧은 재시도가 소진된 뒤 더 기다렸다가 성공하면 결과를 돌려주고 대기를 onRetry 로 알린다', async () => {
        const ok = { content: 'done' };
        const { state, calls } = fakeState([down, down, down, () => Promise.resolve(ok)]);
        const onRetry = jest.fn();
        const result = await chatTurnWithRoleFallback(state, { ...params(), onRetry, recoveryBudgetMs: 5_000 });
        expect(result).toBe(ok);
        expect(calls()).toBe(4); // 최초 1 + 짧은 재시도 1 + 긴 대기 2
        expect(onRetry).toHaveBeenCalledTimes(3);
        expect(onRetry.mock.calls[1][0]).toEqual(expect.objectContaining({ attempt: 1, maxAttempts: 3 }));
        expect(String(onRetry.mock.calls[1][0].error)).toContain('upstream down');
    });

    it('대기 주기까지 소진하면 마지막 오류를 던진다', async () => {
        const { state, calls } = fakeState([down]);
        await expect(chatTurnWithRoleFallback(state, { ...params(), recoveryBudgetMs: 5_000 })).rejects.toThrow('upstream down');
        expect(calls()).toBe(5); // 최초 1 + 짧은 재시도 1 + 긴 대기 3
    });

    it('남은 예산이 대기보다 짧으면 기다리지 않고 바로 실패한다', async () => {
        const { state, calls } = fakeState([down]);
        await expect(chatTurnWithRoleFallback(state, { ...params(), recoveryBudgetMs: 5 })).rejects.toThrow('upstream down');
        expect(calls()).toBe(2);
    });

    it('예산을 주지 않은 호출은 종전대로 짧은 재시도만 한다', async () => {
        const { state, calls } = fakeState([down]);
        await expect(chatTurnWithRoleFallback(state, params())).rejects.toThrow('upstream down');
        expect(calls()).toBe(2);
    });

    it('일시적이지 않은 오류는 기다리지 않는다', async () => {
        const { state, calls } = fakeState([() => Promise.reject(Object.assign(new Error('bad request'), { status: 400 }))]);
        await expect(chatTurnWithRoleFallback(state, { ...params(), recoveryBudgetMs: 5_000 })).rejects.toThrow('bad request');
        expect(calls()).toBe(1);
    });
});
