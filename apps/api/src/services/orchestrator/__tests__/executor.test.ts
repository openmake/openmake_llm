/** executePlan — 레벨 병렬·실패 부모 → 자식 skipped·preflight 거절·pending·취소 */
const calls: string[] = [];
const behaviors: Record<string, (signal?: AbortSignal) => Promise<unknown>> = {};
jest.mock('../executors', () => ({
    UnsupportedCapabilityError: class extends Error {},
    executorFor: () => async (task: { id: string }, ctx: { signal?: AbortSignal }) => {
        calls.push(task.id);
        const b = behaviors[task.id];
        return b ? b(ctx.signal) : { ok: true, text: `done ${task.id}`, media: [] };
    },
}));

import { executePlan } from '../executor';
import { HttpCallError } from '../http-call';
import { buildResultBlock } from '../orchestrate';
import { validatePlan } from '../plan-schema';
import type { ExecContext } from '../types';
import { registerMediaStubForTest } from './helpers/media-stub';
beforeAll(() => registerMediaStubForTest());

function plan(raw: unknown) {
    const v = validatePlan(raw, new Set(['a1']));
    if (!v.ok) throw new Error(v.reason);
    return v.plan;
}
function ctx(extra: Partial<ExecContext> = {}): ExecContext {
    return { lang: 'ko', userMessage: 'q', attachments: new Map(), results: new Map(), ...extra };
}
beforeEach(() => { calls.length = 0; for (const k of Object.keys(behaviors)) delete behaviors[k]; });

it('같은 레벨은 병렬, 다음 레벨은 앞 결과를 본다', async () => {
    const order: string[] = [];
    behaviors.a = async () => { order.push('a-start'); await new Promise((r) => setTimeout(r, 30)); order.push('a-end'); return { ok: true, text: 'A', media: [] }; };
    behaviors.b = async () => { order.push('b-start'); return { ok: true, text: 'B', media: [] }; };
    const p = plan({ complexity: 'multi', tasks: [
        { id: 'a', capability: 'web.search' }, { id: 'b', capability: 'web.search' }, { id: 'c', capability: 'text.code', input: { refs: ['a', 'b'] } },
    ] });
    const s = await executePlan(p, ctx());
    expect(order.slice(0, 2).sort()).toEqual(['a-start', 'b-start']); // b 가 a 종료 전에 시작
    expect(calls[2]).toBe('c');
    expect(s.ok).toBe(3); expect(s.failed).toBe(0);
});

it('실행기가 돌려준 구조화 출처(sources)는 계획 실행 뒤 TaskResult 에 남는다', async () => {
    const sources = [{ title: 't', url: 'https://e.x', snippet: 's' }];
    behaviors.a = async () => ({ ok: true, text: 'A', media: [], sources });
    const s = await executePlan(plan({ complexity: 'multi', tasks: [{ id: 'a', capability: 'web.search' }] }), ctx());
    expect(s.results[0].sources).toEqual(sources);
});

it('실패한 부모의 자식은 skipped(호출 없음), 독립 작업은 계속', async () => {
    behaviors.p = async () => { throw new Error('boom'); };
    const p = plan({ complexity: 'multi', tasks: [
        { id: 'p', capability: 'web.search' }, { id: 'x', capability: 'web.search' }, { id: 'child', capability: 'text.code', depends_on: ['p'] },
    ] });
    const s = await executePlan(p, ctx());
    expect(calls).toEqual(expect.arrayContaining(['p', 'x'])); expect(calls).not.toContain('child');
    const child = s.results.find((r) => r.taskId === 'child')!;
    expect(child.status).toBe('skipped'); expect(s.skipped).toBe(1); expect(s.failed).toBe(1); expect(s.ok).toBe(1);
});

it('선행 미완료 skipped 문구에 작업 번호가 없어 결과 블록에도 실리지 않는다(번호는 error 기록에만)', async () => {
    behaviors.t1 = async () => { throw new Error('boom'); };
    const s = await executePlan(plan({ complexity: 'multi', tasks: [
        { id: 't1', capability: 'web.search' }, { id: 't2', capability: 'text.code', depends_on: ['t1'] },
    ] }), ctx());
    const child = s.results.find((r) => r.taskId === 't2')!;
    expect(child.text).toBe('[skipped] 선행 작업 미완료(failed)');
    expect(child.error).toBe('skipped: t1');
    expect(buildResultBlock(s.results, 'ko').block).not.toMatch(/\bt\d+\b/);
});

it('preflight 가 미리 거절한 작업은 호출 없이 실패, 그 자식도 skipped', async () => {
    const p = plan({ complexity: 'multi', tasks: [{ id: 'g', capability: 'image.generate', input: { instruction: 'x' } }, { id: 'e', capability: 'image.edit', input: { refs: ['g'] } }] });
    const c = ctx();
    c.results.set('g', { taskId: 'g', capability: 'image.generate', ok: false, status: 'failed', text: '[unassigned] 없음', media: [], ms: 0, error: 'unassigned' });
    const s = await executePlan(p, c);
    expect(calls).toEqual([]);
    expect(s.results.map((r) => r.status)).toEqual(['failed', 'skipped']);
});

