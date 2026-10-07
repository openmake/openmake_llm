// TURN_RETRY_* 는 .env 에 좌우된다 — 재시도 2회·백오프 1ms 로 고정해 결정적으로 만든다.
jest.mock('../../config/runtime-limits', () => {
    const actual = jest.requireActual('../../config/runtime-limits');
    return {
        ...actual,
        AGENT_TASK_LIMITS: {
            ...actual.AGENT_TASK_LIMITS,
            TURN_RETRY_MAX: 2,
            TURN_RETRY_BACKOFF_MS: 1,
            TURN_CALL_TIMEOUT_RETRY_MAX: 1,
        },
    };
});
jest.mock('../../config/agent-task-turn-loop', () => {
    const actual = jest.requireActual('../../config/agent-task-turn-loop');
    return { ...actual, AGENT_TASK_TURN_LOOP: { ...actual.AGENT_TASK_TURN_LOOP, THINKING_DOWNGRADE_AFTER_FAILURES: 2 } };
});
// 로컬 폴백 경로가 실제 클라이언트를 만들지 않게 차단(이 스위트는 재시도 정책만 검증).
jest.mock('../../llm', () => ({ createClient: jest.fn() }));
jest.mock('../model-role-resolver', () => ({ resolveRoleClientForUser: jest.fn() }));

import { chatTurnWithRoleFallback, isTransientLLMError, TurnCallCapExceeded, type AgentRoleState } from './role-client';
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

describe('chatTurnWithRoleFallback 호출당 상한', () => {
    /** signal 이 abort 될 때까지 끝나지 않는 호출(멈춘 모델 서버 흉내). */
    const hang = (seen: AbortSignal[]) => jest.fn((_c: unknown, _o: unknown, _t: unknown, opts: { signal: AbortSignal }) => new Promise((_res, rej) => {
        seen.push(opts.signal);
        opts.signal.addEventListener('abort', () => rej(new Error('Request was aborted.')), { once: true });
    }));
    const stateWith = (chat: jest.Mock): AgentRoleState => ({ client: { derive: () => ({ chat }) } as unknown as LLMClient, external: false, fallbackDone: true });

    it('상한을 넘긴 호출을 끊고 한 번 다시 시도해 성공하면 그 결과를 돌려준다', async () => {
        const seen: AbortSignal[] = [];
        const stuck = hang(seen);
        let n = 0;
        const chat = jest.fn((...a: unknown[]) => (n++ === 0 ? (stuck as unknown as (...x: unknown[]) => Promise<unknown>)(...a) : Promise.resolve({ content: 'ok' })));
        const onRetry = jest.fn();
        const r = await chatTurnWithRoleFallback(stateWith(chat), { ...params(), callTimeoutMs: 20, onRetry });
        expect(r).toEqual({ content: 'ok' });
        expect(chat).toHaveBeenCalledTimes(2);
        expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('호출 상한') }));
    });

    it('다시 시도해도 상한을 넘기면 TurnCallCapExceeded 를 던진다', async () => {
        const chat = hang([]);
        await expect(chatTurnWithRoleFallback(stateWith(chat), { ...params(), callTimeoutMs: 20 })).rejects.toBeInstanceOf(TurnCallCapExceeded);
        expect(chat).toHaveBeenCalledTimes(2);
    });

    it('작업 전체 signal 로 끊긴 호출은 다시 시도하지 않는다', async () => {
        const ac = new AbortController();
        const chat = hang([]);
        const p = chatTurnWithRoleFallback(stateWith(chat), { ...params(ac.signal), callTimeoutMs: 10_000 });
        ac.abort();
        await expect(p).rejects.toThrow('aborted');
        expect(chat).toHaveBeenCalledTimes(1);
    });

    it('상한을 주지 않으면(마무리 턴) 종전처럼 작업 signal 만 쓴다', async () => {
        const seen: AbortSignal[] = [];
        const ac = new AbortController();
        const chat = jest.fn((_c: unknown, _o: unknown, _t: unknown, opts: { signal: AbortSignal }) => { seen.push(opts.signal); return Promise.resolve({ content: 'ok' }); });
        await chatTurnWithRoleFallback(stateWith(chat), params(ac.signal));
        expect(seen[0]).toBe(ac.signal);
    });
});

