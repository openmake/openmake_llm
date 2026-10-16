/**
 * `/api/health` 의 `knowledge` 절 — 수집 소비자 모드·generation·현재 모드 소비자의 heartbeat 나이·대기열 나이·진행 수.
 * 한 쿼리로 읽는다. 모드 행이 없으면(마이그레이션 전) 값은 null·0 이다.
 * external 모드인데 별도 worker 가 떠 있지 않으면 workerHeartbeatAgeMs 가 null(또는 커지고) queueOldestAgeMs 가 자란다 — 운영 경보의 근거.
 *
 * @module addons/knowledge-runtime/jobs/worker-status
 */
import { kdb } from '../db';
import { KNOWLEDGE_RUNTIME } from '../constants';
import type { KnowledgeWorkerMode } from './job-schema';

export interface KnowledgeQueueHealth {
    /** DB 가 정한 소비자 모드 */
    mode: KnowledgeWorkerMode | null;
    generation: number | null;
    /** 현재 모드와 같은 종류의 소비자 중 가장 최근 heartbeat 이후 경과(ms) — 그런 소비자 행이 없으면 null */
    workerHeartbeatAgeMs: number | null;
    /** 실행할 때가 된 queued 작업 중 가장 오래 기다린 것의 대기(ms) — 없으면 null */
    queueOldestAgeMs: number | null;
    /** 현재 모드 소비자들이 최근(WORKER_HEARTBEAT_STALE_MS 안) heartbeat 에 보고한 진행 중 작업 수 합 */
    inflight: number;
}

interface Row {
    mode: KnowledgeWorkerMode | null;
    generation: number | null;
    heartbeat_age_ms: string | null;
    queue_oldest_ms: string | null;
    inflight: string | null;
}

const toNumberOrNull = (value: string | null | undefined): number | null => (value === null || value === undefined ? null : Number(value));

export async function readKnowledgeQueueHealth(): Promise<KnowledgeQueueHealth> {
    const r = await kdb().query<Row>(
        `WITH m AS (SELECT mode, generation FROM knowledge_worker_mode WHERE id = 1)
         SELECT (SELECT mode FROM m) AS mode,
                (SELECT generation FROM m) AS generation,
                (SELECT (EXTRACT(EPOCH FROM (NOW() - MAX(h.last_seen))) * 1000)::bigint
                   FROM knowledge_worker_heartbeats h WHERE h.mode = (SELECT mode FROM m)) AS heartbeat_age_ms,
                (SELECT COALESCE(SUM(h.inflight), 0)
                   FROM knowledge_worker_heartbeats h
                  WHERE h.mode = (SELECT mode FROM m)
                    AND h.last_seen > NOW() - ($1::bigint * INTERVAL '1 millisecond')) AS inflight,
                (SELECT (EXTRACT(EPOCH FROM (NOW() - MIN(j.run_after))) * 1000)::bigint
                   FROM knowledge_ingestion_jobs j WHERE j.state = 'queued' AND j.run_after <= NOW()) AS queue_oldest_ms`,
        [KNOWLEDGE_RUNTIME.WORKER_HEARTBEAT_STALE_MS],
    );
    const row = r.rows[0];
    return {
        mode: row?.mode ?? null,
        generation: row?.generation ?? null,
        workerHeartbeatAgeMs: toNumberOrNull(row?.heartbeat_age_ms),
        queueOldestAgeMs: toNumberOrNull(row?.queue_oldest_ms),
        inflight: Number(row?.inflight ?? 0),
    };
}