it('pending(영상 미완료)은 ok=false·status=pending — 자식은 실행되지 않고 성공 집계에서 빠진다', async () => {
    behaviors.v = async () => ({ ok: false, status: 'pending', text: 'in progress', media: [] });
    const p = plan({ complexity: 'multi', tasks: [{ id: 'v', capability: 'video.generate', input: { instruction: 'x' } }, { id: 'd', capability: 'text.reason', depends_on: ['v'] }] });
    const s = await executePlan(p, ctx());
    expect(s.pending).toBe(1); expect(s.ok).toBe(0); expect(s.failed).toBe(0); expect(s.skipped).toBe(1);
    expect(calls).toEqual(['v']);
});

it('실행 중 취소되면 나머지는 skipped·cancelled=true, 취소 후 새 레벨은 시작하지 않는다', async () => {
    const ac = new AbortController();
    behaviors.slow = async () => { await new Promise((r) => setTimeout(r, 20)); ac.abort(); return { ok: true, text: 's', media: [] }; };
    const p = plan({ complexity: 'multi', tasks: [{ id: 'slow', capability: 'web.search' }, { id: 'next', capability: 'text.code', depends_on: ['slow'] }] });
    const s = await executePlan(p, ctx({ signal: ac.signal }));
    expect(s.cancelled).toBe(true);
    expect(calls).toEqual(['slow']);
    expect(s.results.find((r) => r.taskId === 'next')!.status).toBe('skipped');
});

describe('orchestrator_task.model — 작업을 처리한 모델', () => {
    type Ev = { type: string; id?: string; status?: string; model?: string };
    const target = (capability: string, providerId: string, fullId: string, model: string) => ({ capability, fullId, providerId, model } as never);

    it('승인된 실행 대상의 모델을 running·완료 이벤트에 싣는다(로컬 bare id, 외부 fullId)', async () => {
        const events: Ev[] = [];
        const p = plan({ complexity: 'multi', tasks: [
            { id: 'g', capability: 'image.generate', input: { instruction: 'x' } }, { id: 't', capability: 'text.reason' },
        ] });
        const targets = new Map([['g', target('image.generate', 'hasa', 'hasa:flux-2', 'hasa/flux-2')], ['t', target('text.reason', 'local-llm', 'qwen3.8-27b', 'qwen3.8-27b')]]);
        await executePlan(p, ctx({ targets, onProgress: (e) => events.push(e as Ev) }));
        const byTask = (id: string) => events.filter((e) => e.type === 'orchestrator_task' && e.id === id);
        expect(byTask('g').map((e) => [e.status, e.model])).toEqual([['running', 'hasa:flux-2'], ['ok', 'hasa:flux-2']]);
        expect(byTask('t').map((e) => [e.status, e.model])).toEqual([['running', 'qwen3.8-27b'], ['ok', 'qwen3.8-27b']]);
    });

    it('실행 대상이 없는 작업(web.search·거절)은 model 을 생략한다', async () => {
        const events: Ev[] = [];
        behaviors.s = async () => { throw new Error('boom'); };
        const p = plan({ complexity: 'multi', tasks: [{ id: 's', capability: 'web.search' }] });
        await executePlan(p, ctx({ onProgress: (e) => events.push(e as Ev) }));
        expect(events.length).toBeGreaterThan(0);
        expect(events.every((e) => !('model' in e))).toBe(true);
    });
});

