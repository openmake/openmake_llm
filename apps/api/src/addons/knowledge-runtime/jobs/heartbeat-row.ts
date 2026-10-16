/**
 * 소비자 heartbeat 행 — `knowledge_worker_heartbeats` 를 주기적으로 갱신하고(같은 문장에서 DB 모드·generation 을 읽어 돌려준다),
 * 오래된 행을 지우고, 정상 종료 때 자기 행을 지운다. `/api/health` 의 workerHeartbeatAgeMs·롤백 훈련이 이 표를 본다.
 *
 * @module addons/knowledge-runtime/jobs/heartbeat-row
 */
import { kdb } from '../db';
import { KNOWLEDGE_RUNTIME } from '../constants';
import type { KnowledgeWorkerMode } from './job-schema';

export interface HeartbeatInput {
    workerId: string;
    /** 이 소비자의 종류(별도 프로세스는 external, API poller 는 inprocess) */
    kind: KnowledgeWorkerMode;
    inflight: number;
}

export interface HeartbeatSnapshot {
    /** DB 가 정한 모드 — 행이 없으면 null */
    dbMode: KnowledgeWorkerMode | null;
    generation: number | null;
}

export async function writeWorkerHeartbeat(input: HeartbeatInput): Promise<HeartbeatSnapshot> {
    // 데이터 변경 CTE(up)는 참조하지 않아도 정확히 한 번 실행된다
    const r = await kdb().query<{ db_mode: KnowledgeWorkerMode | null; generation: number | null }>(
        `WITH m AS (SELECT mode, generation FROM knowledge_worker_mode WHERE id = 1),
              up AS (
                INSERT INTO knowledge_worker_heartbeats (worker_id, mode, generation, last_seen, inflight)
                VALUES ($1, $2, COALESCE((SELECT generation FROM m), 0), NOW(), $3)
                ON CONFLICT (worker_id) DO UPDATE
                   SET mode = EXCLUDED.mode, generation = EXCLUDED.generation, last_seen = NOW(), inflight = EXCLUDED.inflight
                RETURNING worker_id)
         SELECT (SELECT mode FROM m) AS db_mode, (SELECT generation FROM m) AS generation`,
        [input.workerId, input.kind, input.inflight],
    );
    await kdb().query(
        `DELETE FROM knowledge_worker_heartbeats WHERE last_seen < NOW() - ($1::bigint * INTERVAL '1 millisecond')`,
        [KNOWLEDGE_RUNTIME.WORKER_HEARTBEAT_RETENTION_MS],
    );
    const row = r.rows[0];
    return { dbMode: row?.db_mode ?? null, generation: row?.generation ?? null };
}

export async function removeWorkerHeartbeat(workerId: string): Promise<void> {
    await kdb().query('DELETE FROM knowledge_worker_heartbeats WHERE worker_id = $1', [workerId]);
}
