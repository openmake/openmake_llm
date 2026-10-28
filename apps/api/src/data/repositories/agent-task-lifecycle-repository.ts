/**
 * 에이전트 작업 수명 주기 조회·claim — agent-task-repository.ts 에서 분리 (max-lines 가드).
 * 상태 전이 이벤트·주차 표식/재개 claim·부팅 복구 claim·종료 알림 claim·실패 큐/활성 건수 뷰.
 * AgentTaskRepository 가 이 클래스를 상속하므로 호출부는 종전대로 AgentTaskRepository 로 부른다.
 *
 * @module data/repositories/agent-task-lifecycle-repository
 */
import { BaseRepository, QueryParam } from './base-repository';
import type { AgentTask } from '../models/unified-database.types';
import { recoverableRestartCondition } from './agent-task-run-repository';
import { claimableLeaseSql, orphanedClaimSql } from './agent-task-lease-sql';
import { AGENT_TASK_PARKED_REASON, AGENT_TASK_PARK_REASONS } from '../../config/agent-task-park-reasons';
import type { ParkedTaskRow } from './agent-task-park-repository';

/**
 * 주차(F16.7) 판정 SQL — paused 이고 마지막 전이 이벤트 사유가 주차 사유(hitl_parked·device_wait). 부팅 마킹·복구·재개 claim·스윕이 같은 조건을 쓴다.
 * 주차는 이미 paused 인 작업에 걸리므로 paused→paused 이벤트로 표식한다(markParked).
 */
/** 주차 사유 목록의 SQL 리터럴 — 값은 코드 상수뿐이고(사용자 입력 아님) 소문자·밑줄만 남긴다. */
const PARK_REASONS_SQL = AGENT_TASK_PARK_REASONS.map((r) => `'${r.replace(/[^a-z_]/g, '')}'`).join(', ');

export function parkedTaskCondition(alias: string): string {
    // COALESCE 필수 — 사유가 NULL 인(일반 승인 대기) paused 에서 비교가 NULL 이 되면 `NOT (…)` 도 NULL 이라 부팅 마킹·복구에서 빠진다
    return `(${alias}.status = 'paused' AND COALESCE((SELECT e.reason FROM agent_task_events e WHERE e.task_id = ${alias}.id ORDER BY e.id DESC LIMIT 1), '') IN (${PARK_REASONS_SQL}))`;
}

/** claim 이 같은 문장에서 쓰는 실행 소유권 SET 조각 — $n = owner, $n+1 = 초(2026-10-22 R2). */
const leaseSetSql = (n: number): string => `, lease_owner = $${n}, lease_until = NOW() + make_interval(secs => $${n + 1})`;

export class AgentTaskLifecycleRepository extends BaseRepository {
    /** 종료 알림을 보냈다 — 표식을 지운다(174). updated_at 은 건드리지 않는다. */
    async clearTerminalNotifyPending(taskId: string): Promise<void> {
        await this.query('UPDATE agent_tasks SET terminal_notify_pending = FALSE WHERE id = $1 AND terminal_notify_pending', [taskId]);
    }

    /**
     * 알림을 못 보낸 종료 작업을 가져오면서 표식을 지운다(174) — 한 문장이라 여러 프로세스가 같은 행을 두 번 가져가지 않는다.
     * graceMs: 정상 경로가 방금 쓴 행을 가로채지 않게 두는 여유. windowMs: 이보다 오래된 것은 다시 보내지 않는다. recoveryHoldMs: 부팅 복구가 되살릴 행을 보류하는 시간(recoverableRestartCondition).
     */
    async claimPendingTerminalNotifications(opts: { graceMs: number; windowMs: number; limit: number; recoveryHoldMs: number }): Promise<Array<Pick<AgentTask, 'id' | 'user_id' | 'goal' | 'status' | 'progress' | 'current_turn'>>> {
        const result = await this.query<Pick<AgentTask, 'id' | 'user_id' | 'goal' | 'status' | 'progress' | 'current_turn'>>(
            `UPDATE agent_tasks SET terminal_notify_pending = FALSE
             WHERE id IN (
                 SELECT id FROM agent_tasks
                 WHERE terminal_notify_pending
                   AND status IN ('completed', 'failed', 'cancelled') AND NOT ${recoverableRestartCondition('$4')}
                   AND updated_at < NOW() - ($1::bigint * INTERVAL '1 millisecond')
                   AND updated_at > NOW() - ($2::bigint * INTERVAL '1 millisecond')
                 ORDER BY updated_at
                 LIMIT $3
                 FOR UPDATE SKIP LOCKED
             )
             RETURNING id, user_id, goal, status, progress, current_turn`,
            [opts.graceMs, opts.windowMs, opts.limit, opts.recoveryHoldMs]);
        return result.rows;
    }

