/**
 * 에이전트 작업 주차 조회 — 주차 사유와 기기 대기 작업 목록 (Companion P1-4·1-7).
 * 주차 표식·재개 claim·스윕 목록은 agent-task-repository 에 있다(파일 크기 가드로 조회만 나눴다).
 *
 * @module data/repositories/agent-task-park-repository
 */
import { BaseRepository } from './base-repository';
import { AGENT_TASK_DEVICE_WAIT_REASON, AGENT_TASK_PARK_REASONS } from '../../config/agent-task-park-reasons';
import { RECOVERY_CLAIM_REASON } from './agent-task-run-repository';

/** 주차 스윕이 보는 행 — reason·waited_ms 는 마지막 전이 이벤트(주차 표식) 기준. */
export interface ParkedTaskRow {
    id: string;
    workspace_path: string | null;
    /** 넘겨받기 주차의 재개 판단용 — 작업의 사용자·지정 기기 */
    user_id?: string | number | null;
    device_id?: string | null;
    reason: string | null;
    /** bigint 라 pg 가 문자열로 준다 */
    waited_ms: string | number | null;
    has_decision: boolean;
    has_live_pending: boolean;
}

export class AgentTaskParkRepository extends BaseRepository {
    /** 시작 요청의 승인 정책을 남긴다(183) — 주차에서 재개될 때 같은 정책으로 이어가게. */
    async setApprovalPolicy(taskId: string, policy: string): Promise<void> {
        await this.query('UPDATE agent_tasks SET approval_policy = $2 WHERE id = $1', [taskId, policy]);
    }

    /** 실행 요청의 추론 수준을 남긴다(184) — 재개·분기될 때 같은 수준으로 이어가게. */
    async setThinkingLevel(taskId: string, level: string): Promise<void> {
        await this.query('UPDATE agent_tasks SET thinking_level = $2 WHERE id = $1', [taskId, level]);
    }

    /** 주차 중인 작업의 사유(hitl_parked·device_wait) — 주차가 아니면 null. 화면이 "무엇을 기다리는지" 보여 주는 데 쓴다. */
    async getParkReason(taskId: string): Promise<string | null> {
        const r = await this.query<{ reason: string | null }>(
            `SELECT (SELECT e.reason FROM agent_task_events e WHERE e.task_id = t.id ORDER BY e.id DESC LIMIT 1) AS reason
               FROM agent_tasks t WHERE t.id = $1 AND t.status = 'paused'`,
            [taskId],
        );
        const reason = r.rows[0]?.reason ?? null;
        return reason && AGENT_TASK_PARK_REASONS.includes(reason) ? reason : null;
    }

    /** 그 사용자의 작업 중 주어진 사유로 주차된 것 — 지정 기기와 함께(넘겨받기를 돌려받으면 재개를 시도한다). */
    async listParkedTaskIdsByReason(userId: string, reason: string, limit = 50): Promise<Array<{ id: string; device_id: string | null }>> {
        const r = await this.query<{ id: string; device_id: string | null }>(
            `SELECT t.id, t.device_id FROM agent_tasks t
              WHERE t.user_id = $1 AND t.status = 'paused'
                AND COALESCE((SELECT e.reason FROM agent_task_events e WHERE e.task_id = t.id ORDER BY e.id DESC LIMIT 1), '') = $2
              ORDER BY t.updated_at ASC LIMIT $3`,
            [userId, reason, limit],
        );
        return r.rows;
    }

    /**
     * 재시작으로 끊긴 로컬 기기 작업을 기기 대기로 주차한다(boot-recovery) — 복구가 읽은 상태(expectedPrev) 그대로인 중단 작업
     * (running·paused·queued 잔존, failed('server restarted'))만 paused 로 바꾸고 이전 종료 기록·알림 표식을 지운다. 체크포인트는 그대로다.
     * 복구 이벤트(진행 없는 복구 횟수에 든다)와 주차 표식을 같은 문장에서 이 순서로 남긴다 — 표식이 마지막 이벤트여야 주차로 읽히고,
     * 표식 없는 paused 는 아무도 재개하지 않는다. 그 사이 /execute·/resume·다른 서버의 복구가 잡았으면 0행(false)이고 건드리지 않는다.
     */
    async parkForDeviceRecovery(taskId: string, expectedPrev: string): Promise<boolean> {
        // (2026-10-22 R2) 소유권 있는 pending 은 claim 중 죽은 행 — pending 을 읽었을 때만 소유권 컬럼을 본다(176 적용 전 폴백은 pending 을 넘기지 않는다)
        const leased = expectedPrev === 'pending';
        const r = await this.query(
            `WITH parked AS (
                 UPDATE agent_tasks t SET status = 'paused', error = NULL, failure_class = NULL, completed_at = NULL, terminal_notify_pending = FALSE, updated_at = NOW()
                 FROM (SELECT id, status AS prev, error AS prev_error${leased ? ', lease_until' : ''} FROM agent_tasks WHERE id = $1 FOR UPDATE) o
                 WHERE t.id = o.id AND o.prev = $2 AND (o.prev IN ('running', 'paused', 'queued') OR (o.prev = 'failed' AND o.prev_error = $3)${leased ? " OR (o.prev = 'pending' AND o.lease_until IS NOT NULL)" : ''})
                 RETURNING t.id, o.prev
             ), claimed AS (
                 INSERT INTO agent_task_events (task_id, from_status, to_status, reason) SELECT id, prev, 'paused', $4 FROM parked RETURNING task_id
             )
             INSERT INTO agent_task_events (task_id, from_status, to_status, reason) SELECT task_id, 'paused', 'paused', $5 FROM claimed RETURNING id`,
            [taskId, expectedPrev, 'server restarted', RECOVERY_CLAIM_REASON, AGENT_TASK_DEVICE_WAIT_REASON],
        );
        return (r.rowCount ?? 0) > 0;
    }

    /** 기기 대기(device_wait)로 주차된 그 사용자의 작업 id — 기기가 등록되면 재개를 시도한다. */
    async listDeviceWaitTaskIds(userId: string, limit = 50): Promise<string[]> {
        const r = await this.query<{ id: string }>(
            `SELECT t.id FROM agent_tasks t
              WHERE t.user_id = $1 AND t.status = 'paused'
                AND COALESCE((SELECT e.reason FROM agent_task_events e WHERE e.task_id = t.id ORDER BY e.id DESC LIMIT 1), '') = $2
              ORDER BY t.updated_at ASC LIMIT $3`,
            [userId, AGENT_TASK_DEVICE_WAIT_REASON, limit],
        );
        return r.rows.map((row) => row.id);
    }
}
