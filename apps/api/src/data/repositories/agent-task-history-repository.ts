/**
 * 과거 에이전트 작업 조회 — 교훈 주입(task-learning)과 과거 작업 검색 도구(task-history-tool)가 쓰는 읽기 전용 쿼리.
 * 모든 쿼리는 user_id 로 범위를 제한한다(agent_tasks 에는 조직 칸이 없다 — 작업은 사용자 소유).
 * agent-task-repository 가 파일 크기 상한에 가까워 조회 전용을 따로 둔다.
 *
 * @module data/repositories/agent-task-history-repository
 */
import { BaseRepository, QueryParam } from './base-repository';
import type { AgentTask } from '../models/unified-database.types';
import { TASK_HISTORY_TOOL } from '../../config/agent-task-skill-memory';

export type LessonCandidate = Pick<AgentTask, 'id' | 'goal' | 'status' | 'error' | 'current_turn'>;

export interface LessonCandidateFilter {
    /** 예약이 만든 작업(agent_task_schedule_runs.task_id)을 뺀다. */
    skipScheduled: boolean;
    /** 이 실패 분류의 failed 작업을 뺀다(환경 탓 실패). */
    skipFailureClasses: readonly string[];
}

/** 목록 한 줄 — 목표는 앞부분만. */
export interface TaskHistoryItem {
    id: string;
    goal: string;
    status: string;
    current_turn: number;
    created_at: string;
}

/** 한 건 요약 — 결과는 앞부분만, 쓴 도구 이름 포함. */
export interface TaskHistorySummary extends TaskHistoryItem {
    error: string | null;
    result: string | null;
    completed_at: string | null;
    tools: string[];
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

    /**
     * 사용자의 과거 작업 목록(최신순). words 가 있으면 낱말마다 목표·결과에 들어 있는 작업만(AND), 없으면 최근 목록.
     */
    async searchTasks(userId: string, words: readonly string[], opts: { limit: number; excludeTaskId?: string }): Promise<TaskHistoryItem[]> {
        const params: QueryParam[] = [userId];
        const conds = ['t.user_id = $1'];
        if (opts.excludeTaskId) {
            params.push(opts.excludeTaskId);
            conds.push(`t.id <> $${params.length}`);
        }
        for (const w of words) {
            params.push(`%${w.replace(/[\\%_]/g, '\\$&')}%`);
            conds.push(`(t.goal ILIKE $${params.length} OR t.result ILIKE $${params.length})`);
        }
        params.push(opts.limit);
        const result = await this.query<TaskHistoryItem>(
            `SELECT t.id, left(t.goal, ${Math.trunc(TASK_HISTORY_TOOL.GOAL_PREVIEW_CHARS)}) AS goal, t.status, t.current_turn, t.created_at FROM agent_tasks t
              WHERE ${conds.join(' AND ')}
              ORDER BY t.created_at DESC LIMIT $${params.length}`,
            params,
        );
        return result.rows;
    }

    /** 한 건 요약 — 작업 id 와 user_id 를 함께 걸어, 다른 사용자의 작업이면 null(도구 기록도 읽지 않는다). */
    async getTaskSummary(userId: string, taskId: string, resultMaxChars: number): Promise<TaskHistorySummary | null> {
        const task = await this.query<Omit<TaskHistorySummary, 'tools'>>(
            `SELECT t.id, t.goal, t.status, t.error, left(t.result, $3) AS result, t.current_turn, t.created_at, t.completed_at FROM agent_tasks t
              WHERE t.id = $1 AND t.user_id = $2`,
            [taskId, userId, resultMaxChars],
        );
        if (task.rows.length === 0) return null;
        const tools = await this.query<{ tool_name: string }>(
            `SELECT DISTINCT tool_name FROM agent_task_steps WHERE task_id = $1 AND tool_name IS NOT NULL AND step_type = 'tool_result'`,
            [taskId],
        );
        return { ...task.rows[0], tools: tools.rows.map((r) => r.tool_name) };
    }
}