    /** 상태 전이 이벤트 1행(124) — 관측용이라 실패해도 전이를 되돌리지 않는다(fail-open). */
    async recordEvent(taskId: string, from: string | null | undefined, to: string, reason?: string): Promise<void> {
        await this.query(
            'INSERT INTO agent_task_events (task_id, from_status, to_status, reason) VALUES ($1, $2, $3, $4)',
            [taskId, from ?? null, to, reason ?? null],
        ).catch(() => { /* 이벤트 기록 실패는 작업을 막지 않는다 */ });
    }

    /** 주차 표식(F16.7) — recordEvent 와 달리 실패를 삼키지 않는다: 표식 없는 paused 는 아무도 재개하지 않는다. */
    async markParked(taskId: string, reason: string = AGENT_TASK_PARKED_REASON): Promise<void> {
        if (!AGENT_TASK_PARK_REASONS.includes(reason)) throw new Error(`모르는 주차 사유: ${reason}`);
        await this.query(
            `INSERT INTO agent_task_events (task_id, from_status, to_status, reason) VALUES ($1, 'paused', 'paused', $2)`,
            [taskId, reason],
        );
    }

    /** 주차 작업 재개 claim — 주차 중일 때만 pending 으로(동시 답변·스윕 중복 재개 방지). lease: 같은 문장에서 실행 소유권도 쓴다(claimAgentTaskForRecovery 참고). */
    async claimParkedTask(taskId: string, lease?: { owner: string; leaseMs: number }): Promise<boolean> {
        const r = await this.query(
            `UPDATE agent_tasks t SET status = 'pending', updated_at = NOW()${lease ? leaseSetSql(2) : ''} WHERE t.id = $1 AND ${parkedTaskCondition('t')} RETURNING t.id`,
            lease ? [taskId, lease.owner, lease.leaseMs / 1000] : [taskId],
        );
        if ((r.rowCount ?? 0) === 0) return false;
        await this.recordEvent(taskId, 'paused', 'pending', 'hitl_park_resume');
        return true;
    }

    /** 주차 중인 작업 목록 — 스윕이 결정 도착(재개)·만료(실패)·대기(워크스페이스 유지)로 나눈다. */
    async listParkedTasks(limit = 200): Promise<ParkedTaskRow[]> {
        const r = await this.query<ParkedTaskRow>(
            `SELECT t.id, t.workspace_path, t.user_id, t.device_id,
                    (SELECT e.reason FROM agent_task_events e WHERE e.task_id = t.id ORDER BY e.id DESC LIMIT 1) AS reason,
                    (EXTRACT(EPOCH FROM (NOW() - (SELECT e.created_at FROM agent_task_events e WHERE e.task_id = t.id ORDER BY e.id DESC LIMIT 1))) * 1000)::bigint AS waited_ms,
                    EXISTS (SELECT 1 FROM agent_task_approvals a WHERE a.task_id = t.id AND a.status IN ('approved', 'rejected') AND a.consumed_at IS NULL) AS has_decision,
                    EXISTS (SELECT 1 FROM agent_task_approvals a WHERE a.task_id = t.id AND a.status = 'pending' AND a.expires_at > NOW()) AS has_live_pending
               FROM agent_tasks t WHERE ${parkedTaskCondition('t')} ORDER BY t.updated_at ASC LIMIT $1`,
            [limit],
        );
        return r.rows;
    }

