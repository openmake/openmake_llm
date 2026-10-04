/**
 * 에이전트 작업 주차 조회 — 주차 사유와 기기 대기 작업 목록 (Companion P1-4·1-7).
 * 주차 표식·재개 claim·스윕 목록은 agent-task-repository 에 있다(파일 크기 가드로 조회만 나눴다).
 *
 * @module data/repositories/agent-task-park-repository
 */
import { BaseRepository } from './base-repository';
import { AGENT_TASK_DEVICE_WAIT_REASON, AGENT_TASK_PARK_REASONS } from '../../config/agent-task-park-reasons';

/** 주차 스윕이 보는 행 — reason·waited_ms 는 마지막 전이 이벤트(주차 표식) 기준. */
export interface ParkedTaskRow {
    id: string;
    workspace_path: string | null;
    reason: string | null;
    /** bigint 라 pg 가 문자열로 준다 */
    waited_ms: string | number | null;
    has_decision: boolean;
    has_live_pending: boolean;
}

export class AgentTaskParkRepository extends BaseRepository {
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
