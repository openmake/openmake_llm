/** 외부 provider 스로틀 — provider 별 동시성 세마포어 + 429 지수 백오프 (2026-09-03) */
import { EXTERNAL_PROVIDER_THROTTLE } from '../../config/runtime-limits';
import { throttleExternalClient, providerConcurrency, __resetExternalThrottleForTest, is429 } from '../external-throttle';
import type { LLMClient } from '../client';

const mutable = EXTERNAL_PROVIDER_THROTTLE as unknown as Record<string, unknown>;
const original = { ...EXTERNAL_PROVIDER_THROTTLE };

function fakeClient(impl: (...a: unknown[]) => Promise<unknown>): LLMClient {
    return { chat: impl, generate: impl, model: 'm', other: 42, helper(this: { model: string }) { return this.model; } } as unknown as LLMClient;
}

describe('throttleExternalClient', () => {
    beforeEach(() => { __resetExternalThrottleForTest(); Object.assign(mutable, original, { RETRY_429_BASE_MS: 5, RETRY_429_MAX_MS: 20, RETRY_429_MAX: 3 }); });
    afterEach(() => Object.assign(mutable, original));

    it('카탈로그 힌트가 동시성을 정한다 (bai=1, hasa=2, 미지정=DEFAULT)', () => {
        expect(providerConcurrency('bai')).toBe(1);
        expect(providerConcurrency('hasa')).toBe(2);
        expect(providerConcurrency('nvidia')).toBe(EXTERNAL_PROVIDER_THROTTLE.DEFAULT_CONCURRENCY);
    });

    it('bai 는 5개 병렬 호출을 1개씩 직렬화한다 (동시 in-flight 최대 1)', async () => {
        let inFlight = 0, peak = 0;
        const client = throttleExternalClient(fakeClient(async () => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 10)); inFlight--; return 'ok'; }), 'bai');
        const results = await Promise.all(Array.from({ length: 5 }, () => client.chat([], undefined)));
        expect(results).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
        expect(peak).toBe(1);
    });

    it('hasa 는 동시 2개까지', async () => {
        let inFlight = 0, peak = 0;
        const client = throttleExternalClient(fakeClient(async () => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 10)); inFlight--; return 'ok'; }), 'hasa');
        await Promise.all(Array.from({ length: 5 }, () => client.chat([], undefined)));
        expect(peak).toBe(2);
    });

    it('429 는 백오프 후 재시도해 성공을 돌려준다', async () => {
        let calls = 0;
        const client = throttleExternalClient(fakeClient(async () => { calls++; if (calls < 3) throw Object.assign(new Error('429 status code (no body)'), { status: 429 }); return 'done'; }), 'bai');
        await expect(client.chat([], undefined)).resolves.toBe('done');
        expect(calls).toBe(3);
    });

    it('재시도 상한을 넘기면 마지막 429 를 그대로 던진다', async () => {
        const client = throttleExternalClient(fakeClient(async () => { throw Object.assign(new Error('429 status code (no body)'), { status: 429 }); }), 'bai');
        await expect(client.chat([], undefined)).rejects.toThrow(/429/);
    });

    it('429 가 아닌 오류는 재시도 없이 즉시 전파', async () => {
        let calls = 0;
        const client = throttleExternalClient(fakeClient(async () => { calls++; throw Object.assign(new Error('boom'), { status: 500 }); }), 'bai');
        await expect(client.chat([], undefined)).rejects.toThrow('boom');
        expect(calls).toBe(1);
    });

    it('abort 된 signal 이면 백오프 대기 없이 중단', async () => {
        const ac = new AbortController();
        let calls = 0;
        const client = throttleExternalClient(fakeClient(async () => { calls++; ac.abort(); throw Object.assign(new Error('429'), { status: 429 }); }), 'bai');
        await expect(client.chat([], undefined, undefined, { signal: ac.signal })).rejects.toThrow();
        expect(calls).toBe(1);
    });

    it('로컬(local-llm)은 원본 그대로, 다른 속성/메서드는 원본에 위임(this 보존)', () => {
        const raw = fakeClient(async () => 'x');
        expect(throttleExternalClient(raw, 'local-llm')).toBe(raw);
        const wrapped = throttleExternalClient(raw, 'bai') as unknown as { other: number; helper: () => string; model: string };
        expect(wrapped.other).toBe(42);
        expect(wrapped.helper()).toBe('m');
    });

    it('is429 는 status/statusCode 또는 SDK 정형 문구만 인식 — 본문 속 숫자 429 는 오탐 아님', () => {
        expect(is429({ status: 429 })).toBe(true);
        expect(is429({ statusCode: 429 })).toBe(true);
        expect(is429(new Error('429 status code (no body)'))).toBe(true);
        expect(is429(new Error('500'))).toBe(false);
        expect(is429(new Error('request id 429 failed: invalid model'))).toBe(false);
        expect(is429(null)).toBe(false);
    });

    it('Retry-After 헤더가 지수 상한보다 커도 존중한다 (별도 상한 내)', async () => {
        Object.assign(mutable, { RETRY_429_BASE_MS: 1, RETRY_429_MAX_MS: 2, RETRY_AFTER_HEADER_MAX_MS: 40, RETRY_429_MAX: 1 });
        let calls = 0; const t0 = Date.now();
        const client = throttleExternalClient(fakeClient(async () => { calls++; if (calls === 1) throw Object.assign(new Error('429 status code (no body)'), { status: 429, headers: { 'retry-after': '0.03' } }); return 'ok'; }), 'bai');
        await expect(client.chat([], undefined)).resolves.toBe('ok');
        expect(Date.now() - t0).toBeGreaterThanOrEqual(25); // 30ms 헤더 > 2ms 지수 상한
    });

    it('generate 의 abort signal 은 5번째 인자에서 읽는다', async () => {
        const ac = new AbortController();
        let calls = 0;
        const client = throttleExternalClient(fakeClient(async () => { calls++; ac.abort(); throw Object.assign(new Error('429 status code (no body)'), { status: 429 }); }), 'bai');
        await expect(client.generate('p', undefined, undefined, undefined, { signal: ac.signal })).rejects.toThrow();
        expect(calls).toBe(1);
    });
});