    async getAgentTaskEvents(taskId: string, limit = 200): Promise<Array<{ id: number; from_status: string | null; to_status: string; reason: string | null; created_at: string }>> {
        const r = await this.query<{ id: number; from_status: string | null; to_status: string; reason: string | null; created_at: string }>(
            'SELECT id, from_status, to_status, reason, created_at FROM agent_task_events WHERE task_id = $1 ORDER BY id ASC LIMIT $2',
            [taskId, limit],
        );
        return r.rows;
    }

    /**
     * 부팅 복구 대상 조회 — 재시작으로 in-process 루프가 소멸한 task.
     * schema-initializer 가 부팅 시 running/paused 를 failed('server restarted') 로 먼저 마킹하므로
     * 실제 대상은 대부분 ②다: ①잔존 running/paused(마킹 실패 대비) ②restart 마킹 + 최근 window 내
     * (과거 재시작이 남긴 오래된 failed 는 자동 resume 하지 않음 — 수동 resume 대상).
     * 오래된 것부터 복구(updated_at ASC).
     *
     * 'queued' 도 포함한다 — 큐(3-B)는 인메모리라 재시작하면 대기열이 증발하는데, DB 행은
     * 'queued' 로 남아 UI 가 영구 '대기 중' 을 그리고 아무도 실행하지 않았다(2026-08-25 발견).
     * queued 는 시작한 적이 없으므로 checkpoint 없이 처음부터 다시 디스패치한다.
     *
     * pending+lease = claim 과 running 사이에서 죽은 행(2026-10-22 R2) — claim 이 같은 문장에서 소유권을 쓰므로 소유권 있는 pending 은
     * 진행 중이던 claim 이다. 새로 만들어 실행한 적 없는 pending 은 소유권이 NULL 이라 빠진다. 소유권 컬럼을 읽으므로 owner 를 줄 때만.
     */
    async getInterruptedAgentTasks(windowMs: number, leaseOwner?: string): Promise<AgentTask[]> {
        // 실행 소유권(176) — 다른 서버가 살아 있는 소유권으로 실행 중인 작업은 중단된 것이 아니다. owner 없이 부르면 종전 조회.
        const notOthers = leaseOwner ? ` AND ${claimableLeaseSql('$2')}` : '';
        const claimOrphan = leaseOwner ? ` OR ${orphanedClaimSql('status', 'lease_until')}` : '';
        const result = await this.query<AgentTask>(
            `SELECT * FROM agent_tasks
             WHERE ((status IN ('running', 'paused', 'queued')${claimOrphan}) AND NOT ${parkedTaskCondition('agent_tasks')}${notOthers})
                OR (status = 'failed' AND error = 'server restarted'
                    AND completed_at > NOW() - make_interval(secs => $1))
             ORDER BY updated_at ASC`,
            leaseOwner ? [windowMs / 1000, leaseOwner] : [windowMs / 1000]
        );
        return result.rows;
    }

