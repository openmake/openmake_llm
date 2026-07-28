import { AgentTaskQueue } from './task-queue';

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
        expect(q.stats()).toEqual({ globalActive: 2, pending: 0 });
    });

    it('전역 상한 초과 시 queued', () => {
        const q = new AgentTaskQueue(1, 5);
        const a = deferred();
        expect(q.submit({ taskId: 't1', userId: 'u1', run: () => a.promise })).toBe('started');
        expect(q.submit({ taskId: 't2', userId: 'u1', run: () => deferred().promise })).toBe('queued');
        expect(q.stats()).toEqual({ globalActive: 1, pending: 1 });
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
        expect(q.stats()).toEqual({ globalActive: 1, pending: 0 });
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
        expect(q.stats()).toEqual({ globalActive: 1, pending: 0 });
    });
});
