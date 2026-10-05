/**
 * 대기열 대기 시간 지표 (Companion 남은 항목 2) — 등록 시각부터 꺼내 시작할 때까지를 재고,
 * 최근 N건 요약(건수·중앙값·p95·최대)과 지금 가장 오래 기다린 항목의 대기 시간을 stats() 에 싣는다.
 */
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ updateAgentTask: async () => undefined }) }));

import { AgentTaskQueue, summarizeQueueWaits, AGENT_TASK_QUEUE_WAIT_METRIC } from '../task-queue';
import { getMetrics } from '../../../monitoring/metrics';

/** 바깥에서 끝낼 수 있는 실행 thunk */
function gate() {
    let release: () => void = () => undefined;
    const done = new Promise<void>((r) => { release = r; });
    return { run: () => done, release };
}
const flush = () => new Promise((r) => setImmediate(r));

describe('AgentTaskQueue 대기 시간', () => {
    beforeEach(() => getMetrics().reset());

    it('즉시 시작한 작업은 대기 시간 0 으로 집계된다', () => {
        let now = 1_000;
        const q = new AgentTaskQueue(2, 2, 10, () => now);
        q.submit({ taskId: 'a', userId: 'u1', run: gate().run });
        now = 5_000;
        const w = q.stats().wait;
        expect(w.recent).toEqual({ count: 1, p50Ms: 0, p95Ms: 0, maxMs: 0 });
        expect(w.oldestPendingMs).toBeNull();
        expect(getMetrics().getHistogramStats(AGENT_TASK_QUEUE_WAIT_METRIC)).toMatchObject({ count: 1, max: 0 });
    });

    it('대기했다 시작한 작업은 등록부터 시작까지의 시간이 잡힌다', async () => {
        let now = 0;
        const q = new AgentTaskQueue(1, 1, 10, () => now);
        const first = gate();
        q.submit({ taskId: 'a', userId: 'u1', run: first.run });
        now = 100;
        q.submit({ taskId: 'b', userId: 'u2', run: gate().run });
        now = 1_100;
        expect(q.stats().wait.oldestPendingMs).toBe(1_000); // 아직 대기 중인 b
        first.release();
        await flush();
        const w = q.stats().wait;
        expect(w.oldestPendingMs).toBeNull();
        expect(w.recent.count).toBe(2);
        expect(w.recent.maxMs).toBe(1_000);
        expect(getMetrics().getHistogramStats(AGENT_TASK_QUEUE_WAIT_METRIC)).toMatchObject({ count: 2, max: 1_000 });
    });

    it('재시작 복구로 다시 줄 선 작업은 넘겨받은 원래 등록 시각으로 잰다', async () => {
        let now = 10_000;
        const q = new AgentTaskQueue(1, 1, 10, () => now);
        const first = gate();
        q.submit({ taskId: 'a', userId: 'u1', run: first.run });
        q.submit({ taskId: 'b', userId: 'u2', run: gate().run, enqueuedAt: 4_000 });
        expect(q.stats().wait.oldestPendingMs).toBe(6_000);
        now = 12_000;
        first.release();
        await flush();
        expect(q.stats().wait.recent.maxMs).toBe(8_000);
    });

    it('최근 N건만 남긴다', () => {
        const q = new AgentTaskQueue(100, 100, 3, () => 0);
        for (let i = 0; i < 5; i++) q.submit({ taskId: `t${i}`, userId: `u${i}`, run: gate().run });
        expect(q.stats().wait.recent.count).toBe(3);
    });
});

describe('summarizeQueueWaits', () => {
    it('비어 있으면 건수 0·나머지 null', () => {
        expect(summarizeQueueWaits([])).toEqual({ count: 0, p50Ms: null, p95Ms: null, maxMs: null });
    });

    it('중앙값·p95·최대(nearest-rank)', () => {
        const xs = Array.from({ length: 20 }, (_, i) => (i + 1) * 10); // 10..200
        expect(summarizeQueueWaits(xs)).toEqual({ count: 20, p50Ms: 100, p95Ms: 190, maxMs: 200 });
    });
});
