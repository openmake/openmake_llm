/**
 * 작업 단위 감사 타임라인(하네스 P2 감사 무결성·수용 테스트 T-10) — PURE.
 *
 * 저장소(agent-task-audit-repository)가 읽은 네 출처를 시각순 한 줄로 합친다. 같은 도구 호출은 출처가 달라도
 * 인자 해시(hashToolArgs)가 같아 맞춰 볼 수 있다: 승인 args_hash = 스텝 argsHash = 도구 호출 감사 details.argsHash.
 * 응답에는 인자 원문·결과 본문을 싣지 않는다(해시·종류·판정만).
 *
 * @module services/agent-task/task-audit-timeline
 */
import type { TaskAuditSources } from '../../data/repositories/agent-task-audit-repository';

export type TaskAuditEntryKind = 'state' | 'approval' | 'step' | 'audit';

export interface TaskAuditEntry {
    at: string;
    kind: TaskAuditEntryKind;
    /** 출처 안에서의 종류 — state: 'transition', approval: 'requested'·'decided'·'consumed', step: step_type, audit: action */
    type: string;
    tool?: string | null;
    toolCallId?: string | null;
    argsHash?: string | null;
    detail: Record<string, unknown>;
}

export interface TaskAuditTimeline {
    taskId: string;
    entries: TaskAuditEntry[];
    summary: {
        transitions: number;
        approvals: { total: number; byStatus: Record<string, number> };
        /** 실행된 도구 호출 수(tool_result 행) — 거절·중단으로 실행되지 않은 호출은 승인 항목·턴 스텝에만 보인다. */
        toolCalls: number;
        toolErrors: number;
        auditRows: number;
        /** 해시 체인에 든 감사 행 수(AUDIT_HASH_CHAIN_ENABLED) — 0 이면 체인 꺼짐 또는 체인 밖 행뿐. */
        chainedAuditRows: number;
    };
    /** 출처 중 하나라도 행 수 상한에 닿았으면 true — 타임라인이 잘렸을 수 있다. */
    truncated: boolean;
}

const iso = (d: Date | string): string => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

export function buildTaskAuditTimeline(taskId: string, src: TaskAuditSources, maxRowsPerSource: number): TaskAuditTimeline {
    const entries: TaskAuditEntry[] = [];
    for (const e of src.events) {
        entries.push({ at: iso(e.created_at), kind: 'state', type: 'transition', detail: { from: e.from_status, to: e.to_status, reason: e.reason } });
    }
    const byStatus: Record<string, number> = {};
    for (const a of src.approvals) {
        byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
        const base = { tool: a.tool_name, argsHash: a.args_hash };
        entries.push({ at: iso(a.created_at), kind: 'approval', type: 'requested', ...base,
            detail: { approvalId: a.approval_id, riskClass: a.risk_class, requestedBy: a.user_id } });
        if (a.decided_at) entries.push({ at: iso(a.decided_at), kind: 'approval', type: 'decided', ...base, detail: { approvalId: a.approval_id, status: a.status } });
        if (a.consumed_at) entries.push({ at: iso(a.consumed_at), kind: 'approval', type: 'consumed', ...base, detail: { approvalId: a.approval_id } });
    }
    let toolCalls = 0;
    let toolErrors = 0;
    for (const s of src.steps) {
        // 실행된 호출 = tool_result 행. assistant_tool_call 은 턴 단위(그 턴의 호출 묶음) 이고 첫 턴은 'plan' 으로 남아
        // 호출 수로 쓰면 첫 턴 호출이 빠진다(staging 라이브 확인에서 1회 호출 작업이 0 으로 나왔다).
        if (s.step_type === 'tool_result') {
            toolCalls += 1;
            if (s.is_error) toolErrors += 1;
        }
        entries.push({
            at: iso(s.created_at), kind: 'step', type: s.step_type, tool: s.tool_name, toolCallId: s.tool_call_id, argsHash: s.args_hash,
            detail: { stepNumber: s.step_number, status: s.status, ...(s.is_error === null ? {} : { ok: !s.is_error }) },
        });
    }
    let chained = 0;
    for (const l of src.auditLogs) {
        if (l.chain_seq !== null) chained += 1;
        const d = l.details ?? {};
        entries.push({
            at: iso(l.timestamp), kind: 'audit', type: l.action, tool: l.resource_id,
            argsHash: typeof d.argsHash === 'string' ? d.argsHash : null,
            detail: { ...d, ...(l.chain_seq !== null ? { chainSeq: Number(l.chain_seq) } : {}) },
        });
    }
    // 같은 시각이면 넣은 순서(상태 전이 → 승인 → 스텝 → 감사 — 원인이 결과보다 앞)를 지킨다: Array.sort 는 안정 정렬이다.
    entries.sort((x, y) => (x.at === y.at ? 0 : x.at < y.at ? -1 : 1));
    const truncated = [src.events, src.approvals, src.steps, src.auditLogs].some((rows) => rows.length >= maxRowsPerSource);
    return {
        taskId,
        entries,
        summary: {
            transitions: src.events.length,
            approvals: { total: src.approvals.length, byStatus },
            toolCalls,
            toolErrors,
            auditRows: src.auditLogs.length,
            chainedAuditRows: chained,
        },
        truncated,
    };
}
