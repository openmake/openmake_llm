/**
 * Agent Task 승인 대기 영속 저장소 (Durable Task Runtime 1단계, 124).
 *
 * ApprovalRegistry(메모리 waiter)의 뒤에 붙는 저장소. 요청 시 pending 행을 만들고 결정·만료를
 * 기록한다. 프로세스가 내려간 동안 승인함(/approvals)이 pending 을 계속 보여 주고, 사용자가 그때
 * 내린 결정은 재개된 작업이 같은 호출을 다시 요청할 때 소비한다(consumed_at).
 *
 * 전부 fail-open 계약: 여기서 나는 오류가 승인 흐름(메모리 waiter)을 막지 않는다 — 호출부가 catch.
 *
 * @module data/repositories/agent-task-approval-repository
 */
import { createHash } from 'crypto';
import { BaseRepository } from './base-repository';

export type ApprovalRowStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'aborted' | 'revoked';
export type ApprovalEventKind = 'requested' | 'approved' | 'rejected' | 'answered' | 'revoked' | 'reassigned' | 'escalated' | 'expired' | 'aborted';

export interface ApprovalRow {
    approval_id: string;
    task_id: string;
    user_id: string;
    tool_name: string;
    args: Record<string, unknown> | null;
    args_hash: string;
    /** 위험 등급(config/tool-policy, 125) — 요청 시점 분류. 구 행은 NULL(조회 시 재분류). */
    risk_class: string | null;
    status: ApprovalRowStatus;
    answer_text: string | null;
    created_at: string;
    expires_at: string;
    decided_at: string | null;
    consumed_at: string | null;
    /** 138 */
    preview?: string | null;
    decided_by?: string | null;
    revoked_at?: string | null;
    assignee_user_id?: string | null;
    escalated_at?: string | null;
    escalation_reason?: string | null;
}

/** PURE: 같은 도구 호출을 재시작 후 다시 알아보기 위한 키 — 인자 JSON 의 sha256. */
export function hashApprovalArgs(args: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(args ?? {})).digest('hex');
}

export class AgentTaskApprovalRepository extends BaseRepository {
    async insertPending(row: {
        approvalId: string; taskId: string; userId: string; toolName: string;
        args: Record<string, unknown>; argsHash: string; timeoutMs: number; riskClass?: string;
    }): Promise<void> {
        await this.query(
            `INSERT INTO agent_task_approvals (approval_id, task_id, user_id, tool_name, args, args_hash, expires_at, risk_class)
             VALUES ($1, $2, $3, $4, $5, $6, NOW() + make_interval(secs => $7), $8)
             ON CONFLICT (approval_id) DO NOTHING`,
            [row.approvalId, row.taskId, row.userId, row.toolName, JSON.stringify(row.args ?? {}), row.argsHash, row.timeoutMs / 1000, row.riskClass ?? null],
        );
    }

    /** 결정 기록 — pending 행에만 적용(이미 결정된 행은 그대로). 성공 시 true. decidedBy 는 138. */
    async markDecided(approvalId: string, status: Exclude<ApprovalRowStatus, 'pending'>, answerText?: string, decidedBy?: string | null, consumed = false): Promise<boolean> {
        // consumed=true: 살아 있는 waiter 가 결정 즉시 실행한 경우 — 재시작 이어받기·철회 대상에서 제외(138)
        const r = await this.query(
            `UPDATE agent_task_approvals SET status = $2, answer_text = $3, decided_at = NOW(), decided_by = COALESCE($4, decided_by),
                    consumed_at = CASE WHEN $5 THEN NOW() ELSE consumed_at END
             WHERE approval_id = $1 AND status = 'pending'`,
            [approvalId, status, answerText ?? null, decidedBy ?? null, consumed],
        );
        return (r.rowCount ?? 0) > 0;
    }

    /**
     * 철회(138) — approved 이면서 아직 소비되지 않은 결정만 되돌린다(프로세스가 내려간 사이 내린 승인).
     * 살아 있는 waiter 는 결정 즉시 실행돼 되돌릴 수 없다 → 'consumed'.
     */
    async revokeUnconsumed(approvalId: string, actorId: string): Promise<'revoked' | 'consumed' | 'not_found'> {
        const r = await this.query(
            `UPDATE agent_task_approvals SET status = 'revoked', revoked_at = NOW(), decided_by = $2
             WHERE approval_id = $1 AND status = 'approved' AND consumed_at IS NULL`,
            [approvalId, actorId],
        );
        if ((r.rowCount ?? 0) > 0) return 'revoked';
        const exists = await this.query<{ status: string; consumed_at: string | null }>('SELECT status, consumed_at FROM agent_task_approvals WHERE approval_id = $1', [approvalId]);
        if (!exists.rows[0]) return 'not_found';
        return 'consumed';
    }

