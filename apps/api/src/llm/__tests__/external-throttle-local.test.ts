/**
 * 로컬 LLM 동시성 손잡이(W3 R1) — LOCAL_LLM_MAX_CONCURRENT>0 이면 local-llm 호출도 세마포어 슬롯을 거친다(429 재시도 없음, 슬롯만).
 * 0(기본)은 종전 그대로 무제한·원본 클라이언트.
 */
import type { LLMClient } from '../client';

type Throttle = typeof import('../external-throttle');

const saved = process.env.LOCAL_LLM_MAX_CONCURRENT;
afterEach(() => {
    if (saved === undefined) delete process.env.LOCAL_LLM_MAX_CONCURRENT;
    else process.env.LOCAL_LLM_MAX_CONCURRENT = saved;
});

function load(raw?: string): Throttle {
    jest.resetModules();
    if (raw === undefined) delete process.env.LOCAL_LLM_MAX_CONCURRENT;
    else process.env.LOCAL_LLM_MAX_CONCURRENT = raw;
    return require('../external-throttle') as Throttle;
}

/** 시작 순서를 기록하고, 손으로 끝낼 때까지 붙잡는 가짜 클라이언트 */
function gatedClient() {
    const started: number[] = [];
    const finishers: Array<() => void> = [];
    let n = 0;
    const impl = async () => {
        const id = ++n;
        started.push(id);
        await new Promise<void>((r) => finishers.push(r));
        return `ok${id}`;
    };
    const client = { chat: impl, generate: impl, model: 'local' } as unknown as LLMClient;
    return { client, started, finishers };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('local-llm 동시성 손잡이', () => {
    it('LOCAL_LLM_MAX_CONCURRENT=1 이면 두 번째 chat 은 첫 번째가 끝나기 전엔 시작하지 않는다', async () => {
        const t = load('1');
        expect((require('../../config/runtime-limits') as typeof import('../../config/runtime-limits')).EXTERNAL_PROVIDER_THROTTLE.LOCAL_CONCURRENCY).toBe(1);
        const g = gatedClient();
        const client = t.throttleExternalClient(g.client, 'local-llm');
        const a = client.chat([], undefined);
        const b = client.chat([], undefined);
        await flush();
        expect(g.started).toEqual([1]);
        g.finishers[0]();
        await expect(a).resolves.toBe('ok1');
        await flush();
        expect(g.started).toEqual([1, 2]);
        g.finishers[1]();
        await expect(b).resolves.toBe('ok2');
    });

    it('LOCAL_LLM_MAX_CONCURRENT=1 이면 withProviderSlot 도 local-llm 을 한 번에 하나씩 실행한다', async () => {
        const t = load('1');
        const g = gatedClient();
        const run = () => t.withProviderSlot('local-llm', () => g.client.chat([], undefined));
        const a = run();
        const b = run();
        await flush();
        expect(g.started).toEqual([1]);
        g.finishers[0]();
        await a;
        await flush();
        expect(g.started).toEqual([1, 2]);
        g.finishers[1]();
        await b;
    });

    it('로컬은 슬롯만 — 429 를 재시도하지 않고, 외부 실행 힌트도 붙이지 않는다', async () => {
        const t = load('1');
        let calls = 0;
        const raw = { chat: async () => { calls++; throw Object.assign(new Error('429 status code (no body)'), { status: 429 }); }, model: 'local' } as unknown as LLMClient;
        const client = t.throttleExternalClient(raw, 'local-llm');
        await expect(client.chat([], undefined)).rejects.toThrow(/429/);
        expect(calls).toBe(1);
        expect(t.getExternalClientHints(client)).toBeNull();
    });

    it('0(기본)이면 원본 클라이언트 그대로 — 두 chat 이 동시에 시작한다', async () => {
        for (const raw of [undefined, '0']) {
            const t = load(raw);
            const g = gatedClient();
            const client = t.throttleExternalClient(g.client, 'local-llm');
            expect(client).toBe(g.client);
            const a = client.chat([], undefined);
            const b = t.withProviderSlot('local-llm', () => g.client.chat([], undefined));
            await flush();
            expect(g.started).toEqual([1, 2]);
            g.finishers.forEach((f) => f());
            await Promise.all([a, b]);
        }
    });
});
