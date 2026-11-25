/**
 * 작업 단위 감사 조회(하네스 P2 감사 무결성·수용 테스트 T-10) — 한 작업의 상태 전이·승인·도구 호출·감사 행을 읽는다.
 *
 * 네 출처를 따로 읽고 합치는 것은 services/agent-task/task-audit-timeline(PURE)이 한다. 여기는 SQL 만:
 *  - agent_task_events  : 상태 전이(task-state 전이표가 강제)
 *  - agent_task_approvals: 승인 요청·결정·소비(인자 원문은 읽지 않는다 — args_hash 만)
 *  - agent_task_steps   : 도구 호출·결과와 판정류 스텝(본문은 읽지 않는다 — 종류·도구·호출 id·인자 해시·실패 여부만)
 *  - audit_logs         : details.taskId 가 이 작업인 행(도구 호출 감사 mcp_tool_call 등) + resource 가 이 작업인 행
 *
 * @module data/repositories/agent-task-audit-repository
 */
import { BaseRepository } from './base-repository';
import { hashToolArgs } from '../../utils/args-hash';

type TaskAuditStepRawRow = Omit<TaskAuditStepRow, 'args_hash'> & { tool_args: unknown } & Record<string, unknown>;

/** 인자 → 해시(없거나 객체가 아니면 null, 해시 불가면 'unhashable' — tool-execution-guard 와 같은 규칙). */
function argsHashOrNull(args: unknown): string | null {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
    try { return hashToolArgs(args as Record<string, unknown>); } catch { return 'unhashable'; }
}

/**
 * 타임라인에 싣는 스텝 종류 — 본문은 어느 것도 읽지 않는다(종류·도구·호출 id·해시·실패 여부만).
 * 호출 의도는 턴 단위 행이다: 첫 턴은 'plan', 이후 도구를 부른 턴은 'assistant_tool_call'(tool_name 은 그 턴 호출 묶음의
 * 콤마 결합, tool_args 는 배열이라 args_hash 는 null). 호출 단위 인자 해시는 tool_result 행에 있다 — 승인·도구 호출 감사와
 * 맞추는 쪽은 그 행이다. 도구 없이 답만 한 턴('assistant')·사고('thinking')는 뺀다.
 */
export const TASK_AUDIT_STEP_TYPES: readonly string[] = [
    'plan', 'assistant_tool_call', 'tool_result', 'judge', 'judge_shadow', 'test_verify', 'verify_skipped', 'diff', 'artifact',
    'retry', 'hitl_degrade', 'final_turn', 'sandbox_unavailable', 'sandbox_wait', 'steering',
];

/** 한 작업에서 읽는 행 수 상한(출처별). */
export const TASK_AUDIT_MAX_ROWS_PER_SOURCE = 2000;

export interface TaskAuditEventRow { id: string | number; from_status: string | null; to_status: string; reason: string | null; created_at: Date }
export interface TaskAuditApprovalRow {
    approval_id: string; user_id: string; tool_name: string; args_hash: string; risk_class: string | null; status: string;
    created_at: Date; decided_at: Date | null; consumed_at: Date | null;
}
export interface TaskAuditStepRow {
    id: string | number; step_number: number; step_type: string; tool_name: string | null; tool_call_id: string | null;
    status: string | null; args_hash: string | null; is_error: boolean | null; created_at: Date;
}
export interface TaskAuditLogRow {
    id: string | number; timestamp: Date; action: string; user_id: string | null; resource_type: string | null;
    resource_id: string | null; details: Record<string, unknown> | null; chain_seq: string | number | null; row_hash: string | null;
}

export interface TaskAuditSources {
    events: TaskAuditEventRow[];
    approvals: TaskAuditApprovalRow[];
    steps: TaskAuditStepRow[];
    auditLogs: TaskAuditLogRow[];
}

export class AgentTaskAuditRepository extends BaseRepository {
    async loadSources(taskId: string, limit = TASK_AUDIT_MAX_ROWS_PER_SOURCE): Promise<TaskAuditSources> {
        const [events, approvals, steps, auditLogs] = await Promise.all([
            this.query<TaskAuditEventRow & Record<string, unknown>>(
                `SELECT id, from_status, to_status, reason, created_at FROM agent_task_events
                  WHERE task_id = $1 ORDER BY id ASC LIMIT $2`, [taskId, limit]),
            this.query<TaskAuditApprovalRow & Record<string, unknown>>(
                `SELECT approval_id, user_id, tool_name, args_hash, risk_class, status, created_at, decided_at, consumed_at
                   FROM agent_task_approvals WHERE task_id = $1 ORDER BY created_at ASC LIMIT $2`, [taskId, limit]),
            // 인자는 해시로만 내보낸다(아래 map) — 승인(args_hash)·도구 호출 감사(details.argsHash)와 같은 hashToolArgs 라
            // 세 출처의 같은 호출을 해시로 맞춰 볼 수 있다. 실패 여부는 결과 본문 머리('Error')만 본다.
            this.query<TaskAuditStepRawRow>(
                `SELECT id, step_number, step_type, tool_name, tool_call_id, status, tool_args,
                        CASE WHEN step_type = 'tool_result' THEN left(coalesce(content, ''), 5) = 'Error' ELSE NULL END AS is_error,
                        created_at
                   FROM agent_task_steps WHERE task_id = $1 AND step_type = ANY($2::text[])
                  ORDER BY id ASC LIMIT $3`, [taskId, [...TASK_AUDIT_STEP_TYPES], limit]),
            this.query<TaskAuditLogRow & Record<string, unknown>>(
                `SELECT id, timestamp, action, user_id, resource_type, resource_id, details - 'actor' AS details, chain_seq, row_hash
                   FROM audit_logs
                  WHERE (details ? 'taskId' AND details->>'taskId' = $1)
                     OR (resource_type = 'agent_task' AND resource_id = $1)
                  ORDER BY timestamp ASC, id ASC LIMIT $2`, [taskId, limit]),
        ]);
        return {
            events: events.rows, approvals: approvals.rows, auditLogs: auditLogs.rows,
            steps: steps.rows.map(({ tool_args, ...r }) => ({ ...r, args_hash: argsHashOrNull(tool_args) })),
        };
    }
}