describe('throttleExternalClient — 슬롯 대기 훅(onSlotWait·onSlotAcquired)', () => {
    beforeEach(() => __resetExternalThrottleForTest());

    it('동시성 1(bai)에서 두 번째 호출은 onSlotWait(대기 시작, 동기) → 앞 호출이 끝난 뒤 onSlotAcquired → 원본 호출 순서다', async () => {
        const order: string[] = [];
        const finishers: Array<() => void> = [];
        let n = 0;
        const client = throttleExternalClient(fakeClient(async () => {
            const id = ++n;
            order.push(`start${id}`);
            await new Promise<void>((r) => finishers.push(r));
            return `ok${id}`;
        }), 'bai');
        const flush = () => new Promise((r) => setImmediate(r));
        const hooks = (tag: string) => ({ onSlotWait: () => order.push(`wait${tag}`), onSlotAcquired: () => order.push(`acq${tag}`) });
        const a = client.chat([], undefined, undefined, hooks('A') as never);
        const b = client.chat([], undefined, undefined, hooks('B') as never);
        expect(order).toEqual(['waitA', 'waitB']); // 둘 다 acquire 직전에 동기로 불린다
        await flush();
        expect(order).toEqual(['waitA', 'waitB', 'acqA', 'start1']); // B 는 슬롯을 아직 못 받았다
        finishers[0]();
        await expect(a).resolves.toBe('ok1');
        await flush();
        expect(order).toEqual(['waitA', 'waitB', 'acqA', 'start1', 'acqB', 'start2']);
        finishers[1]();
        await expect(b).resolves.toBe('ok2');
        // generate 는 advancedOptions 가 args[4] — 같은 훅을 부른다
        const g = jest.fn();
        await Promise.all([client.generate('p', undefined, undefined, undefined, { onSlotAcquired: g } as never), (async () => { await flush(); finishers[2]?.(); })()]);
        expect(g).toHaveBeenCalledTimes(1);
    });
});

describe('ExternalClientHints', () => {
    it('스로틀 프록시는 provider 동시성·타임아웃 배수 힌트를 노출하고, 로컬은 null', () => {
        const { getExternalClientHints } = require('../external-throttle') as typeof import('../external-throttle');
        __resetExternalThrottleForTest();
        const raw = fakeClient(async () => 'x');
        const h = getExternalClientHints(throttleExternalClient(raw, 'bai'));
        expect(h).toEqual({ providerId: 'bai', concurrency: 1, timeoutMultiplier: EXTERNAL_PROVIDER_THROTTLE.TIMEOUT_MULTIPLIER });
        expect(getExternalClientHints(raw)).toBeNull();
        expect(getExternalClientHints(throttleExternalClient(raw, 'local-llm'))).toBeNull();
    });
});

describe('externalClientTiming', () => {
    it('LLM_TIMEOUT × 배수, maxRetries 0', () => {
        const { externalClientTiming } = require('../external-throttle') as typeof import('../external-throttle');
        const mutable2 = EXTERNAL_PROVIDER_THROTTLE as unknown as Record<string, unknown>;
        const orig = EXTERNAL_PROVIDER_THROTTLE.TIMEOUT_MULTIPLIER;
        Object.assign(mutable2, { TIMEOUT_MULTIPLIER: 6 });
        try {
            expect(externalClientTiming(120000)).toEqual({ timeout: 720000, maxRetries: 0 });
        } finally { Object.assign(mutable2, { TIMEOUT_MULTIPLIER: orig }); }
    });
});

