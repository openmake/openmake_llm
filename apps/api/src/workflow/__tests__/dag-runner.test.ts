import { runDag, topoLevels, DagCycleError, type DagNode } from '../dag-runner';

type N = DagNode & { ms?: number; fail?: boolean };
type R = { id: string; ok: boolean; how?: string };
const n = (id: string, dependsOn: string[] = [], extra: Partial<N> = {}): N => ({ id, dependsOn, ...extra });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function opts(nodes: N[], over: Partial<Parameters<typeof runDag<N, R>>[0]> = {}) {
    const started: string[] = [];
    return {
        started,
        o: {
            nodes,
            run: async (x: N) => { started.push(x.id); await sleep(x.ms ?? 0); return { id: x.id, ok: !x.fail } as R; },
            isOk: (r: R) => r.ok,
            onBlocked: (x: N, by: string) => ({ id: x.id, ok: false, how: `blocked:${by}` }),
            onRejected: (x: N) => ({ id: x.id, ok: false, how: 'rejected' }),
            onUnreached: (x: N) => ({ id: x.id, ok: false, how: 'unreached' }),
            ...over,
        },
    };
}

describe('topoLevels', () => {
    it('깊이별 레벨, 선언 순 유지', () => {
        expect(topoLevels([n('c', ['a', 'b']), n('a'), n('b', ['a'])]).map((l) => l.map((x) => x.id))).toEqual([['a'], ['b'], ['c']]);
    });
    it('순환·모르는 선행은 DagCycleError', () => {
        expect(() => topoLevels([n('a', ['b']), n('b', ['a'])])).toThrow(DagCycleError);
        expect(() => topoLevels([n('a', ['zz'])])).toThrow(DagCycleError);
    });
});

describe.each(['levels', 'eager'] as const)('runDag(%s)', (mode) => {
    it('실패는 하위로 전파(실행 없음), 독립 작업은 계속', async () => {
        const { o, started } = opts([n('a', [], { fail: true }), n('b', ['a']), n('c'), n('e', ['b'])], { mode });
        const r = await runDag(o);
        const by = Object.fromEntries(r.settled.map((s) => [s.node.id, s.result]));
        expect(by.a.ok).toBe(false);
        expect(by.b.how).toBe('blocked:a');
        expect(by.e.how).toBe('blocked:b');
        expect(by.c.ok).toBe(true);
        expect(started).not.toContain('b');
        expect(r.interrupted).toBe(false);
    });

    it('run 이 throw 하면 onRejected', async () => {
        const { o } = opts([n('a'), n('b', ['a'])], { mode, run: async (x: N) => { if (x.id === 'a') throw new Error('x'); return { id: x.id, ok: true } as R; } });
        const r = await runDag(o);
        expect(r.settled.map((s) => s.result.how)).toEqual(['rejected', 'blocked:a']);
    });

    it('사전 확정 노드는 실행하지 않고 결과를 쓴다', async () => {
        const { o, started } = opts([n('a'), n('b', ['a'])], { mode, presettled: (x: N) => (x.id === 'a' ? { id: 'a', ok: false, how: 'pre' } : undefined) });
        const r = await runDag(o);
        expect(started).toEqual([]);
        expect(r.settled.map((s) => s.result.how)).toEqual(['pre', 'blocked:a']);
    });

    it('중단되면 새 노드를 시작하지 않고 남은 노드를 미도달로 채운다', async () => {
        const ac = new AbortController();
        const { o, started } = opts([n('a', [], { ms: 20 }), n('b', ['a'])], { mode, signal: ac.signal });
        setTimeout(() => ac.abort(), 5);
        const r = await runDag(o);
        expect(started).toEqual(['a']);
        expect(r.settled.find((s) => s.node.id === 'b')?.result.how).toBe('unreached');
        expect(r.interrupted).toBe(true);
    });

    it('동시 실행 상한', async () => {
        let live = 0; let peak = 0;
        const { o } = opts([n('a', [], { ms: 10 }), n('b', [], { ms: 10 }), n('c', [], { ms: 10 })], {
            mode, maxParallel: 2,
            run: async (x: N) => { live++; peak = Math.max(peak, live); await sleep(x.ms ?? 0); live--; return { id: x.id, ok: true } as R; },
        });
        await runDag(o);
        expect(peak).toBe(2);
    });
});

describe('runDag — eager 는 레벨 장벽이 없다', () => {
    it('긴 형제(a)를 기다리지 않고 짧은 형제(b)의 자식(c)이 먼저 시작한다', async () => {
        const nodes = [n('a', [], { ms: 40 }), n('b', [], { ms: 5 }), n('c', ['b'], { ms: 5 })];
        const lv = opts(nodes, { mode: 'levels' }); await runDag(lv.o);
        const eg = opts(nodes, { mode: 'eager' }); const r = await runDag(eg.o);
        expect(lv.started).toEqual(['a', 'b', 'c']);
        // eager: c 가 a 보다 먼저 끝난다
        const order = r.settled.map((s) => s.node.id);
        expect(order.indexOf('c')).toBeLessThan(order.indexOf('a'));
    });
});