describe('실패 TaskResult.model — 실행을 시도한 배정 대상(task_results 기록)', () => {
    const target = (capability: string, providerId: string, fullId: string, model: string) => ({ capability, fullId, providerId, model } as never);

    it('handler 가 throw(타임아웃·403)해도 승인된 대상의 fullId 를 남긴다 — 외부·로컬 모두', async () => {
        behaviors.g = async () => { throw new Error('image.generate: 시간 초과'); };
        behaviors.t = async () => { throw new Error('HTTP 403 security_policy_blocked'); };
        const p = plan({ complexity: 'multi', tasks: [
            { id: 'g', capability: 'image.generate', input: { instruction: 'x' } }, { id: 't', capability: 'text.reason' },
        ] });
        const targets = new Map([['g', target('image.generate', 'hasa', 'hasa:flux-2', 'hasa/flux-2')], ['t', target('text.reason', 'local-llm', 'qwen3.8-27b', 'qwen3.8-27b')]]);
        const s = await executePlan(p, ctx({ targets }));
        const by = (id: string) => s.results.find((r) => r.taskId === id)!;
        expect([by('g').status, by('g').model]).toEqual(['failed', 'hasa:flux-2']);
        expect([by('t').status, by('t').model]).toEqual(['failed', 'qwen3.8-27b']);
    });

    it('runTask 자체가 reject 된 경우(allSettled rejected)도 대상 fullId 를 남긴다', async () => {
        const p = plan({ complexity: 'multi', tasks: [{ id: 'g', capability: 'image.generate', input: { instruction: 'x' } }] });
        const targets = new Map([['g', target('image.generate', 'hasa', 'hasa:flux-2', 'hasa/flux-2')]]);
        const onProgress = (e: { status?: string }) => { if (e.status === 'running') throw new Error('progress sink down'); };
        const s = await executePlan(p, ctx({ targets, onProgress: onProgress as never }));
        expect([s.results[0].status, s.results[0].model]).toEqual(['failed', 'hasa:flux-2']);
    });

    it('타임아웃(TimeoutError)은 [timeout], 사용자 취소(AbortError)는 [cancelled] 로 구분한다', async () => {
        behaviors.g = async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); };
        behaviors.c = async () => { throw new DOMException('This operation was aborted', 'AbortError'); };
        const p = plan({ complexity: 'multi', tasks: [{ id: 'g', capability: 'image.generate', input: { instruction: 'x' } }, { id: 'c', capability: 'web.search' }] });
        const events: Array<{ id?: string; status?: string; reason?: string }> = [];
        const s = await executePlan(p, ctx({ onProgress: (e) => events.push(e as never) }));
        expect(s.results.find((r) => r.taskId === 'g')!.text).toMatch(/^\[timeout\] /);
        expect(s.results.find((r) => r.taskId === 'c')!.text).toMatch(/^\[cancelled\] /);
        // 호출이 시작된 뒤의 시간 초과는 timeout(대기 중 시간 초과 아님)
        expect(events.filter((e) => e.id === 'g' && e.status === 'failed').map((e) => e.reason)).toEqual(['timeout']);
    });

    it('provider 슬롯 대기 중 호출 타임아웃이 만료돼도 [timeout] 이다(사용자 취소 아님)', async () => {
        const { withProviderSlot, providerConcurrency } = jest.requireActual('../../../llm/external-throttle') as typeof import('../../../llm/external-throttle');
        const { callJson } = jest.requireActual('../http-call') as typeof import('../http-call');
        let release!: () => void;
        const held = new Promise<void>((r) => { release = r; });
        const holders = Array.from({ length: providerConcurrency('hasa') }, () => withProviderSlot('hasa', () => held));
        const fetchSpy = jest.spyOn(global, 'fetch');
        const t = { capability: 'image.generate', fullId: 'hasa:Qwen-Image', providerId: 'hasa', model: 'hasa/Qwen-Image', baseUrl: 'http://gw', endpoint: '/v1/images/generations', headers: {}, params: {}, source: 'user', transport: 'gateway' };
        behaviors.g = async () => callJson(t as never, { body: { prompt: 'x' }, timeoutMs: 30 });
        const p = plan({ complexity: 'multi', tasks: [{ id: 'g', capability: 'image.generate', input: { instruction: 'x' } }] });
        const events: Array<{ id?: string; status?: string; reason?: string }> = [];
        try {
            const s = await executePlan(p, ctx({ onProgress: (e) => events.push(e as never) }));
            expect(s.results[0].text).toMatch(/^\[timeout\] /);
            expect(events.filter((e) => e.status === 'failed').map((e) => e.reason)).toEqual(['timeout_queued']);
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            release(); await Promise.all(holders); fetchSpy.mockRestore();
        }
    });

    it('전역 동시 실행 Gate 대기 중 작업 타임아웃이 만료돼도 [timeout] 이다', async () => {
        const saved = { g: process.env.ORCHESTRATOR_GLOBAL_MAX_INFLIGHT, t: process.env.ORCHESTRATOR_TASK_TIMEOUT_MS };
        process.env.ORCHESTRATOR_GLOBAL_MAX_INFLIGHT = '1'; process.env.ORCHESTRATOR_TASK_TIMEOUT_MS = '30';
        try {
            await jest.isolateModulesAsync(async () => {
                const { executePlan: run } = await import('../executor');
                behaviors.a = async () => { await new Promise((r) => setTimeout(r, 100)); return { ok: true, text: 'A', media: [] }; };
                const p = plan({ complexity: 'multi', tasks: [{ id: 'a', capability: 'web.search' }, { id: 'b', capability: 'web.search' }] });
                const events: Array<{ id?: string; status?: string; reason?: string }> = [];
                const s = await run(p, ctx({ onProgress: (e) => events.push(e as never) }));
                expect(s.results.find((r) => r.taskId === 'b')!.text).toMatch(/^\[timeout\] /);
                expect(events.filter((e) => e.id === 'b' && e.status === 'failed').map((e) => e.reason)).toEqual(['timeout_queued']);
                expect(calls).toEqual(['a']);
            });
        } finally {
            for (const [k, v] of [['ORCHESTRATOR_GLOBAL_MAX_INFLIGHT', saved.g], ['ORCHESTRATOR_TASK_TIMEOUT_MS', saved.t]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
        }
    });

    it('호출하지 않은 작업(preflight 거절·선행 실패 skipped)은 model 을 비운다', async () => {
        behaviors.p = async () => { throw new Error('boom'); };
        const p = plan({ complexity: 'multi', tasks: [
            { id: 'p', capability: 'text.reason' }, { id: 'child', capability: 'text.code', depends_on: ['p'] }, { id: 'r', capability: 'image.generate', input: { instruction: 'x' } },
        ] });
        const targets = new Map([['p', target('text.reason', 'hasa', 'hasa:gpt-oss-120b', 'gpt-oss-120b')], ['child', target('text.code', 'hasa', 'hasa:gpt-oss-120b', 'gpt-oss-120b')]]);
        const c = ctx({ targets });
        c.results.set('r', { taskId: 'r', capability: 'image.generate', ok: false, status: 'failed', text: '[unassigned] 없음', media: [], ms: 0, error: 'unassigned' });
        const s = await executePlan(p, c);
        const by = (id: string) => s.results.find((r) => r.taskId === id)!;
        expect(by('p').model).toBe('hasa:gpt-oss-120b');
        expect([by('child').status, by('child').model]).toEqual(['skipped', undefined]);
        expect(by('r').model).toBeUndefined();
    });
});

