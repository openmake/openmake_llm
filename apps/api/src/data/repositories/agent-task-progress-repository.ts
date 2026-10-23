/**
 * 에이전트 작업 마지막 진행 시각(191, R8) — 진행 추적기가 모은 시각을 쓰고, watchdog 이 멈춘 실행 중 작업을 찾는다.
 * watchdog 의 주차 사유별 집계(#1478)도 여기 둔다 — 목록 상한 없이 DB 가 센다.
 * agent-task-repository 가 파일 크기 한계에 닿아 따로 둔다. 191 미적용(컬럼 없음, 42703)이면 한 번만 경고하고 건너뛴다.
 *
 * @module data/repositories/agent-task-progress-repository
 */
import { BaseRepository } from './base-repository';
import { parkedTaskCondition } from './agent-task-repository';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskProgressRepo');

/** 진행이 오래 멈춘 실행 중 작업 — stalled_ms 는 마지막 진행(없으면 마지막 갱신)부터 지금까지 */
export interface StaleTaskRow { id: string; user_id: string; current_turn: number; lease_owner: string | null; stalled_ms: number }

/** 주차 사유별 집계 — count·longCount 는 조건에 맞는 전체 행, oldest 는 가장 오래 기다린 순(같은 시각이면 id 순) 표본 */
export interface ParkedReasonStats { count: number; longCount: number; oldest: Array<{ id: string; waited_ms: number }> }

let columnMissingWarned = false;
/** 컬럼 없음(42703)이면 한 번만 경고하고 true — 호출부는 건너뛴다 */
function skipIfColumnMissing(err: unknown): boolean {
    if ((err as { code?: unknown } | null)?.code !== '42703') return false;
    if (!columnMissingWarned) { columnMissingWarned = true; logger.warn('last_progress_at 컬럼 없음(191 미적용) — 진행 기록 생략'); }
    return true;
}

export class AgentTaskProgressRepository extends BaseRepository {
    /** 실행 중 작업의 마지막 진행 시각을 앞으로만 옮긴다 — 반환은 영향 행 합계 */
    async flushProgress(entries: ReadonlyArray<{ taskId: string; at: Date }>): Promise<number> {
        let updated = 0;
        try {
            for (const e of entries) {
                const r = await this.query(
                    `UPDATE agent_tasks SET last_progress_at = GREATEST(COALESCE(last_progress_at, to_timestamp(0)), $2) WHERE id = $1 AND status = 'running'`,
                    [e.taskId, e.at.toISOString()]);
                updated += r.rowCount ?? 0;
            }
        } catch (err) {
            if (skipIfColumnMissing(err)) return 0;
            throw err;
        }
        return updated;
    }

    /**
     * 진행이 staleMs 보다 오래 멈춘 실행 중 작업 — 주차·살아 있는 승인 대기는 기다리는 중이라 뺀다. 오래 멈춘 순.
     * 기준은 last_progress_at 과 updated_at 중 늦은 쪽 — 재개 직후(다음 flush 전)엔 상태 전이가 올린 updated_at 이 옛 진행 시각을 이긴다.
     */
    async listStaleRunningTasks(staleMs: number, limit = 50): Promise<StaleTaskRow[]> {
        try {
            const r = await this.query<Omit<StaleTaskRow, 'stalled_ms'> & { stalled_ms: string | number }>(
                `SELECT t.id, t.user_id, t.current_turn, t.lease_owner,
                        (EXTRACT(EPOCH FROM (NOW() - GREATEST(COALESCE(t.last_progress_at, to_timestamp(0)), t.updated_at))) * 1000)::bigint AS stalled_ms
                 FROM agent_tasks t
                 WHERE t.status = 'running'
                   AND NOT (${parkedTaskCondition('t')})
                   AND NOT EXISTS (SELECT 1 FROM agent_task_approvals a WHERE a.task_id = t.id AND a.status = 'pending' AND a.expires_at > NOW())
                   AND GREATEST(COALESCE(t.last_progress_at, to_timestamp(0)), t.updated_at) < NOW() - make_interval(secs => $1 / 1000.0)
                 ORDER BY GREATEST(COALESCE(t.last_progress_at, to_timestamp(0)), t.updated_at) ASC LIMIT $2`,
                [staleMs, limit]);
            return r.rows.map((row) => ({ ...row, stalled_ms: Number(row.stalled_ms) })); // pg 는 bigint 를 문자열로 준다
        } catch (err) {
            if (skipIfColumnMissing(err)) return [];
            throw err;
        }
    }

    /**
     * 그 사유로 주차된 작업 전체의 집계(#1478) — 대기 시간은 마지막 전이 이벤트(주차 표식)부터. 주차 판정은 parkedTaskCondition 그대로다.
     * longMs 이상 기다린 건수와 가장 오래 기다린 sampleLimit 개 표본을 한 문장에서 낸다.
     */
    async summarizeParkedByReason(reason: string, longMs: number, sampleLimit: number): Promise<ParkedReasonStats> {
        const r = await this.query<{ count: number; long_count: number; oldest: Array<{ id: string; waited_ms: number }> }>(
            `WITH w AS (
                 SELECT t.id, le.created_at, (EXTRACT(EPOCH FROM (NOW() - le.created_at)) * 1000)::bigint AS waited_ms
                   FROM agent_tasks t
                   CROSS JOIN LATERAL (SELECT e.reason, e.created_at FROM agent_task_events e WHERE e.task_id = t.id ORDER BY e.id DESC LIMIT 1) le
                  WHERE ${parkedTaskCondition('t')} AND le.reason = $1
             )
             SELECT (SELECT COUNT(*) FROM w)::int AS count,
                    (SELECT COUNT(*) FROM w WHERE w.waited_ms >= $2)::int AS long_count,
                    COALESCE((SELECT json_agg(json_build_object('id', s.id, 'waited_ms', s.waited_ms) ORDER BY s.created_at ASC, s.id ASC)
                                FROM (SELECT id, created_at, waited_ms FROM w ORDER BY created_at ASC, id ASC LIMIT $3) s), '[]'::json) AS oldest`,
            [reason, longMs, sampleLimit]);
        const row = r.rows[0];
        return { count: row.count, longCount: row.long_count, oldest: row.oldest.map((o) => ({ id: o.id, waited_ms: Number(o.waited_ms) })) };
    }
}
