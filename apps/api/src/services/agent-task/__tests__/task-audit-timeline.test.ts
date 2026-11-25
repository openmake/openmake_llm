/**
 * 작업 단위 감사 타임라인(T-10) — 네 출처(상태 전이·승인·스텝·감사 행)를 시각순 한 줄로 합치고,
 * 같은 시각이면 원인(전이 → 승인) 이 결과(스텝 → 감사) 보다 앞에 온다. 같은 호출은 인자 해시로 맞춰 볼 수 있다.
 */
import { buildTaskAuditTimeline } from '../task-audit-timeline';
import type { TaskAuditSources } from '../../../data/repositories/agent-task-audit-repository';

const T = (s: number): Date => new Date(Date.UTC(2026, 10, 25, 0, 0, s));
const H = 'a'.repeat(64);

function sources(): TaskAuditSources {
    return {
        events: [
            { id: 1, from_status: 'pending', to_status: 'running', reason: null, created_at: T(0) },
            { id: 2, from_status: 'running', to_status: 'completed', reason: null, created_at: T(9) },
        ],
        approvals: [{
            approval_id: 'ap1', user_id: 'u1', tool_name: 'write_file', args_hash: H, risk_class: 'write', status: 'approved',
            created_at: T(2), decided_at: T(3), consumed_at: T(4),
        }],
        steps: [
            { id: 10, step_number: 1, step_type: 'assistant_tool_call', tool_name: 'write_file', tool_call_id: 'c1', status: 'completed', args_hash: H, is_error: null, created_at: T(2) },
            { id: 11, step_number: 2, step_type: 'tool_result', tool_name: 'write_file', tool_call_id: 'c1', status: 'completed', args_hash: null, is_error: false, created_at: T(5) },
            { id: 12, step_number: 3, step_type: 'tool_result', tool_name: 'web_search', tool_call_id: 'c2', status: 'completed', args_hash: null, is_error: true, created_at: T(6) },
        ],
        auditLogs: [{
            id: 99, timestamp: T(5), action: 'mcp_tool_call', user_id: 'u1', resource_type: 'mcp_builtin_tool', resource_id: 'write_file',
            details: { argsHash: H, taskId: 't1', approvalPolicy: 'all', riskClass: 'write' }, chain_seq: '42', row_hash: 'h',
        }],
    };
}

describe('buildTaskAuditTimeline', () => {
    it('시각순 + 같은 시각은 state → approval → step → audit', () => {
        const tl = buildTaskAuditTimeline('t1', sources(), 2000);
        expect(tl.entries.map((e) => `${e.kind}:${e.type}`)).toEqual([
            'state:transition', 'approval:requested', 'step:assistant_tool_call', 'approval:decided', 'approval:consumed',
            'step:tool_result', 'audit:mcp_tool_call', 'step:tool_result', 'state:transition',
        ]);
    });

    it('같은 호출은 승인·스텝·감사가 같은 인자 해시를 가진다', () => {
        const tl = buildTaskAuditTimeline('t1', sources(), 2000);
        const hashes = tl.entries.filter((e) => e.tool === 'write_file' && e.argsHash).map((e) => `${e.kind}:${e.argsHash}`);
        expect(new Set(hashes.map((h) => h.split(':')[1]))).toEqual(new Set([H]));
        expect(new Set(hashes.map((h) => h.split(':')[0]))).toEqual(new Set(['approval', 'step', 'audit']));
    });

    it('요약: 전이·승인 상태별·도구 호출·실패·감사 행·체인 행', () => {
        const tl = buildTaskAuditTimeline('t1', sources(), 2000);
        expect(tl.summary).toEqual({
            transitions: 2, approvals: { total: 1, byStatus: { approved: 1 } }, toolCalls: 2, toolErrors: 1, auditRows: 1, chainedAuditRows: 1,
        });
        expect(tl.entries.find((e) => e.kind === 'audit')?.detail.chainSeq).toBe(42);
        expect(tl.truncated).toBe(false);
    });

    it('첫 턴(plan)에 한 번 부르고 끝난 작업도 호출 1건으로 센다 — assistant_tool_call 행이 없어도(staging 라이브 재현)', () => {
        const src = sources();
        src.steps = [
            { id: 1, step_number: 0, step_type: 'plan', tool_name: 'web_search', tool_call_id: null, status: 'completed', args_hash: null, is_error: null, created_at: T(1) },
            { id: 2, step_number: 1, step_type: 'tool_result', tool_name: 'web_search', tool_call_id: 'c1', status: 'completed', args_hash: H, is_error: false, created_at: T(2) },
        ];
        const tl = buildTaskAuditTimeline('t1', src, 2000);
        expect(tl.summary).toMatchObject({ toolCalls: 1, toolErrors: 0 });
        expect(tl.entries.some((e) => e.kind === 'step' && e.type === 'plan' && e.tool === 'web_search')).toBe(true);
    });

    it('출처 하나라도 상한에 닿으면 truncated', () => {
        expect(buildTaskAuditTimeline('t1', sources(), 2).truncated).toBe(true);
    });

    it('빈 작업도 형태를 유지한다', () => {
        const tl = buildTaskAuditTimeline('t0', { events: [], approvals: [], steps: [], auditLogs: [] }, 2000);
        expect(tl).toMatchObject({ taskId: 't0', entries: [], truncated: false, summary: { toolCalls: 0, chainedAuditRows: 0 } });
    });
});
