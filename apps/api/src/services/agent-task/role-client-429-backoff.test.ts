/**
 * 외부 provider 429 백오프 대기는 턴 호출 상한(callTimeoutMs)에 넣지 않는다 — 스로틀 프록시가 백오프 sleep 전후로
 * onSlotWait·onSlotAcquired 를 불러 role-client 가 상한 타이머를 멈췄다 다시 건다(슬롯 대기와 같은 취급).
 */
jest.mock('../../config/runtime-limits', () => {
    const actual = jest.requireActual('../../config/runtime-limits');
    return {
        ...actual,
        AGENT_TASK_LIMITS: { ...actual.AGENT_TASK_LIMITS, TURN_RETRY_MAX: 0, TURN_RETRY_BACKOFF_MS: 1, TURN_CALL_TIMEOUT_RETRY_MAX: 1 },
        EXTERNAL_PROVIDER_THROTTLE: { ...actual.EXTERNAL_PROVIDER_THROTTLE, RETRY_429_BASE_MS: 120, RETRY_429_MAX_MS: 120, RETRY_429_MAX: 1 },
    };
});
jest.mock('../../llm', () => ({ createClient: jest.fn() }));
jest.mock('../model-role-resolver', () => ({ resolveRoleClientForUser: jest.fn() }));
jest.mock('../../config/model-roles', () => ({ getModelForRole: (role: string) => `local-${role}-model` }));
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('../../utils/logger', () => ({ createLogger: () => mockLogger }));

import { chatTurnWithRoleFallback, TurnCallCapExceeded, type AgentRoleState } from './role-client';
import type { LLMClient } from '../../llm';
import { throttleExternalClient, __resetExternalThrottleForTest } from '../../llm/external-throttle';

/** 첫 호출은 429, 그다음은 성공하는 외부 클라이언트(원본) — abort 되면 거절. */
function flaky(): { raw: LLMClient; calls: () => number } {
    let n = 0;
    const chat = (_c: unknown, _o: unknown, _t: unknown, opts?: { signal?: AbortSignal }) => {
        n++;
        if (opts?.signal?.aborted) return Promise.reject(new Error('Request was aborted.'));
        if (n === 1) return Promise.reject(Object.assign(new Error('429 status code (no body)'), { status: 429 }));
        return Promise.resolve({ role: 'assistant', content: 'ok' });
    };
    return { raw: { chat, generate: chat, model: 'm' } as unknown as LLMClient, calls: () => n };
}

const params = () => ({ conversation: [], tools: [], signal: new AbortController().signal, taskId: 't1', userId: 'u1' });

beforeEach(() => __resetExternalThrottleForTest());

describe('chatTurnWithRoleFallback — 외부 429 백오프와 호출 상한', () => {
    it('백오프(120ms)가 상한(50ms)을 넘어도 상한이 발동하지 않고 재시도 성공을 돌려준다', async () => {
        const { raw, calls } = flaky();
        const throttled = throttleExternalClient(raw, 'bai');
        const state: AgentRoleState = { client: { derive: () => throttled } as unknown as LLMClient, external: true, fallbackDone: true };
        const onRetry = jest.fn();
        await expect(chatTurnWithRoleFallback(state, { ...params(), callTimeoutMs: 50, onRetry })).resolves.toMatchObject({ content: 'ok' });
        expect(calls()).toBe(2);
        expect(onRetry).not.toHaveBeenCalled();
    });

    it('대조: 슬롯 훅을 떼고 부르면 백오프 중 상한이 발동해 "호출 상한 초과 — 다시 시도" 로 한 번 더 부른다', async () => {
        const { raw, calls } = flaky();
        const throttled = throttleExternalClient(raw, 'bai');
        const noHooks = {
            chat: (c: unknown, o: unknown, t: unknown, opts: Record<string, unknown>) =>
                (throttled.chat as (...a: unknown[]) => Promise<unknown>)(c, o, t, { ...opts, onSlotWait: undefined, onSlotAcquired: undefined }),
        };
        const state: AgentRoleState = { client: { derive: () => noHooks } as unknown as LLMClient, external: true, fallbackDone: true };
        const onRetry = jest.fn();
        await expect(chatTurnWithRoleFallback(state, { ...params(), callTimeoutMs: 50, onRetry })).resolves.toMatchObject({ content: 'ok' });
        expect(calls()).toBe(2);
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(onRetry.mock.calls[0][0].error).toMatch(/호출 상한/);
    });

    it('대조: 매 시도 429 면 훅 없이 상한 재시도를 소진하고 TurnCallCapExceeded 로 끝난다', async () => {
        const always429 = { chat: () => Promise.reject(Object.assign(new Error('429 status code (no body)'), { status: 429 })), model: 'm' } as unknown as LLMClient;
        const throttled = throttleExternalClient(always429, 'bai');
        const noHooks = {
            chat: (c: unknown, o: unknown, t: unknown, opts: Record<string, unknown>) =>
                (throttled.chat as (...a: unknown[]) => Promise<unknown>)(c, o, t, { ...opts, onSlotWait: undefined, onSlotAcquired: undefined }),
        };
        const state: AgentRoleState = { client: { derive: () => noHooks } as unknown as LLMClient, external: true, fallbackDone: true };
        await expect(chatTurnWithRoleFallback(state, { ...params(), callTimeoutMs: 50 })).rejects.toBeInstanceOf(TurnCallCapExceeded);
    });
});
