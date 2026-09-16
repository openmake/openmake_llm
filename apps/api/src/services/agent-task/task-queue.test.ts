import { AgentTaskQueue, resolveQueuePriority } from './task-queue';

/** 수동 해소 가능한 지연 thunk — start 로 실행 추적, resolve 로 완료 시뮬레이션. */
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
}

describe('AgentTaskQueue', () => {
    it('전역 상한 내에서는 즉시 실행(started)', () => {
        const q = new AgentTaskQueue(2, 2);
        const a = deferred();
        const b = deferred();
        expect(q.submit({ taskId: 't1', userId: 'u1', run: () => a.promise })).toBe('started');
        expect(q.submit({ taskId: 't2', userId: 'u2', run: () => b.promise })).toBe('started');
        expect(q.stats()).toMatchObject({ globalActive: 2, pending: 0 });
    });

    it('전역 상한 초과 시 queued', () => {
        const q = new AgentTaskQueue(1, 5);
        const a = deferred();
        expect(q.submit({ taskId: 't1', userId: 'u1', run: () => a.promise })).toBe('started');
        expect(q.submit({ taskId: 't2', userId: 'u1', run: () => deferred().promise })).toBe('queued');
        expect(q.stats()).toMatchObject({ globalActive: 1, pending: 1 });
    });

    it('유저 상한 초과 시 queued(전역 여유 있어도)', () => {
        const q = new AgentTaskQueue(5, 1);
        const a = deferred();
        expect(q.submit({ taskId: 't1', userId: 'u1', run: () => a.promise })).toBe('started');
        expect(q.submit({ taskId: 't2', userId: 'u1', run: () => deferred().promise })).toBe('queued');
        // 다른 유저는 여전히 실행 가능
        expect(q.submit({ taskId: 't3', userId: 'u2', run: () => deferred().promise })).toBe('started');
    });

    it('완료 시 대기열에서 dequeue', async () => {
        const q = new AgentTaskQueue(1, 5);
        const a = deferred();
        let bStarted = false;
        const b = deferred();
        q.submit({ taskId: 't1', userId: 'u1', run: () => a.promise });
        q.submit({ taskId: 't2', userId: 'u1', run: () => { bStarted = true; return b.promise; } });
        expect(bStarted).toBe(false);
        a.resolve(); // t1 완료 → drain → t2 시작
        await Promise.resolve(); await Promise.resolve();
        expect(bStarted).toBe(true);
        expect(q.stats()).toMatchObject({ globalActive: 1, pending: 0 });
    });

    it('유저 상한이 dequeue 를 막고, 슬롯 여유는 다른 유저에게 감', async () => {
        const q = new AgentTaskQueue(2, 1);
        const u1a = deferred();
        q.submit({ taskId: 't1', userId: 'u1', run: () => u1a.promise });       // u1 실행
        const q2 = q.submit({ taskId: 't2', userId: 'u1', run: () => deferred().promise }); // u1 상한 → queued
        let u2Started = false;
        q.submit({ taskId: 't3', userId: 'u2', run: () => { u2Started = true; return deferred().promise; } }); // u2 실행
        expect(q2).toBe('queued');
        expect(u2Started).toBe(true);
    });

    it('cancelPending 은 대기 항목만 제거', () => {
        const q = new AgentTaskQueue(1, 5);
        q.submit({ taskId: 't1', userId: 'u1', run: () => deferred().promise });      // started
        q.submit({ taskId: 't2', userId: 'u1', run: () => deferred().promise });      // queued
        expect(q.cancelPending('t2')).toBe(true);
        expect(q.cancelPending('t1')).toBe(false); // 실행 중은 제거 대상 아님
        expect(q.stats()).toMatchObject({ globalActive: 1, pending: 0 });
    });

    it('우선순위(131): 슬롯이 비면 높은 순위부터, 같은 순위는 등록순', async () => {
        const q = new AgentTaskQueue(1, 5);
        const first = deferred();
        const order: string[] = [];
        const job = (id: string) => () => { order.push(id); return new Promise<void>((r) => setImmediate(r)); };
        q.submit({ taskId: 't0', userId: 'u0', run: () => first.promise });
        q.submit({ taskId: 'low', userId: 'u1', priority: -1, run: job('low') });
        q.submit({ taskId: 'mid1', userId: 'u2', run: job('mid1') });
        q.submit({ taskId: 'high', userId: 'u3', priority: 5, run: job('high') });
        q.submit({ taskId: 'mid2', userId: 'u4', priority: 0, run: job('mid2') });
        expect(q.stats().byPriority).toEqual({ '-1': 1, '0': 2, '5': 1 });
        first.resolve();
        for (let i = 0; i < 20 && order.length < 4; i++) await new Promise((r) => setImmediate(r));
        expect(order).toEqual(['high', 'mid1', 'mid2', 'low']);
    });

    it('우선순위(131): 높은 순위라도 유저 상한에 걸리면 건너뛰고 다음 후보가 실행된다', () => {
        const q = new AgentTaskQueue(2, 1);
        q.submit({ taskId: 't1', userId: 'u1', run: () => deferred().promise });
        const blocked = q.submit({ taskId: 'hi', userId: 'u1', priority: 9, run: () => deferred().promise });
        let otherStarted = false;
        q.submit({ taskId: 'lo', userId: 'u2', priority: -1, run: () => { otherStarted = true; return deferred().promise; } });
        expect(blocked).toBe('queued');
        expect(otherStarted).toBe(true);
    });
});

describe('resolveQueuePriority', () => {
    it('관리자는 [-1, 상한], 그 외는 [-1, 0], 정수가 아니면 0', () => {
        expect(resolveQueuePriority(7, true, 10)).toBe(7);
        expect(resolveQueuePriority(99, true, 10)).toBe(10);
        expect(resolveQueuePriority(7, false, 10)).toBe(0);
        expect(resolveQueuePriority(-5, false, 10)).toBe(-1);
        expect(resolveQueuePriority(-1, false, 10)).toBe(-1);
        expect(resolveQueuePriority(undefined, true, 10)).toBe(0);
        expect(resolveQueuePriority(1.5, true, 10)).toBe(0);
    });
});
