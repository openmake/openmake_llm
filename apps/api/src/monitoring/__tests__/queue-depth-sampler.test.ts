import { sampleQueueDepth, getLastQueueDepth, QUEUE_DEPTH_QUEUES } from '../queue-depth-sampler';
import { resolveSeriesWindow } from '../../data/repositories/node-metrics-repository';

function fakePool(counts: Record<string, number | Error>) {
    return {
        query: jest.fn(async (sql: string) => {
            const key = sql.includes('agent_tasks') ? 'agent_tasks' : 'orchestrator_jobs';
            const v = counts[key];
            if (v instanceof Error) throw v;
            return { rows: [{ n: String(v) }] };
        }),
    } as never;
}

describe('queue-depth-sampler', () => {
    it('인메모리 큐·DB·vLLM 대기를 한 스냅샷과 라벨 행으로', async () => {
        const { snapshot, rows } = await sampleQueueDepth(fakePool({ agent_tasks: 4, orchestrator_jobs: 1 }), {
            queueStats: () => ({ globalActive: 2, pending: 3 }), vllmWaiting: () => 7, now: 0,
        });
        expect(snapshot).toMatchObject({ agent_task_pending: 3, agent_task_running: 2, agent_task_queued_db: 4, orchestrator_jobs_pending: 1, vllm_waiting: 7 });
        expect(rows.map((r) => r.labels?.queue).sort()).toEqual([...QUEUE_DEPTH_QUEUES].sort());
        expect(rows.every((r) => r.nodeId === 'app' && r.metric === 'queue_depth')).toBe(true);
        expect(getLastQueueDepth()).toBe(snapshot);
    });

    it('DB 조회 실패·vLLM 스냅샷 없음은 null 로 두고 행을 만들지 않는다(fail-open)', async () => {
        const { snapshot, rows } = await sampleQueueDepth(fakePool({ agent_tasks: new Error('no table'), orchestrator_jobs: 0 }), {
            queueStats: () => ({ globalActive: 0, pending: 0 }), vllmWaiting: () => undefined,
        });
        expect(snapshot.agent_task_queued_db).toBeNull();
        expect(snapshot.vllm_waiting).toBeNull();
        expect(rows.map((r) => r.labels?.queue)).toEqual(['agent_task_pending', 'agent_task_running', 'orchestrator_jobs_pending']);
    });
});

describe('resolveSeriesWindow', () => {
    it('기본 6시간·상한 14일·기간별 버킷', () => {
        expect(resolveSeriesWindow(undefined)).toEqual({ hours: 6, bucketMinutes: 5 });
        expect(resolveSeriesWindow('24')).toEqual({ hours: 24, bucketMinutes: 30 });
        expect(resolveSeriesWindow(99999)).toEqual({ hours: 336, bucketMinutes: 180 });
        expect(resolveSeriesWindow(-3)).toEqual({ hours: 6, bucketMinutes: 5 });
    });
});