    /** 최근 결정(승인함 "최근 결정" 섹션) — approved/revoked, 소유자 기준. revocable = approved 이고 미소비. */
    async listRecentDecisions(userId: string, sinceMs: number, limit = 50): Promise<Array<ApprovalRow & { revocable: boolean }>> {
        const r = await this.query<ApprovalRow & { revocable: boolean }>(
            `SELECT *, (status = 'approved' AND consumed_at IS NULL) AS revocable FROM agent_task_approvals
             WHERE user_id = $1 AND status IN ('approved', 'revoked') AND decided_at >= NOW() - make_interval(secs => $2)
             ORDER BY decided_at DESC LIMIT $3`,
            [userId, sinceMs / 1000, limit],
        );
        return r.rows;
    }

    /** 승인 이벤트(138) — 실패는 호출부가 삼킨다. */
    async recordEvent(approvalId: string, kind: ApprovalEventKind, actorId: string | null, detail?: Record<string, unknown>): Promise<void> {
        await this.query(
            'INSERT INTO agent_task_approval_events (approval_id, actor_id, kind, detail) VALUES ($1, $2, $3, $4::jsonb)',
            [approvalId, actorId, kind, JSON.stringify(detail ?? {})],
        );
    }

    /** 사용자의 살아 있는 pending 행(만료 전). 프로세스가 내려간 작업의 대기도 여기 남아 있다. */
    async listPending(userId: string): Promise<ApprovalRow[]> {
        const r = await this.query<ApprovalRow>(
            `SELECT * FROM agent_task_approvals
             WHERE user_id = $1 AND status = 'pending' AND expires_at > NOW()
             ORDER BY created_at ASC`,
            [userId],
        );
        return r.rows;
    }

    async getPending(approvalId: string): Promise<ApprovalRow | undefined> {
        const r = await this.query<ApprovalRow>(
            `SELECT * FROM agent_task_approvals WHERE approval_id = $1 AND status = 'pending' AND expires_at > NOW()`,
            [approvalId],
        );
        return r.rows[0];
    }

    /**
     * 재시작 후 이어받기 — 같은 호출(task+tool+args)의 가장 최근 행 중 ① 미소비 결정(approved/
     * rejected) 또는 ② 아직 살아 있는 pending 을 돌려준다. 결정 행은 소비 표시해 1회만 쓴다.
     */
    async takeoverForCall(taskId: string, toolName: string, argsHash: string): Promise<ApprovalRow | undefined> {
        const decided = await this.query<ApprovalRow>(
            `UPDATE agent_task_approvals SET consumed_at = NOW()
             WHERE approval_id = (
                 SELECT approval_id FROM agent_task_approvals
                 WHERE task_id = $1 AND tool_name = $2 AND args_hash = $3
                   AND status IN ('approved', 'rejected') AND consumed_at IS NULL
                 ORDER BY decided_at DESC LIMIT 1)
             RETURNING *`,
            [taskId, toolName, argsHash],
        );
        if (decided.rows[0]) return decided.rows[0];
        const pending = await this.query<ApprovalRow>(
            `SELECT * FROM agent_task_approvals
             WHERE task_id = $1 AND tool_name = $2 AND args_hash = $3 AND status = 'pending' AND expires_at > NOW()
             ORDER BY created_at DESC LIMIT 1`,
            [taskId, toolName, argsHash],
        );
        return pending.rows[0];
    }

    /** 작업 종료 시 남은 pending 을 정리 — 승인함에 죽은 요청이 남지 않게. */
    async expirePendingForTask(taskId: string, status: 'expired' | 'aborted' = 'aborted'): Promise<void> {
        await this.query(
            `UPDATE agent_task_approvals SET status = $2, decided_at = NOW() WHERE task_id = $1 AND status = 'pending'`,
            [taskId, status],
        );
    }
}
