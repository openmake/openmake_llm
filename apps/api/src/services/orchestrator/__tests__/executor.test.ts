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
import { validatePlan } from '../plan-schema';
import type { ExecContext } from '../types';

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
        { id: 'a', capability: 'web.search' }, { id: 'b', capability: 'web.search' }, { id: 'c', capability: 'text.reason', input: { refs: ['a', 'b'] } },
    ] });
    const s = await executePlan(p, ctx());
    expect(order.slice(0, 2).sort()).toEqual(['a-start', 'b-start']); // b 가 a 종료 전에 시작
    expect(calls[2]).toBe('c');
    expect(s.ok).toBe(3); expect(s.failed).toBe(0);
});

it('실패한 부모의 자식은 skipped(호출 없음), 독립 작업은 계속', async () => {
    behaviors.p = async () => { throw new Error('boom'); };
    const p = plan({ complexity: 'multi', tasks: [
        { id: 'p', capability: 'web.search' }, { id: 'x', capability: 'web.search' }, { id: 'child', capability: 'text.reason', depends_on: ['p'] },
    ] });
    const s = await executePlan(p, ctx());
    expect(calls).toEqual(expect.arrayContaining(['p', 'x'])); expect(calls).not.toContain('child');
    const child = s.results.find((r) => r.taskId === 'child')!;
    expect(child.status).toBe('skipped'); expect(s.skipped).toBe(1); expect(s.failed).toBe(1); expect(s.ok).toBe(1);
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
    const p = plan({ complexity: 'multi', tasks: [{ id: 'slow', capability: 'web.search' }, { id: 'next', capability: 'text.reason', depends_on: ['slow'] }] });
    const s = await executePlan(p, ctx({ signal: ac.signal }));
    expect(s.cancelled).toBe(true);
    expect(calls).toEqual(['slow']);
    expect(s.results.find((r) => r.taskId === 'next')!.status).toBe('skipped');
});
