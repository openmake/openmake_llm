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
