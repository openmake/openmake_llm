/**
 * 에이전트 작업 마지막 진행 시각(191, R8) — 진행 추적기가 모은 시각을 쓰고, watchdog 이 멈춘 실행 중 작업을 찾는다.
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

    /** 진행이 staleMs 보다 오래 멈춘 실행 중 작업 — 주차·살아 있는 승인 대기는 기다리는 중이라 뺀다. 오래 멈춘 순 */
    async listStaleRunningTasks(staleMs: number, limit = 50): Promise<StaleTaskRow[]> {
        try {
            const r = await this.query<Omit<StaleTaskRow, 'stalled_ms'> & { stalled_ms: string | number }>(
                `SELECT t.id, t.user_id, t.current_turn, t.lease_owner,
                        (EXTRACT(EPOCH FROM (NOW() - COALESCE(t.last_progress_at, t.updated_at))) * 1000)::bigint AS stalled_ms
                 FROM agent_tasks t
                 WHERE t.status = 'running'
                   AND NOT (${parkedTaskCondition('t')})
                   AND NOT EXISTS (SELECT 1 FROM agent_task_approvals a WHERE a.task_id = t.id AND a.status = 'pending' AND a.expires_at > NOW())
                   AND COALESCE(t.last_progress_at, t.updated_at) < NOW() - make_interval(secs => $1 / 1000.0)
                 ORDER BY COALESCE(t.last_progress_at, t.updated_at) ASC LIMIT $2`,
                [staleMs, limit]);
            return r.rows.map((row) => ({ ...row, stalled_ms: Number(row.stalled_ms) })); // pg 는 bigint 를 문자열로 준다
        } catch (err) {
            if (skipIfColumnMissing(err)) return [];
            throw err;
        }
    }
}