describe('orchestrator_task 실패 이벤트 reason·provider — 화면이 실패 종류를 안다', () => {
    type Ev = { type: string; id?: string; status?: string; reason?: string; provider?: string; summary?: string };
    const target = (capability: string, providerId: string, fullId: string, model: string) => ({ capability, fullId, providerId, model } as never);
    const failedOf = (events: Ev[], id: string) => events.filter((e) => e.type === 'orchestrator_task' && e.id === id && e.status === 'failed');
    async function withEnv(env: Record<string, string>, fn: (run: typeof executePlan) => Promise<void>) {
        const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
        Object.assign(process.env, env);
        try {
            await jest.isolateModulesAsync(async () => { const { executePlan: run } = await import('../executor'); await fn(run); });
        } finally {
            for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
        }
    }

    it('handler throw 는 classify 의 kind, 외부 대상이면 provider 를 싣는다(로컬·대상 없음은 생략)', async () => {
        const events: Ev[] = [];
        behaviors.g = async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); };
        behaviors.t = async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); };
        behaviors.c = async () => { throw new DOMException('This operation was aborted', 'AbortError'); };
        const p = plan({ complexity: 'multi', tasks: [
            { id: 'g', capability: 'image.generate', input: { instruction: 'x' } }, { id: 't', capability: 'text.reason' }, { id: 'c', capability: 'web.search' },
        ] });
        const targets = new Map([['g', target('image.generate', 'ext', 'ext:img-1', 'img-1')], ['t', target('text.reason', 'local-llm', 'local-1', 'local-1')]]);
        await executePlan(p, ctx({ targets, onProgress: (e) => events.push(e as Ev) }));
        expect(failedOf(events, 'g').map((e) => [e.reason, e.provider])).toEqual([['timeout', 'ext']]);
        expect(failedOf(events, 't').map((e) => [e.reason, 'provider' in e])).toEqual([['timeout', false]]);
        expect(failedOf(events, 'c').map((e) => [e.reason, 'provider' in e])).toEqual([['cancelled', false]]);
        // summary 는 원문 그대로(하위 호환)
        expect(failedOf(events, 'g')[0].summary).toContain('The operation was aborted due to timeout');
    });

    it('handler 가 ok:false 를 반환하면 reason=failed', async () => {
        const events: Ev[] = [];
        behaviors.a = async () => ({ ok: false, text: 'no', media: [] });
        const p = plan({ complexity: 'multi', tasks: [{ id: 'a', capability: 'web.search' }] });
        await executePlan(p, ctx({ onProgress: (e) => events.push(e as Ev) }));
        expect(failedOf(events, 'a').map((e) => e.reason)).toEqual(['failed']);
    });

    it('preflight 거절은 결과 text 맨 앞 [label], 형식이 아니면 failed', async () => {
        const events: Ev[] = [];
        const p = plan({ complexity: 'multi', tasks: [{ id: 'u', capability: 'image.generate', input: { instruction: 'x' } }, { id: 'v', capability: 'web.search' }] });
        const c = ctx({ onProgress: (e) => events.push(e as Ev) });
        c.results.set('u', { taskId: 'u', capability: 'image.generate', ok: false, status: 'failed', text: '[unassigned] 없음', media: [], ms: 0, error: 'unassigned' });
        c.results.set('v', { taskId: 'v', capability: 'web.search', ok: false, status: 'failed', text: '형식 없음', media: [], ms: 0, error: 'x' });
        await executePlan(p, c);
        expect(failedOf(events, 'u').map((e) => [e.reason, e.summary])).toEqual([['unassigned', '[unassigned] 없음']]);
        expect(failedOf(events, 'v').map((e) => e.reason)).toEqual(['failed']);
    });

    it('선행 작업 미완료는 reason=skipped', async () => {
        const events: Ev[] = [];
        behaviors.p = async () => { throw new Error('boom'); };
        const p = plan({ complexity: 'multi', tasks: [{ id: 'p', capability: 'web.search' }, { id: 'child', capability: 'text.code', depends_on: ['p'] }] });
        await executePlan(p, ctx({ onProgress: (e) => events.push(e as Ev) }));
        expect(failedOf(events, 'p').map((e) => e.reason)).toEqual(['failed']);
        expect(failedOf(events, 'child').map((e) => e.reason)).toEqual(['skipped']);
    });

    it('성공·running 이벤트에는 reason·provider 가 없다', async () => {
        const events: Ev[] = [];
        const p = plan({ complexity: 'multi', tasks: [{ id: 'g', capability: 'image.generate', input: { instruction: 'x' } }] });
        const targets = new Map([['g', target('image.generate', 'ext', 'ext:img-1', 'img-1')]]);
        await executePlan(p, ctx({ targets, onProgress: (e) => events.push(e as Ev) }));
        const tasks = events.filter((e) => e.type === 'orchestrator_task');
        expect(tasks.map((e) => e.status)).toEqual(['running', 'ok']);
        expect(tasks.every((e) => !('reason' in e) && !('provider' in e))).toBe(true);
    });

    it('작업 시간 제한으로 끊긴 대기가 Error(취소됨) 을 던져도 timeout 으로 보정한다', async () => {
        await withEnv({ ORCHESTRATOR_TASK_TIMEOUT_MS: '30' }, async (run) => {
            const events: Ev[] = [];
            behaviors.v = (signal) => new Promise((_, reject) => signal!.addEventListener('abort', () => reject(new Error('취소됨')), { once: true }));
            const p = plan({ complexity: 'multi', tasks: [{ id: 'v', capability: 'web.search' }] });
            const s = await run(p, ctx({ onProgress: (e) => events.push(e as Ev) }));
            expect(s.results[0].text).toMatch(/^\[timeout\] /);
            expect(s.results[0].text).not.toContain('취소됨');
            expect(failedOf(events, 'v').map((e) => e.reason)).toEqual(['timeout']);
            expect(failedOf(events, 'v')[0].summary).not.toContain('취소됨');
        });
    });

    it('사용자 취소로 Error(취소됨) 이 나면 그대로 cancelled', async () => {
        const events: Ev[] = [];
        const ac = new AbortController();
        behaviors.v = (signal) => new Promise((_, reject) => { signal!.addEventListener('abort', () => reject(new Error('취소됨')), { once: true }); setTimeout(() => ac.abort(), 10); });
        const p = plan({ complexity: 'multi', tasks: [{ id: 'v', capability: 'web.search' }] });
        const s = await executePlan(p, ctx({ signal: ac.signal, onProgress: (e) => events.push(e as Ev) }));
        expect(s.results[0].text).toMatch(/^\[cancelled\] /);
        expect(failedOf(events, 'v').map((e) => e.reason)).toEqual(['cancelled']);
    });

    it('턴 시간 초과로 시작 못 한 작업은 reason=deadline 실패 이벤트(summary=결과 text)', async () => {
        await withEnv({ ORCHESTRATOR_TURN_DEADLINE_MS: '30' }, async (run) => {
            const events: Ev[] = [];
            behaviors.a = async () => { await new Promise((r) => setTimeout(r, 60)); return { ok: true, text: 'A', media: [] }; };
            const p = plan({ complexity: 'multi', tasks: [{ id: 'a', capability: 'web.search' }, { id: 'n', capability: 'text.code', depends_on: ['a'] }] });
            const s = await run(p, ctx({ onProgress: (e) => events.push(e as Ev) }));
            expect(s.cancelled).toBe(false);
            expect(calls).toEqual(['a']);
            expect(failedOf(events, 'n').map((e) => [e.reason, e.summary])).toEqual([['deadline', '[skipped] 턴 시간 초과']]);
        });
    });

    it('취소로 시작 못 한 작업은 이벤트를 내지 않는다', async () => {
        const events: Ev[] = [];
        const ac = new AbortController();
        behaviors.slow = async () => { await new Promise((r) => setTimeout(r, 20)); ac.abort(); return { ok: true, text: 's', media: [] }; };
        const p = plan({ complexity: 'multi', tasks: [{ id: 'slow', capability: 'web.search' }, { id: 'next', capability: 'text.code', depends_on: ['slow'] }] });
        await executePlan(p, ctx({ signal: ac.signal, onProgress: (e) => events.push(e as Ev) }));
        expect(events.filter((e) => e.type === 'orchestrator_task' && e.id === 'next')).toEqual([]);
    });
});