describe('chatTurnWithRoleFallback 무응답 감지', () => {
    type Opts = { signal: AbortSignal; onChunk?: () => void };
    const stateWith = (chat: jest.Mock, external = false): AgentRoleState => ({ client: { derive: () => ({ chat }) } as unknown as LLMClient, external, fallbackDone: true });
    /** 청크를 everyMs 간격으로 count 번 흘린 뒤 멈추는 호출 — signal 이 abort 되면 실패한다. */
    const stalls = (everyMs: number, count: number) => (_c: unknown, _o: unknown, _t: unknown, opts: Opts) => new Promise((_res, rej) => {
        let sent = 0;
        const timer = setInterval(() => { if (sent++ < count) opts.onChunk?.(); else clearInterval(timer); }, everyMs);
        opts.signal.addEventListener('abort', () => { clearInterval(timer); rej(new Error('Request was aborted.')); }, { once: true });
    });
    const idle = { firstChunkMs: 40, gapMs: 30 };

    it('첫 청크가 오지 않으면 끊고 일시적 오류처럼 다시 시도한다', async () => {
        let n = 0;
        const chat = jest.fn((...a: unknown[]) => (n++ === 0 ? (stalls(5, 0) as (...x: unknown[]) => Promise<unknown>)(...a) : Promise.resolve({ content: 'ok' })));
        const onRetry = jest.fn();
        const r = await chatTurnWithRoleFallback(stateWith(chat), { ...params(), idle, onRetry });
        expect(r).toEqual({ content: 'ok' });
        expect(chat).toHaveBeenCalledTimes(2);
        expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('응답 없음') }));
    });

    it('청크가 오다가 멈춰도 끊고 다시 시도한다', async () => {
        let n = 0;
        const chat = jest.fn((...a: unknown[]) => (n++ === 0 ? (stalls(5, 3) as (...x: unknown[]) => Promise<unknown>)(...a) : Promise.resolve({ content: 'ok' })));
        expect(await chatTurnWithRoleFallback(stateWith(chat), { ...params(), idle })).toEqual({ content: 'ok' });
        expect(chat).toHaveBeenCalledTimes(2);
    });

    it('청크가 간격 안에 계속 오면 첫 청크 기한보다 오래 걸려도 끊지 않는다', async () => {
        const chat = jest.fn((_c: unknown, _o: unknown, _t: unknown, opts: Opts) => new Promise((res, rej) => {
            let sent = 0;
            const timer = setInterval(() => { opts.onChunk?.(); if (++sent === 12) { clearInterval(timer); res({ content: 'long' }); } }, 10);
            opts.signal.addEventListener('abort', () => { clearInterval(timer); rej(new Error('Request was aborted.')); }, { once: true });
        }));
        expect(await chatTurnWithRoleFallback(stateWith(chat), { ...params(), idle })).toEqual({ content: 'long' });
        expect(chat).toHaveBeenCalledTimes(1);
    });

    it('감시 중에는 호출 상한을 걸지 않는다 — 청크가 오는 긴 생성은 상한을 넘겨도 끝까지 받는다', async () => {
        const chat = jest.fn((_c: unknown, _o: unknown, _t: unknown, opts: Opts) => new Promise((res, rej) => {
            let sent = 0;
            const timer = setInterval(() => { opts.onChunk?.(); if (++sent === 12) { clearInterval(timer); res({ content: 'long' }); } }, 10);
            opts.signal.addEventListener('abort', () => { clearInterval(timer); rej(new Error('Request was aborted.')); }, { once: true });
        }));
        expect(await chatTurnWithRoleFallback(stateWith(chat), { ...params(), idle, callTimeoutMs: 30 })).toEqual({ content: 'long' });
        expect(chat).toHaveBeenCalledTimes(1);
    });

    it('감시를 켜면 스트리밍으로 부른다(onToken 을 넘긴다) — 끄면 종전대로 넘기지 않는다', async () => {
        const chat = jest.fn(() => Promise.resolve({ content: 'ok' }));
        await chatTurnWithRoleFallback(stateWith(chat), { ...params(), idle });
        await chatTurnWithRoleFallback(stateWith(chat), params());
        const calls = chat.mock.calls as unknown as Array<[unknown, unknown, unknown, Opts]>;
        expect(typeof calls[0][2]).toBe('function');
        expect(typeof calls[0][3].onChunk).toBe('function');
        expect(calls[1][2]).toBeUndefined();
    });

    it('외부 모델에는 걸지 않는다 — 청크 신호를 주지 않는 클라이언트가 있다', async () => {
        const chat = jest.fn(() => new Promise((res) => setTimeout(() => res({ content: 'slow' }), 80)));
        expect(await chatTurnWithRoleFallback(stateWith(chat, true), { ...params(), idle })).toEqual({ content: 'slow' });
        expect(chat).toHaveBeenCalledTimes(1);
        expect((chat.mock.calls as unknown as Array<[unknown, unknown, unknown]>)[0][2]).toBeUndefined();
    });

    it('다시 시도를 다 써도 응답이 없으면 실패로 끝난다', async () => {
        const chat = jest.fn(stalls(5, 0) as (...x: unknown[]) => Promise<unknown>);
        await expect(chatTurnWithRoleFallback(stateWith(chat), { ...params(), idle })).rejects.toThrow('응답 없음');
        expect(chat).toHaveBeenCalledTimes(3);
    });
});

