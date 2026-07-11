/**
 * @module data/repositories/agent-task-schedule-repository
 * @description `agent_task_schedules` 테이블 데이터 접근 (Phase 3-A 스케줄 트리거).
 *
 * 반복 실행 정의(cron/interval)의 CRUD + 스케줄러용 due 조회·실행 결과 반영.
 * ArtifactExecutionRepository 처럼 unified-database facade 없이 직접 사용한다
 * (getPool() 주입 — 신규 테이블의 facade 팽창 회피).
 */
import { BaseRepository } from './base-repository';

export interface AgentTaskSchedule {
    id: string;
    user_id?: string;
    goal: string;
    cron?: string | null;
    interval_seconds?: number | null;
    max_turns: number;
    enabled: boolean;
    next_run_at: string;
    last_run_at?: string | null;
    last_task_id?: string | null;
    consecutive_failures: number;
    created_at: string;
    updated_at: string;
}

export class AgentTaskScheduleRepository extends BaseRepository {
    async create(params: {
        id: string;
        userId: string;
        goal: string;
        cron?: string | null;
        intervalSeconds?: number | null;
        maxTurns: number;
        nextRunAtMs: number;
    }): Promise<void> {
        await this.query(
            `INSERT INTO agent_task_schedules
                (id, user_id, goal, cron, interval_seconds, max_turns, next_run_at)
             VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7))`,
            [params.id, params.userId, params.goal, params.cron ?? null,
             params.intervalSeconds ?? null, params.maxTurns, params.nextRunAtMs / 1000],
        );
    }

    async get(id: string): Promise<AgentTaskSchedule | undefined> {
        const r = await this.query<AgentTaskSchedule>('SELECT * FROM agent_task_schedules WHERE id = $1', [id]);
        return r.rows[0];
    }

    async listByUser(userId: string): Promise<AgentTaskSchedule[]> {
        const r = await this.query<AgentTaskSchedule>(
            'SELECT * FROM agent_task_schedules WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
        return r.rows;
    }

    async countByUser(userId: string): Promise<number> {
        const r = await this.query<{ count: string }>(
            'SELECT COUNT(*)::text AS count FROM agent_task_schedules WHERE user_id = $1', [userId]);
        return parseInt(r.rows[0]?.count ?? '0', 10);
    }

    /** 실행 대상 — enabled + next_run_at 이 지난 스케줄. */
    async getDue(nowMs: number): Promise<AgentTaskSchedule[]> {
        const r = await this.query<AgentTaskSchedule>(
            'SELECT * FROM agent_task_schedules WHERE enabled = true AND next_run_at <= to_timestamp($1) ORDER BY next_run_at ASC',
            [nowMs / 1000]);
        return r.rows;
    }

    /** enabled 토글 + 필드 갱신(부분). */
    async update(id: string, updates: {
        goal?: string;
        cron?: string | null;
        intervalSeconds?: number | null;
        maxTurns?: number;
        enabled?: boolean;
        nextRunAtMs?: number;
    }): Promise<void> {
        const sets: string[] = ['updated_at = NOW()'];
        const params: unknown[] = [];
        let i = 1;
        if (updates.goal !== undefined) { sets.push(`goal = $${i++}`); params.push(updates.goal); }
        if (updates.cron !== undefined) { sets.push(`cron = $${i++}`); params.push(updates.cron); }
        if (updates.intervalSeconds !== undefined) { sets.push(`interval_seconds = $${i++}`); params.push(updates.intervalSeconds); }
        if (updates.maxTurns !== undefined) { sets.push(`max_turns = $${i++}`); params.push(updates.maxTurns); }
        if (updates.enabled !== undefined) { sets.push(`enabled = $${i++}`); params.push(updates.enabled); }
        if (updates.nextRunAtMs !== undefined) { sets.push(`next_run_at = to_timestamp($${i++})`); params.push(updates.nextRunAtMs / 1000); }
        params.push(id);
        await this.query(`UPDATE agent_task_schedules SET ${sets.join(', ')} WHERE id = $${i}`, params as never[]);
    }

    /** 실행 성공 반영 — next_run_at 갱신 + last_run/last_task 기록 + 연속실패 리셋.
     *  nextRunAtMs=null(무효 표현식 등)이면 비활성화. */
    async markRun(id: string, nextRunAtMs: number | null, taskId: string): Promise<void> {
        if (nextRunAtMs === null) {
            await this.query(
                `UPDATE agent_task_schedules SET enabled = false, last_run_at = NOW(),
                    last_task_id = $2, consecutive_failures = 0, updated_at = NOW() WHERE id = $1`,
                [id, taskId]);
            return;
        }
        await this.query(
            `UPDATE agent_task_schedules SET next_run_at = to_timestamp($2), last_run_at = NOW(),
                last_task_id = $3, consecutive_failures = 0, updated_at = NOW() WHERE id = $1`,
            [id, nextRunAtMs / 1000, taskId]);
    }

    /** 실행 실패 반영 — 연속실패 +1, 임계 도달 시 비활성. next_run_at 은 갱신해 무한 재시도 방지. */
    async markFailure(id: string, nextRunAtMs: number | null, disableThreshold: number): Promise<void> {
        await this.query(
            `UPDATE agent_task_schedules SET
                consecutive_failures = consecutive_failures + 1,
                enabled = (consecutive_failures + 1 < $2),
                next_run_at = COALESCE(to_timestamp($3), next_run_at),
                updated_at = NOW()
             WHERE id = $1`,
            [id, disableThreshold, nextRunAtMs === null ? null : nextRunAtMs / 1000]);
    }

    async delete(id: string): Promise<void> {
        await this.query('DELETE FROM agent_task_schedules WHERE id = $1', [id]);
        // 이력도 정리(068 은 FK 없이 append-only — 스케줄 삭제 시 함께 비운다).
        await this.query('DELETE FROM agent_task_schedule_runs WHERE schedule_id = $1', [id])
            .catch(() => { /* 068 미적용 배포 호환 */ });
    }

    /** 발화 이력 기록(6-2) — tick 1회 발화당 1행. 기록 실패는 발화를 막지 않는다(호출부 catch). */
    async recordRun(p: { scheduleId: string; userId?: string; taskId?: string; outcome: 'fired' | 'error'; error?: string }): Promise<void> {
        await this.query(
            `INSERT INTO agent_task_schedule_runs (schedule_id, user_id, task_id, outcome, error)
             VALUES ($1, $2, $3, $4, $5)`,
            [p.scheduleId, p.userId ?? null, p.taskId ?? null, p.outcome, p.error ?? null],
        );
    }

    /** 발화 이력 조회(최신순, 6-2). */
    async listRuns(scheduleId: string, limit = 20): Promise<Array<{
        id: number; schedule_id: string; task_id?: string | null; outcome: string; error?: string | null; created_at: string;
    }>> {
        const r = await this.query<{ id: number; schedule_id: string; task_id?: string | null; outcome: string; error?: string | null; created_at: string }>(
            `SELECT id, schedule_id, task_id, outcome, error, created_at
             FROM agent_task_schedule_runs WHERE schedule_id = $1 ORDER BY created_at DESC LIMIT $2`,
            [scheduleId, limit],
        );
        return r.rows;
    }
}
