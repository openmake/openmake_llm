/**
 * 과거 에이전트 작업 조회 — 교훈 주입(task-learning)이 쓰는 읽기 전용 쿼리.
 * 모든 쿼리는 user_id 로 범위를 제한한다(agent_tasks 에는 조직 칸이 없다 — 작업은 사용자 소유).
 * agent-task-repository 가 파일 크기 상한에 가까워 조회 전용을 따로 둔다.
 *
 * @module data/repositories/agent-task-history-repository
 */
import { BaseRepository, QueryParam } from './base-repository';
import type { AgentTask } from '../models/unified-database.types';

export type LessonCandidate = Pick<AgentTask, 'id' | 'goal' | 'status' | 'error' | 'current_turn'>;

export interface LessonCandidateFilter {
    /** 예약이 만든 작업(agent_task_schedule_runs.task_id)을 뺀다. */
    skipScheduled: boolean;
    /** 이 실패 분류의 failed 작업을 뺀다(환경 탓 실패). */
    skipFailureClasses: readonly string[];
}

export class AgentTaskHistoryRepository extends BaseRepository {
    /** 교훈 후보 — 사용자의 최근 종료 작업 경량 메타(checkpoint 등 대형 컬럼 제외). */
    async getLessonCandidates(userId: string, limit: number, filter: LessonCandidateFilter): Promise<LessonCandidate[]> {
        const params: QueryParam[] = [userId];
        const conds = [`t.user_id = $1`, `t.status IN ('completed', 'failed', 'cancelled')`];
        if (filter.skipScheduled) conds.push('NOT EXISTS (SELECT 1 FROM agent_task_schedule_runs r WHERE r.task_id = t.id)');
        if (filter.skipFailureClasses.length > 0) {
            params.push([...filter.skipFailureClasses]);
            conds.push(`NOT (t.status = 'failed' AND t.failure_class = ANY($${params.length}::text[]))`);
        }
        params.push(limit);
        const result = await this.query<LessonCandidate>(
            `SELECT t.id, t.goal, t.status, t.error, t.current_turn FROM agent_tasks t
              WHERE ${conds.join(' AND ')}
              ORDER BY t.created_at DESC LIMIT $${params.length}`,
            params,
        );
        return result.rows;
    }
}