describe('추론 수준(184)', () => {
    function stateWithThinking(impls: Array<() => Promise<unknown>>, level: 'off' | 'low' | 'medium' | 'high') {
        const { state, calls } = fakeState(impls);
        state.thinkingLevel = level; state.thinkingFailures = 0; state.thinkingDowngraded = false;
        const chat = (state.client.derive({}) as unknown as { chat: jest.Mock }).chat;
        return { state, calls, chat };
    }
    it('off 는 think:false 그대로 보낸다 — 종전 요청과 같다', async () => {
        const { state, chat } = stateWithThinking([async () => ({ content: 'ok' })], 'off');
        await chatTurnWithRoleFallback(state, params());
        expect(chat.mock.calls[0][3]).toMatchObject({ think: false });
    });
    it('수준을 켜면 think 에 그 값이 실린다', async () => {
        const { state, chat } = stateWithThinking([async () => ({ content: 'ok' })], 'medium');
        await chatTurnWithRoleFallback(state, params());
        expect(chat.mock.calls[0][3]).toMatchObject({ think: 'medium' });
    });
    it('호출 상한 초과가 임계(2)에 닿으면 강등해 think:false 로 다시 부르고 안내를 한 번 남긴다', async () => {
        // TURN_CALL_TIMEOUT_RETRY_MAX 는 1 로 고정돼 있다(위 mock). 상한 초과 2회 → 강등 → 3번째 호출은 think:false.
        // fakeState 의 impl 은 signal 을 받지 않는다 — 상한(20ms)이 끊은 뒤 스스로 거절해 끝나지 않는 호출을 흉내 낸다.
        const hang = () => new Promise<never>((_res, rej) => { setTimeout(() => rej(new Error('aborted')), 50); });
        const { state, chat } = stateWithThinking([hang, hang, async () => ({ content: 'ok' })], 'high');
        const onThinkingDowngrade = jest.fn();
        const r = await chatTurnWithRoleFallback(state, { ...params(), callTimeoutMs: 20, onThinkingDowngrade });
        expect(r).toEqual({ content: 'ok' });
        expect(onThinkingDowngrade).toHaveBeenCalledTimes(1);
        expect(onThinkingDowngrade.mock.calls[0][0]).toContain('추론(high)');
        expect(chat.mock.calls[0][3]).toMatchObject({ think: 'high' });
        expect(chat.mock.calls[2][3]).toMatchObject({ think: false });
        expect(state.thinkingDowngraded).toBe(true);
    });
    it('빈 본문 응답({ content: \'\' })이 돌아와도 thinkingFailures 를 0 으로 되돌리지 않는다', async () => {
        // 성공 처리는 서비스의 비어 있지 않은 정상 턴에서만 한다 — 여기서 되돌리면 빈 응답 연속 강등이 영영 임계에 닿지 않는다.
        const { state } = stateWithThinking([async () => ({ content: '' })], 'high');
        state.thinkingFailures = 1;
        await chatTurnWithRoleFallback(state, params());
        expect(state.thinkingFailures).toBe(1);
    });
    it('무응답 감시 발동이 임계에 닿으면 강등해 think:false 로 다시 부른다', async () => {
        // 감시가 켜진 내부 모델 도구 턴에는 호출 상한이 걸리지 않는다 — 감시 발동도 추론 실패로 세야 강등에 닿는다.
        type Opts = { signal: AbortSignal; onChunk?: () => void };
        const silent = (_c: unknown, _o: unknown, _t: unknown, opts: Opts) => new Promise((_res, rej) => {
            opts.signal.addEventListener('abort', () => rej(new Error('Request was aborted.')), { once: true });
        });
        let n = 0;
        const chat = jest.fn((...a: unknown[]) => (n++ < 2 ? (silent as (...x: unknown[]) => Promise<unknown>)(...a) : Promise.resolve({ content: 'ok' })));
        const state: AgentRoleState = { client: { derive: () => ({ chat }) } as unknown as LLMClient, external: false, fallbackDone: true,
            thinkingLevel: 'high', thinkingFailures: 0, thinkingDowngraded: false };
        const onThinkingDowngrade = jest.fn();
        const r = await chatTurnWithRoleFallback(state, { ...params(), idle: { firstChunkMs: 40, gapMs: 30 }, onThinkingDowngrade });
        expect(r).toEqual({ content: 'ok' });
        expect(chat).toHaveBeenCalledTimes(3);
        expect(onThinkingDowngrade).toHaveBeenCalledTimes(1);
        const calls = chat.mock.calls as unknown as Array<[unknown, unknown, unknown, { think?: unknown }]>;
        expect(calls[0][3]).toMatchObject({ think: 'high' });
        expect(calls[2][3]).toMatchObject({ think: false });
    });
    it('off 작업의 호출 상한 초과는 종전처럼 TurnCallCapExceeded 로 끝난다', async () => {
        // fakeState 의 impl 은 signal 을 받지 않는다 — 상한(20ms)이 끊은 뒤 스스로 거절해 끝나지 않는 호출을 흉내 낸다.
        const hang = () => new Promise<never>((_res, rej) => { setTimeout(() => rej(new Error('aborted')), 50); });
        const { state } = stateWithThinking([hang, hang], 'off');
        await expect(chatTurnWithRoleFallback(state, { ...params(), callTimeoutMs: 20 })).rejects.toBeInstanceOf(TurnCallCapExceeded);
    });
});
