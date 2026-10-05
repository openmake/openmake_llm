/**
 * 큐 깊이 샘플러 (F24.4, 143) — 앱 큐(인메모리 작업 큐·DB queued 행·오케스트레이터 job)와 vLLM 대기 요청을
 * 같은 시각에 찍어 "어디서 막히는지"를 한 표로 본다. 게이지 갱신 + node_metrics_samples(node_id='app', metric='queue_depth').
 *
 * @module monitoring/queue-depth-sampler
 */
import type { Pool } from 'pg';
import { getMetrics } from './metrics';
import type { NodeMetricSampleRow } from '../data/repositories/node-metrics-repository';

export const QUEUE_DEPTH_METRIC = 'queue_depth';
export const QUEUE_DEPTH_NODE_ID = 'app';
/** 샘플 대상 큐(라벨 queue 값) */
export const QUEUE_DEPTH_QUEUES = ['agent_task_pending', 'agent_task_running', 'agent_task_queued_db', 'orchestrator_jobs_pending', 'vllm_waiting'] as const;
/** 대기 시간 지표(ms) — 지금 대기 중인 작업 중 가장 오래 기다린 시간(없으면 0). 라벨 queue='agent_task_oldest_pending'. */
export const QUEUE_WAIT_METRIC = 'queue_wait_ms';
export const QUEUE_WAIT_OLDEST_LABEL = 'agent_task_oldest_pending';

export interface QueueDepthSnapshot {
    agent_task_pending: number;
    agent_task_running: number;
    agent_task_queued_db: number | null;
    orchestrator_jobs_pending: number | null;
    vllm_waiting: number | null;
    /** 가장 오래 기다린 대기 작업의 대기 시간(ms), 대기 없으면 0 — queue_depth 가 아니라 queue_wait_ms 지표로 남는다 */
    agent_task_oldest_wait_ms: number;
    sampledAt: string;
}

let last: QueueDepthSnapshot | null = null;

async function countOrNull(pool: Pool, sql: string): Promise<number | null> {
    try {
        const r = await pool.query<{ n: string }>(sql);
        return Number(r.rows[0]?.n ?? 0);
    } catch {
        return null;
    }
}

export async function sampleQueueDepth(pool: Pool, deps: {
    queueStats: () => { globalActive: number; pending: number; wait?: { oldestPendingMs: number | null } };
    vllmWaiting: () => number | undefined;
    now?: number;
}): Promise<{ snapshot: QueueDepthSnapshot; rows: NodeMetricSampleRow[] }> {
    const q = deps.queueStats();
    const [queuedDb, jobsPending] = await Promise.all([
        countOrNull(pool, `SELECT count(*) AS n FROM agent_tasks WHERE status = 'queued'`),
        countOrNull(pool, `SELECT count(*) AS n FROM orchestrator_jobs WHERE status = 'pending'`),
    ]);
    const vw = deps.vllmWaiting();
    const snapshot: QueueDepthSnapshot = {
        agent_task_pending: q.pending,
        agent_task_running: q.globalActive,
        agent_task_queued_db: queuedDb,
        orchestrator_jobs_pending: jobsPending,
        vllm_waiting: vw ?? null,
        agent_task_oldest_wait_ms: q.wait?.oldestPendingMs ?? 0,
        sampledAt: new Date(deps.now ?? Date.now()).toISOString(),
    };
    const rows: NodeMetricSampleRow[] = [];
    for (const [queue, value] of Object.entries(snapshot)) {
        if (queue === 'sampledAt' || queue === 'agent_task_oldest_wait_ms' || typeof value !== 'number') continue;
        getMetrics().setGauge(QUEUE_DEPTH_METRIC, value, { queue });
        rows.push({ nodeId: QUEUE_DEPTH_NODE_ID, metric: QUEUE_DEPTH_METRIC, value, labels: { queue } });
    }
    const wait = snapshot.agent_task_oldest_wait_ms;
    getMetrics().setGauge(QUEUE_WAIT_METRIC, wait, { queue: QUEUE_WAIT_OLDEST_LABEL });
    rows.push({ nodeId: QUEUE_DEPTH_NODE_ID, metric: QUEUE_WAIT_METRIC, value: wait, labels: { queue: QUEUE_WAIT_OLDEST_LABEL } });
    last = snapshot;
    return { snapshot, rows };
}

export function getLastQueueDepth(): QueueDepthSnapshot | null {
    return last;
}
