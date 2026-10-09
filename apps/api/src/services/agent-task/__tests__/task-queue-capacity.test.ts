/**
 * 대기열 용량 검증 (Companion P3-4) — 운영 목표 설정(전역 2, 사용자당 1)에서의 동작.
 * 추론 용량이 2건이라 100명이 요청해도 동시에 도는 것은 2건이고, 한 사람이 두 자리를 차지하지 못한다.
 */
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ updateAgentTask: async () => undefined }) }));

import { AgentTaskQueue } from '../task-queue';

interface Job { taskId: string; userId: string; finish: () => void; started: boolean }

function harness(globalMax = 2, userMax = 1) {
    const q = new AgentTaskQueue(globalMax, userMax);
    const jobs = new Map<string, Job>();
    const running = (): string[] => [...jobs.values()].filter((j) => j.started).map((j) => j.taskId);
    let peak = 0;
    const submit = (taskId: string, userId: string, priority?: number): 'started' | 'queued' | 'duplicate' => {
        const job: Job = { taskId, userId, finish: () => undefined, started: false };
        jobs.set(taskId, job);
        return q.submit({
            taskId, userId, ...(priority !== undefined ? { priority } : {}),
            run: () => new Promise<void>((resolve) => {
                job.started = true;
                peak = Math.max(peak, running().length);
                job.finish = () => { jobs.delete(taskId); resolve(); };
            }),
        });
    };
    const finish = async (taskId: string): Promise<void> => { jobs.get(taskId)!.finish(); await new Promise((r) => setImmediate(r)); };
    return { q, submit, finish, running, peak: () => peak };
}

describe('AgentTaskQueue — 전역 2 · 사용자당 1', () => {
    it('100명이 한꺼번에 요청해도 동시에 도는 것은 2건이고, 나머지는 순번을 받는다', async () => {
        const h = harness();
        const outcomes = Array.from({ length: 100 }, (_v, i) => h.submit(`t${i}`, `u${i}`));
        expect(outcomes.filter((o) => o === 'started')).toHaveLength(2);
        expect(h.running()).toEqual(['t0', 't1']);
        expect(h.q.position('t2')).toBe(1);
        expect(h.q.position('t99')).toBe(98);
        // 차례로 끝내면 등록 순으로 하나씩 들어온다
        for (let i = 0; i < 98; i++) {
            await h.finish(`t${i}`);
            expect(h.running()).toHaveLength(2);
            expect(h.running()).toContain(`t${i + 2}`);
        }
        expect(h.peak()).toBe(2);
        expect(h.q.stats()).toMatchObject({ globalActive: 2, pending: 0 });
    });

    it('한 사람이 여러 건을 넣어도 한 번에 1건만 돈다 — 다른 사람의 작업이 먼저 들어온다', async () => {
        const h = harness();
        expect(h.submit('a1', 'alice')).toBe('started');
        expect(h.submit('a2', 'alice')).toBe('queued');
        expect(h.submit('a3', 'alice')).toBe('queued');
        expect(h.submit('b1', 'bob')).toBe('started');   // 자리가 하나 남아 있다
        expect(h.submit('c1', 'carol')).toBe('queued');
        expect(h.running().sort()).toEqual(['a1', 'b1']);
        await h.finish('b1');
        // alice 는 이미 1건이 돌고 있어 a2 가 앞 순번이어도 carol 이 먼저 시작한다
        expect(h.running().sort()).toEqual(['a1', 'c1']);
        await h.finish('a1');
        expect(h.running().sort()).toEqual(['a2', 'c1']);
    });

    it('주차(승인·기기 대기)로 실행이 끝나면 자리가 바로 다음 작업에 넘어간다', async () => {
        const h = harness();
        h.submit('t1', 'u1'); h.submit('t2', 'u2'); h.submit('t3', 'u3');
        expect(h.q.position('t3')).toBe(1);
        await h.finish('t1'); // 주차는 실행 함수가 끝나는 것으로 나타난다(AgentTaskParked → execute 반환)
        expect(h.running().sort()).toEqual(['t2', 't3']);
        expect(h.q.position('t3')).toBeNull();
    });

    it('대기 중 취소하면 뒤 작업의 순번이 당겨진다', () => {
        const h = harness();
        h.submit('t1', 'u1'); h.submit('t2', 'u2'); h.submit('t3', 'u3'); h.submit('t4', 'u4');
        expect(h.q.cancelPending('t3')).toBe(true);
        expect(h.q.position('t4')).toBe(1);
    });
});