    /**
     * 복구 소유권 원자적 획득 — 복구 대상 상태인 task 만 pending 으로 전이하고 rowCount 로
     * 성공 여부 반환. 다중 프로세스가 동시에 복구를 시도해도 조건부 UPDATE 가 한 번만
     * 성공(나머지는 rowCount=0)해 이중 실행을 막는다. restart 마킹의 error/completed_at 도
     * 함께 정리(재개 task 가 목록에서 '실패·완료시각'으로 보이지 않게). expectedPrev: 목록을 읽을 때의 상태 — 그 뒤 바뀐 행은 0행.
     * lease: 같은 문장에서 실행 소유권도 쓴다 — claim 과 running 사이에서 죽어도 소유권 점검·부팅 복구가 이 pending 을 다시 잡는다
     * (2026-10-22 R2). 소유권 있는 pending(진행 중이던 claim)도 복구 대상이다 — 단 소유권이 지났거나 내 것일 때만(목록을 읽은 뒤 다른 서버가
     * 가져가 다시 claim 했으면 0행 — 두 곳이 같이 디스패치하지 않게). 소유권을 끄거나 176 적용 전이면 lease 없이 종전 문장.
     */
    async claimAgentTaskForRecovery(taskId: string, expectedPrev?: string, lease?: { owner: string; leaseMs: number }): Promise<boolean> {
        const claimOrphan = lease ? ` OR (${orphanedClaimSql('o.prev', 'o.lease_until')} AND (o.lease_until < NOW() OR o.lease_owner = $3))` : '';
        const result = await this.query<{ prev: string }>(
            `UPDATE agent_tasks t
             SET status = 'pending', error = NULL, failure_class = NULL, completed_at = NULL, updated_at = NOW()${lease ? leaseSetSql(3) : ''}
             FROM (SELECT id, status AS prev${lease ? ', lease_until, lease_owner' : ''} FROM agent_tasks WHERE id = $1 FOR UPDATE) o
             WHERE t.id = o.id AND ((o.prev IN ('running', 'paused', 'queued') AND NOT ${parkedTaskCondition('t')})${claimOrphan}
                OR (o.prev = 'failed' AND t.error = 'server restarted')) AND ($2::text IS NULL OR o.prev = $2)
             RETURNING o.prev`,
            lease ? [taskId, expectedPrev ?? null, lease.owner, lease.leaseMs / 1000] : [taskId, expectedPrev ?? null]
        );
        if ((result.rowCount ?? 0) === 0) return false;
        await this.recordEvent(taskId, result.rows[0]?.prev, 'pending', 'boot recovery claim');
        return true;
    }

    /**
     * 실패 큐 뷰(131) — 최근 failed 작업(분류 필터 선택)과 분류별 건수. 재처리는 기존 /resume.
     * goal 은 목록 표시용으로 앞부분만 싣는다.
     */
    async listFailedAgentTasks(opts: { failureClass?: string; sinceDays: number; limit: number }): Promise<{
        items: Array<{ id: string; user_id: string; goal: string; error: string | null; failure_class: string | null; priority: number; current_turn: number; updated_at: string }>;
        byClass: Record<string, number>;
    }> {
        const params: QueryParam[] = [opts.sinceDays];
        const classFilter = opts.failureClass ? `AND failure_class = $${params.push(opts.failureClass)}` : '';
        params.push(opts.limit);
        const items = await this.query<{ id: string; user_id: string; goal: string; error: string | null; failure_class: string | null; priority: number; current_turn: number; updated_at: string }>(
            `SELECT id, user_id, left(goal, 200) AS goal, error, failure_class, priority, current_turn, updated_at FROM agent_tasks
              WHERE status = 'failed' AND updated_at > NOW() - make_interval(days => $1) ${classFilter}
              ORDER BY updated_at DESC LIMIT $${params.length}`,
            params,
        );
        const counts = await this.query<{ c: string | null; n: string }>(
            `SELECT failure_class AS c, COUNT(*)::text AS n FROM agent_tasks
              WHERE status = 'failed' AND updated_at > NOW() - make_interval(days => $1) GROUP BY failure_class`,
            [opts.sinceDays],
        );
        return { items: items.rows, byClass: Object.fromEntries(counts.rows.map((r) => [r.c ?? 'unclassified', parseInt(r.n, 10)])) };
    }

    /** 활성 상태별 건수 — 큐 관측(/queue/stats) 용. 인메모리 큐 스냅샷과 대조해 재시작 고아를 드러낸다. */
    async countActiveAgentTasksByStatus(): Promise<Record<'queued' | 'running' | 'paused' | 'pending', number>> {
        const r = await this.query<{ status: string; n: string }>(
            `SELECT status, COUNT(*)::text AS n FROM agent_tasks
              WHERE status IN ('queued', 'running', 'paused', 'pending') GROUP BY status`,
        );
        const out = { queued: 0, running: 0, paused: 0, pending: 0 };
        for (const row of r.rows) {
            if (row.status in out) out[row.status as keyof typeof out] = parseInt(row.n, 10);
        }
        return out;
    }
}
