/**
 * 로컬 LLM 동시성 손잡이를 LLMClient 생성 지점까지(#1656) — createClient 가 만드는 로컬 클라이언트(채팅 본 루프·에이전트 작업 본 루프가 쓴다)는
 * LOCAL_LLM_MAX_CONCURRENT>0 일 때 chat·generate 한 번 동안만 local-llm 슬롯을 잡는다. 0(기본)이면 감싸지 않는다.
 * 외부 클라이언트(quotaExempt)는 model-role-resolver 가 자기 provider 슬롯으로 감싸므로 여기서 local-llm 슬롯을 잡지 않는다.
 */
import { types } from 'node:util';
import type * as ClientModule from '../client';

const started: number[] = [];
const finishers: Array<() => void> = [];
jest.mock('../model-pool', () => ({ selectModelByCapacityExact: async () => ({ model: 'm', source: 'manual' }), estimateTokens: () => 1 }));
jest.mock('../stream-parser', () => ({
    nonStreamChat: async () => {
        const id = started.length + 1;
        started.push(id);
        await new Promise<void>((r) => finishers.push(r));
        return { role: 'assistant', content: `ok${id}` };
    },
    streamChat: jest.fn(),
}));
jest.mock('../user-quota', () => ({ reserveUserQuota: async () => null, settleUserQuota: async () => undefined }));
jest.mock('../request-metrics', () => ({ recordLlmRequestMetric: jest.fn(), classifyLlmError: () => 'unknown' }));
jest.mock('../../services/cost/cost-ledger-service', () => ({ recordLlmCost: jest.fn() }));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({ query: async () => ({ rows: [] }) }) }));

const saved = process.env.LOCAL_LLM_MAX_CONCURRENT;
afterEach(() => {
    if (saved === undefined) delete process.env.LOCAL_LLM_MAX_CONCURRENT;
    else process.env.LOCAL_LLM_MAX_CONCURRENT = saved;
});
beforeEach(() => { started.length = 0; finishers.length = 0; });

function load(raw?: string): typeof ClientModule {
    jest.resetModules();
    if (raw === undefined) delete process.env.LOCAL_LLM_MAX_CONCURRENT;
    else process.env.LOCAL_LLM_MAX_CONCURRENT = raw;
    return require('../client') as typeof ClientModule;
}

const flush = () => new Promise((r) => setImmediate(r));
const msgs = [{ role: 'user' as const, content: 'u' }];

describe('createClient — 로컬 LLM 슬롯', () => {
    it('LOCAL_LLM_MAX_CONCURRENT=1 이면 로컬 클라이언트 두 개의 chat 이 한 번에 하나씩 실행된다', async () => {
        const { createClient } = load('1');
        const a = createClient({ model: 'm' }).chat(msgs);
        const b = createClient({ model: 'm' }).chat(msgs);
        await flush();
        expect(started).toEqual([1]);
        finishers[0]();
        await expect(a).resolves.toMatchObject({ content: 'ok1' });
        await flush();
        expect(started).toEqual([1, 2]); // 앞 호출이 끝나면 바로 — 슬롯은 chat 한 번 동안만 잡힌다
        finishers[1]();
        await expect(b).resolves.toMatchObject({ content: 'ok2' });
    });

    it('generate 도 같은 슬롯을 쓰고, 안에서 부르는 chat 이 슬롯을 다시 잡지 않는다(한도 1 에서 교착 없음)', async () => {
        const { createClient } = load('1');
        const client = createClient({ model: 'm' });
        const a = client.generate('p');
        const b = client.chat(msgs);
        await flush();
        expect(started).toEqual([1]);
        finishers[0]();
        await expect(a).resolves.toMatchObject({ response: 'ok1' });
        await flush();
        expect(started).toEqual([1, 2]);
        finishers[1]();
        await b;
    });

    it('외부 클라이언트(quotaExempt)는 local-llm 슬롯을 잡지 않는다', async () => {
        const { createClient } = load('1');
        const ext = createClient({ model: 'm', quotaExempt: true });
        expect(types.isProxy(ext)).toBe(false);
        const a = createClient({ model: 'm' }).chat(msgs);
        const b = ext.chat(msgs);
        await flush();
        expect(started).toEqual([1, 2]);
        finishers.forEach((f) => f());
        await Promise.all([a, b]);
    });

    it('0(기본)이면 감싸지 않는다 — 원본 LLMClient 그대로, 동시에 시작한다', async () => {
        for (const raw of [undefined, '0']) {
            started.length = 0; finishers.length = 0;
            const { createClient, LLMClient } = load(raw);
            const client = createClient({ model: 'm' });
            expect(types.isProxy(client)).toBe(false);
            expect(client).toBeInstanceOf(LLMClient);
            const a = client.chat(msgs);
            const b = createClient({ model: 'm' }).chat(msgs);
            await flush();
            expect(started).toEqual([1, 2]);
            finishers.forEach((f) => f());
            await Promise.all([a, b]);
        }
    });
});
