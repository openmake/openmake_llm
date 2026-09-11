/**
 * @module data/repositories/orchestrator-runs-repo
 * @description 멀티모달 오케스트레이터 셰도우(관측 전용) 적재 — 계획 시간·채택률·작업 성공률.
 * fail-open·fire-and-forget: 기록 실패가 채팅을 죽이지 않는다.
 * @see db/migrations/119_orchestrator_planner.sql
 */
import { BaseRepository } from './base-repository';

export interface OrchestratorRunRecord {
    requestId?: string;
    userId?: string;
    plannerModel?: string;
    plannerMs?: number;
    plannerOk: boolean;
    plannerError?: string;
    complexity?: 'simple' | 'multi';
    plan?: unknown;
    taskCount?: number;
    tasksOk?: number;
    tasksFailed?: number;
    tasksPending?: number;
    execMs?: number;
    taskResults?: unknown;
    outcome: 'executed' | 'simple' | 'fallback';
}

export class OrchestratorRunsRepository extends BaseRepository {
    async insert(r: OrchestratorRunRecord): Promise<void> {
        await this.query(
            `INSERT INTO orchestrator_runs
                (request_id, user_id, planner_model, planner_ms, planner_ok, planner_error, complexity, plan,
                 task_count, tasks_ok, tasks_failed, tasks_pending, exec_ms, task_results, outcome)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14::jsonb, $15)`,
            [
                r.requestId ?? null, r.userId ?? null, r.plannerModel ?? null, r.plannerMs ?? null, r.plannerOk,
                r.plannerError?.slice(0, 500) ?? null, r.complexity ?? null, r.plan === undefined ? null : JSON.stringify(r.plan),
                r.taskCount ?? 0, r.tasksOk ?? 0, r.tasksFailed ?? 0, r.tasksPending ?? 0, r.execMs ?? null,
                r.taskResults === undefined ? null : JSON.stringify(r.taskResults), r.outcome,
            ],
        );
    }
}