describe('throttleExternalClient — 429 백오프 대기도 슬롯 대기 훅으로 알린다(턴 호출 상한에서 뺀다)', () => {
    beforeEach(() => { __resetExternalThrottleForTest(); Object.assign(mutable, original, { RETRY_429_BASE_MS: 5, RETRY_429_MAX_MS: 20, RETRY_429_MAX: 3 }); });
    afterEach(() => Object.assign(mutable, original));

    it('429 → 백오프 전 onSlotWait, 깨어난 뒤 onSlotAcquired 를 한 번씩 더 부르고 재시도한다', async () => {
        const order: string[] = [];
        let calls = 0;
        const client = throttleExternalClient(fakeClient(async () => {
            order.push('call');
            if (++calls === 1) throw Object.assign(new Error('429 status code (no body)'), { status: 429 });
            return 'ok';
        }), 'bai');
        const hooks = { onSlotWait: () => order.push('wait'), onSlotAcquired: () => order.push('acq') };
        await expect(client.chat([], undefined, undefined, hooks as never)).resolves.toBe('ok');
        expect(order).toEqual(['wait', 'acq', 'call', 'wait', 'acq', 'call']);
    });

    it('재시도 상한을 넘긴 마지막 429 뒤에는 대기 훅을 더 부르지 않는다', async () => {
        Object.assign(mutable, { RETRY_429_MAX: 1 });
        const order: string[] = [];
        const client = throttleExternalClient(fakeClient(async () => { order.push('call'); throw Object.assign(new Error('429 status code (no body)'), { status: 429 }); }), 'bai');
        const hooks = { onSlotWait: () => order.push('wait'), onSlotAcquired: () => order.push('acq') };
        await expect(client.chat([], undefined, undefined, hooks as never)).rejects.toThrow(/429/);
        expect(order).toEqual(['wait', 'acq', 'call', 'wait', 'acq', 'call']);
    });
});

describe('throttleExternalClient — derive', () => {
    beforeEach(() => __resetExternalThrottleForTest());
    const { getExternalClientHints } = require('../external-throttle') as typeof import('../external-throttle');

    it('derive 가 같은 인스턴스를 돌려주는 어댑터(OAuth role 클라이언트)면 프록시를 돌려준다 — 파생 chat 도 세마포어를 거친다', async () => {
        let inFlight = 0, peak = 0;
        const raw = fakeClient(async () => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 10)); inFlight--; return 'ok'; });
        (raw as unknown as { derive: () => unknown }).derive = function (this: unknown) { return this; };
        const wrapped = throttleExternalClient(raw, 'bai');
        const derived = wrapped.derive({});
        expect(derived).toBe(wrapped);
        expect(getExternalClientHints(derived)?.providerId).toBe('bai');
        await Promise.all([derived.chat([], undefined), derived.chat([], undefined), wrapped.chat([], undefined)]);
        expect(peak).toBe(1);
    });

    it('derive 가 새 인스턴스를 돌려주면(createClient 경로 — 이미 감싸져 나온다) 그 결과를 그대로 돌려준다(이중 감싸기 없음)', () => {
        const fresh = throttleExternalClient(fakeClient(async () => 'fresh'), 'bai');
        const raw = fakeClient(async () => 'x');
        (raw as unknown as { derive: () => unknown }).derive = () => fresh;
        const derived = throttleExternalClient(raw, 'bai').derive({});
        expect(derived).toBe(fresh);
        expect(getExternalClientHints(derived)?.providerId).toBe('bai');
    });

    it('회귀 고정: createClient(quotaExempt+providerId).derive() 는 스로틀 힌트를 유지하고 한 겹이다 — 동시성 1 에서 교착 없이 끝난다', async () => {
        const { createClient, LLMClient } = require('../client') as typeof import('../client');
        const spy = jest.spyOn(LLMClient.prototype, 'chat').mockResolvedValue({ role: 'assistant', content: 'ok' });
        try {
            const ext = createClient({ model: 'm', quotaExempt: true, providerId: 'bai' });
            const derived = ext.derive({ timeout: 1000 });
            expect(getExternalClientHints(derived)?.providerId).toBe('bai');
            expect(derived.requestTimeout).toBe(1000);
            const deadlock = new Promise((r) => setTimeout(() => r('deadlock'), 200));
            await expect(Promise.race([derived.derive({ timeout: 2000 }).chat([]), deadlock])).resolves.toMatchObject({ content: 'ok' });
            expect(spy).toHaveBeenCalledTimes(1);
        } finally { spy.mockRestore(); }
    });
});
