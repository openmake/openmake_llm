// TURN_RETRY_* 는 .env 에 좌우된다 — 재시도 2회·백오프 1ms 로 고정해 결정적으로 만든다.
jest.mock('../../config/runtime-limits', () => {
    const actual = jest.requireActual('../../config/runtime-limits');
    return {
        ...actual,
        AGENT_TASK_LIMITS: {
            ...actual.AGENT_TASK_LIMITS,
            TURN_RETRY_MAX: 2,
            TURN_RETRY_BACKOFF_MS: 1,
        },
    };
});
// 로컬 폴백 경로가 실제 클라이언트를 만들지 않게 차단(이 스위트는 재시도 정책만 검증).
jest.mock('../../llm', () => ({ createClient: jest.fn() }));
jest.mock('../model-role-resolver', () => ({ resolveRoleClientForUser: jest.fn() }));

import { chatTurnWithRoleFallback, isTransientLLMError, type AgentRoleState } from './role-client';
import type { LLMClient } from '../../llm';

/** status 를 가진 오류 생성(openai SDK APIError 형태 흉내). */
function statusError(status: number, message = `http ${status}`): Error {
    const e = new Error(message) as Error & { status: number };
    e.status = status;
    return e;
}

/** chat 이 impls 를 순서대로 소비하는 가짜 클라이언트 상태. */
function fakeState(impls: Array<() => Promise<unknown>>): { state: AgentRoleState; calls: () => number } {
    let i = 0;
    const chat = jest.fn(() => {
        const impl = impls[Math.min(i, impls.length - 1)];
        i++;
        return impl();
    });
    const client = { derive: () => ({ chat }) } as unknown as LLMClient;
    return { state: { client, external: false, fallbackDone: true }, calls: () => i };
}

const params = (signal: AbortSignal = new AbortController().signal) => ({
    conversation: [], tools: [], signal, taskId: 't1', userId: 'u1',
});

describe('isTransientLLMError', () => {
    it('5xx·408·429 는 일시적', () => {
        expect(isTransientLLMError(statusError(500))).toBe(true);
        expect(isTransientLLMError(statusError(503))).toBe(true);
        expect(isTransientLLMError(statusError(408))).toBe(true);
        expect(isTransientLLMError(statusError(429))).toBe(true);
    });

    it('그 외 4xx 는 비일시적', () => {
        expect(isTransientLLMError(statusError(400))).toBe(false);
        expect(isTransientLLMError(statusError(404))).toBe(false);
    });

    it('status 없는 연결류 메시지는 일시적', () => {
        expect(isTransientLLMError(new Error('Connection error.'))).toBe(true);
        expect(isTransientLLMError(new Error('Request timed out.'))).toBe(true);
        expect(isTransientLLMError(new Error('read ECONNRESET'))).toBe(true);
    });

    it('abort·도메인 오류는 비일시적', () => {
        expect(isTransientLLMError(new Error('Request was aborted.'))).toBe(false);
        expect(isTransientLLMError(new Error('invalid tool arguments'))).toBe(false);
    });
});

describe('chatTurnWithRoleFallback 재시도', () => {
    it('일시적 오류는 재시도 후 성공을 반환하고 onRetry 를 호출한다', async () => {
        const ok = { content: 'done' };
        const { state, calls } = fakeState([
            () => Promise.reject(new Error('Connection error.')),
            () => Promise.resolve(ok),
        ]);
        const onRetry = jest.fn();
        const result = await chatTurnWithRoleFallback(state, { ...params(), onRetry });
        expect(result).toBe(ok);
        expect(calls()).toBe(2);
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(onRetry).toHaveBeenCalledWith(
            expect.objectContaining({ attempt: 1, maxAttempts: 2, error: 'Connection error.' }));
    });

    it('재시도 소진 시 마지막 오류를 throw 한다', async () => {
        const { state, calls } = fakeState([
            () => Promise.reject(statusError(500, 'upstream down')),
        ]);
        await expect(chatTurnWithRoleFallback(state, params())).rejects.toThrow('upstream down');
        expect(calls()).toBe(3); // 최초 1 + 재시도 2
    });

    it('비일시적 오류는 재시도 없이 즉시 throw 한다', async () => {
        const { state, calls } = fakeState([
            () => Promise.reject(statusError(400, 'bad request')),
        ]);
        await expect(chatTurnWithRoleFallback(state, params())).rejects.toThrow('bad request');
        expect(calls()).toBe(1);
    });

    it('signal aborted 면 일시적 오류도 재시도하지 않는다', async () => {
        const ac = new AbortController();
        const { state, calls } = fakeState([
            () => { ac.abort(); return Promise.reject(new Error('Connection error.')); },
        ]);
        await expect(chatTurnWithRoleFallback(state, params(ac.signal))).rejects.toThrow('Connection error.');
        expect(calls()).toBe(1);
    });
});
