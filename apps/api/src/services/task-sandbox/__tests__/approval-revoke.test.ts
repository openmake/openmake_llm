/**
 * 승인 철회(138) — "아직 실행되지 않은 허가" 만 되돌린다.
 */
import { ApprovalRegistry, type ApprovalStore } from '../approval-gate';
import type { ApprovalRow } from '../../../data/repositories/agent-task-approval-repository';

function fakeStore() {
    const rows = new Map<string, ApprovalRow>();
    const events: Array<{ id: string; kind: string }> = [];
    const row = (p: Partial<ApprovalRow> & { approval_id: string }): ApprovalRow => ({
        task_id: 't1', user_id: 'u1', tool_name: 'bash', args: { command: 'ls' }, args_hash: 'h', risk_class: null, status: 'pending',
        answer_text: null, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(),
        decided_at: null, consumed_at: null, ...p,
    });
    const store: ApprovalStore & { rows: Map<string, ApprovalRow>; events: typeof events; seed: (p: Partial<ApprovalRow> & { approval_id: string }) => void } = {
        rows, events,
        seed: (p) => { rows.set(p.approval_id, row(p)); },
        insertPending: async (r) => { rows.set(r.approvalId, row({ approval_id: r.approvalId, task_id: r.taskId, user_id: r.userId, tool_name: r.toolName, args: r.args, args_hash: r.argsHash })); },
        markDecided: async (id, status, text, _by, consumed) => { const r = rows.get(id); if (!r || r.status !== 'pending') return false; r.status = status; r.answer_text = text ?? null; r.decided_at = new Date().toISOString(); if (consumed) r.consumed_at = new Date().toISOString(); return true; },
        listPending: async (userId) => [...rows.values()].filter((r) => r.user_id === userId && r.status === 'pending'),
        getPending: async (id) => { const r = rows.get(id); return r && r.status === 'pending' ? r : undefined; },
        takeoverForCall: async (taskId, toolName, argsHash) => {
            const same = [...rows.values()].filter((r) => r.task_id === taskId && r.tool_name === toolName && r.args_hash === argsHash);
            const decided = same.find((r) => (r.status === 'approved' || r.status === 'rejected') && !r.consumed_at);
            if (decided) { decided.consumed_at = new Date().toISOString(); return decided; }
            return same.find((r) => r.status === 'pending');
        },
        expirePendingForTask: async () => undefined,
        revokeUnconsumed: async (id) => { const r = rows.get(id); if (!r) return 'not_found'; if (r.status === 'approved' && !r.consumed_at) { r.status = 'revoked'; return 'revoked'; } return 'consumed'; },
        listRecentDecisions: async (userId) => [...rows.values()].filter((r) => r.user_id === userId && (r.status === 'approved' || r.status === 'revoked')).map((r) => ({ ...r, revocable: r.status === 'approved' && !r.consumed_at })),
        recordEvent: async (id, kind) => { events.push({ id, kind }); },
    };
    return store;
}
const input = { taskId: 't1', userId: 'u1', toolName: 'bash', args: { command: 'ls' } };

describe('ApprovalRegistry.revoke', () => {
    it('프로세스가 내려간 사이 내린 미소비 승인은 철회되고, 재개된 작업은 다시 대기한다', async () => {
        const store = fakeStore();
        const reg = new ApprovalRegistry(store);
        store.seed({ approval_id: 'a1', status: 'approved', decided_at: new Date().toISOString() });
        expect(await reg.revoke('a1', 'u1')).toBe('revoked');
        expect(store.rows.get('a1')?.status).toBe('revoked');
        expect(store.events.some((e) => e.id === 'a1' && e.kind === 'revoked')).toBe(true);
        // 같은 호출을 다시 요청하면 revoked 행은 이어받지 않고 새 pending 이 생긴다
        let id = '';
        const p = reg.request(input, { timeoutMs: 5000, onPending: (pa) => { id = pa.approvalId; } });
        await new Promise((r) => setImmediate(r));
        expect(id).not.toBe('a1');
        expect(store.rows.get(id)?.status).toBe('pending');
        await reg.reject(id, 'u1'); await p;
    });

    it('살아 있는 대기(waiter)는 결정 즉시 실행되므로 철회 불가(consumed)', async () => {
        const store = fakeStore();
        const reg = new ApprovalRegistry(store);
        let id = '';
        const p = reg.request(input, { timeoutMs: 5000, onPending: (pa) => { id = pa.approvalId; } });
        await new Promise((r) => setImmediate(r));
        expect(await reg.revoke(id, 'u1')).toBe('consumed');
        await reg.approve(id, 'u1'); await p;
        expect(await reg.revoke(id, 'u1')).toBe('consumed');
    });

    it('없는 id 는 not_found, recent 는 approved/revoked 만', async () => {
        const store = fakeStore();
        const reg = new ApprovalRegistry(store);
        expect(await reg.revoke('nope', 'u1')).toBe('not_found');
        store.seed({ approval_id: 'r1', status: 'approved' }); store.seed({ approval_id: 'r2', status: 'rejected' });
        const recent = await reg.recent('u1', 60_000);
        expect(recent.map((r) => r.approval_id)).toEqual(['r1']);
        expect(recent[0].revocable).toBe(true);
    });
});