describe('작업 실패 사유 세분 — 연결 실패·서비스 오류·대기 중 시간 초과', () => {
    type Ev = { type: string; id?: string; status?: string; reason?: string };
    const failedReason = (events: Ev[], id: string) => events.filter((e) => e.type === 'orchestrator_task' && e.id === id && e.status === 'failed').map((e) => e.reason);
    const hasaTarget = { capability: 'image.generate', fullId: 'hasa:Qwen-Image', providerId: 'hasa', model: 'hasa/Qwen-Image', baseUrl: 'http://127.0.0.1:9', endpoint: '/v1/images/generations', headers: {}, params: {}, source: 'user', transport: 'gateway' };
    /** fetch 대역 — 신호가 중단되면 그 사유로 reject(응답 없음) */
    const hangingFetch = (_u: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    });
    /** 작업 신호가 중단될 때까지 붙잡는 handler */
    const holdUntilAbort = (signal?: AbortSignal) => new Promise<never>((_, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }));
    /**
     * AbortSignal.timeout 대역 — 실제 타이머 대신 테스트가 끊는 신호(만료 순서를 테스트가 정한다).
     * 만든 순서대로 쌓고, expire(ms, n) 은 그 ms 로 n 번째 만든 신호를 시간 초과 사유로 끊는다. 끝나면 restore.
     */
    function heldTimeouts() {
        const made: Array<{ ms: number; ac: AbortController }> = [];
        const spy = jest.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
            const ac = new AbortController();
            made.push({ ms, ac });
            return ac.signal;
        });
        const expire = (ms: number, nth = 0) => {
            const hit = made.filter((m) => m.ms === ms)[nth];
            if (!hit) throw new Error(`AbortSignal.timeout(${ms}) #${nth} 가 만들어지지 않았다`);
            hit.ac.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
        };
        return { expire, restore: () => spy.mockRestore() };
    }
    /** setImmediate 를 n 번 넘긴다(양보 포함 진행) */
    const ticks = async (n = 2) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
    /** 마이크로태스크만 비운다 — setImmediate 양보는 아직 돌지 않는다 */
    const microtasks = async (n = 50) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
    async function isolated(env: Record<string, string>, fn: (m: {
        run: typeof executePlan;
        http: typeof import('../http-call');
        throttle: typeof import('../../../llm/external-throttle');
    }) => Promise<void>) {
        const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
        Object.assign(process.env, env);
        try {
            // executor·http-call·external-throttle 을 같은 격리 안에서 가져온다 — QueueTimeoutError 클래스가 같아야 instanceof 가 맞는다
            await jest.isolateModulesAsync(async () => {
                const { executePlan: run } = await import('../executor');
                const http = await import('../http-call');
                const throttle = await import('../../../llm/external-throttle');
                await fn({ run, http, throttle });
            });
        } finally {
            for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
        }
    }

    it('fetch 연결 실패(cause.code=ECONNREFUSED) → unreachable, text 는 [failed]', async () => {
        const events: Ev[] = [];
        behaviors.a = async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9'), { code: 'ECONNREFUSED' }) }); };
        behaviors.b = async () => { throw Object.assign(new Error('request aborted'), { code: 'ENOTFOUND' }); };
        behaviors.c = async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) }); };
        const p = plan({ complexity: 'multi', tasks: [{ id: 'a', capability: 'web.search' }, { id: 'b', capability: 'web.search' }, { id: 'c', capability: 'web.search' }] });
        const s = await executePlan(p, ctx({ onProgress: (e) => events.push(e as Ev) }));
        expect(failedReason(events, 'a')).toEqual(['unreachable']);
        expect(s.results.find((r) => r.taskId === 'a')!.text).toMatch(/^\[failed\] /);
        // 자체 code 도 본다 · message 에 aborted 가 있어도 연결 실패 코드가 먼저다
        expect(failedReason(events, 'b')).toEqual(['unreachable']);
        // 응답 도중에도 나는 코드는 집합에 없다 → failed
        expect(failedReason(events, 'c')).toEqual(['failed']);
    });

    it('HttpCallError 5xx → upstream, 4xx·키 거절(5xx 포함) → failed, 사용자 취소 → cancelled', async () => {
        const events: Ev[] = [];
        behaviors.u = async () => { throw new HttpCallError('HTTP 500 {"error":{"message":"Cannot connect to host"}}', 500); };
        behaviors.d = async () => { throw new HttpCallError('다운로드 실패 (HTTP 502): http://127.0.0.1:9/x', 502); };
        behaviors.q = async () => { throw new HttpCallError('HTTP 400 bad request', 400); };
        behaviors.k = async () => { throw new HttpCallError('HTTP 401 키 거절', 401, 'http', true); };
        behaviors.k5 = async () => { throw new HttpCallError('HTTP 500 키 거절', 500, 'http', true); };
        behaviors.x = async () => { throw new DOMException('This operation was aborted', 'AbortError'); };
        const ids = ['u', 'd', 'q', 'k', 'k5', 'x'];
        const p = plan({ complexity: 'multi', tasks: ids.slice(0, 4).map((id) => ({ id, capability: 'web.search' })) });
        const p2 = plan({ complexity: 'multi', tasks: ids.slice(4).map((id) => ({ id, capability: 'web.search' })) });
        const s = await executePlan(p, ctx({ onProgress: (e) => events.push(e as Ev) }));
        await executePlan(p2, ctx({ onProgress: (e) => events.push(e as Ev) }));
        expect(ids.map((id) => [id, failedReason(events, id)[0]])).toEqual([
            ['u', 'upstream'], ['d', 'upstream'], ['q', 'failed'], ['k', 'failed'], ['k5', 'failed'], ['x', 'cancelled'],
        ]);
        expect(s.results.find((r) => r.taskId === 'u')!.text).toMatch(/^\[failed\] HTTP 500 /);
    });

    it('같은 시각 만료(Gate 한도 1): 잡은 작업은 timeout, 기다리던 작업은 timeout_queued 이고 handler 를 부르지 않는다', async () => {
        await isolated({ ORCHESTRATOR_GLOBAL_MAX_INFLIGHT: '1', ORCHESTRATOR_TASK_TIMEOUT_MS: '30' }, async ({ run }) => {
            const t = heldTimeouts();
            try {
                const events: Ev[] = [];
                behaviors.a = holdUntilAbort;
                const p = plan({ complexity: 'multi', tasks: [{ id: 'a', capability: 'web.search' }, { id: 'b', capability: 'web.search' }] });
                const done = run(p, ctx({ onProgress: (e) => events.push(e as Ev) }));
                await ticks(3); // a 는 handler 안, b 는 Gate 대기
                t.expire(30, 0); // a 만료 → Gate 반환 → b 깨어나 양보 중
                await microtasks();
                t.expire(30, 1); // 양보가 끝나기 전에 b 만료
                await ticks();
                const s = await done;
                expect(failedReason(events, 'a')).toEqual(['timeout']);
                expect(failedReason(events, 'b')).toEqual(['timeout_queued']);
                expect(s.results.map((r) => r.text.slice(0, 9))).toEqual(['[timeout]', '[timeout]']);
                expect(calls).toEqual(['a']);
            } finally { t.restore(); }
        });
    });

    it('같은 시각 만료(provider 동시성 1): 기다리던 호출은 timeout_queued, fetch 는 잡은 작업의 1회뿐', async () => {
        await isolated({}, async ({ run, http, throttle }) => {
            const t = heldTimeouts();
            let release!: () => void;
            const held = new Promise<void>((r) => { release = r; });
            const holders = Array.from({ length: throttle.providerConcurrency('hasa') - 1 }, () => throttle.withProviderSlot('hasa', () => held));
            const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(hangingFetch as typeof fetch);
            const events: Ev[] = [];
            // 호출 시간 제한 값으로 a·b 의 신호를 구분한다
            behaviors.a = async () => http.callJson(hasaTarget as never, { body: { prompt: 'a' }, timeoutMs: 31 });
            behaviors.b = async () => http.callJson(hasaTarget as never, { body: { prompt: 'b' }, timeoutMs: 32 });
            const p = plan({ complexity: 'multi', tasks: [{ id: 'a', capability: 'image.generate', input: { instruction: 'x' } }, { id: 'b', capability: 'image.generate', input: { instruction: 'y' } }] });
            try {
                const done = run(p, ctx({ onProgress: (e) => events.push(e as Ev) }));
                await ticks(3); // a 는 마지막 슬롯으로 fetch 중, b 는 슬롯 대기
                expect(fetchSpy).toHaveBeenCalledTimes(1);
                t.expire(31); // a 만료 → 슬롯 반환 → b 깨어나 양보 중
                await microtasks();
                t.expire(32); // 양보가 끝나기 전에 b 만료
                await ticks();
                await done;
                expect(failedReason(events, 'a')).toEqual(['timeout']);
                expect(failedReason(events, 'b')).toEqual(['timeout_queued']);
                expect(fetchSpy).toHaveBeenCalledTimes(1);
            } finally {
                release(); await Promise.all(holders); fetchSpy.mockRestore(); t.restore();
            }
        });
    });

    it('Gate 인계: 깨어난 대기자가 중단으로 빠지면 시간 제한이 더 긴 다음 대기자가 곧바로 Gate 를 얻는다', async () => {
        await isolated({ ORCHESTRATOR_GLOBAL_MAX_INFLIGHT: '1', ORCHESTRATOR_TASK_TIMEOUT_MS: '60' }, async ({ run }) => {
            const t = heldTimeouts();
            try {
                const events: Ev[] = [];
                behaviors.a = holdUntilAbort;
                const first = run(plan({ complexity: 'multi', tasks: [{ id: 'a', capability: 'web.search' }, { id: 'b', capability: 'web.search' }] }), ctx({ onProgress: (e) => events.push(e as Ev) }));
                await ticks(3);
                // 뒤 대기자 c — 작업 시간 제한을 끊지 않는다(시간 여유에 기대지 않음)
                const second = run(plan({ complexity: 'multi', tasks: [{ id: 'c', capability: 'web.search' }] }), ctx({ onProgress: (e) => events.push(e as Ev) }));
                await ticks(3); // a 는 handler 안, b·c 는 Gate 대기
                t.expire(60, 0); // a 만료 → b 깨어나 양보 중
                await microtasks();
                t.expire(60, 1); // 양보가 끝나기 전에 b 만료 → 차례를 c 에게
                await ticks();
                const [, s2] = await Promise.all([first, second]);
                expect(failedReason(events, 'b')).toEqual(['timeout_queued']);
                expect(s2.results[0].status).toBe('completed');
                expect(calls).toEqual(['a', 'c']);
            } finally { t.restore(); }
        });
    });

    it('들어올 때 이미 중단된 신호로 호출하면 timeout(queued 아님), fetch 0회', async () => {
        await isolated({ ORCHESTRATOR_TASK_TIMEOUT_MS: '30' }, async ({ run, http }) => {
            const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(hangingFetch as typeof fetch);
            const events: Ev[] = [];
            behaviors.g = async (signal) => {
                await new Promise((r) => signal!.addEventListener('abort', r, { once: true }));
                return http.callJson(hasaTarget as never, { body: { prompt: 'x' }, timeoutMs: 1000, signal });
            };
            try {
                const s = await run(plan({ complexity: 'multi', tasks: [{ id: 'g', capability: 'image.generate', input: { instruction: 'x' } }] }), ctx({ onProgress: (e) => events.push(e as Ev) }));
                expect(s.results[0].text).toMatch(/^\[timeout\] /);
                expect(failedReason(events, 'g')).toEqual(['timeout']);
                expect(fetchSpy).not.toHaveBeenCalled();
            } finally { fetchSpy.mockRestore(); }
        });
    });

    it('슬롯이 비어 있고 fetch 가 응답 없이 호출 시간 제한에 걸리면 timeout, fetch 1회', async () => {
        await isolated({}, async ({ run, http }) => {
            const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(hangingFetch as typeof fetch);
            const events: Ev[] = [];
            behaviors.g = async () => http.callJson(hasaTarget as never, { body: { prompt: 'x' }, timeoutMs: 30 });
            try {
                const s = await run(plan({ complexity: 'multi', tasks: [{ id: 'g', capability: 'image.generate', input: { instruction: 'x' } }] }), ctx({ onProgress: (e) => events.push(e as Ev) }));
                expect(s.results[0].text).toMatch(/^\[timeout\] /);
                expect(failedReason(events, 'g')).toEqual(['timeout']);
                expect(fetchSpy).toHaveBeenCalledTimes(1);
            } finally { fetchSpy.mockRestore(); }
        });
    });

    it('다중 호출: 첫 호출이 성공한 뒤 둘째 호출이 슬롯 대기 중 만료되면 timeout_queued', async () => {
        await isolated({}, async ({ run, http, throttle }) => {
            let release!: () => void;
            const held = new Promise<void>((r) => { release = r; });
            const holders: Array<Promise<void>> = [];
            const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ id: 'job-1' }), { status: 200 }));
            const events: Ev[] = [];
            behaviors.v = async () => {
                await http.callJson(hasaTarget as never, { body: { prompt: 'x' }, timeoutMs: 1000 });
                for (let i = 0; i < throttle.providerConcurrency('hasa'); i++) holders.push(throttle.withProviderSlot('hasa', () => held));
                return http.callJson(hasaTarget as never, { method: 'GET', url: 'http://127.0.0.1:9/v1/jobs/job-1', timeoutMs: 30 });
            };
            try {
                await run(plan({ complexity: 'multi', tasks: [{ id: 'v', capability: 'image.generate', input: { instruction: 'x' } }] }), ctx({ onProgress: (e) => events.push(e as Ev) }));
                expect(failedReason(events, 'v')).toEqual(['timeout_queued']);
                expect(fetchSpy).toHaveBeenCalledTimes(1);
            } finally {
                release(); await Promise.all(holders); fetchSpy.mockRestore();
            }
        });
    });
});
