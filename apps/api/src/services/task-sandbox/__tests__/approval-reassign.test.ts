/** 담당자 이관(138) — 승인함은 담당자(없으면 소유자)에게 보이고, 결정 채널은 그대로다. */
import { ApprovalRegistry, type ApprovalStore } from '../approval-gate';
import type { ApprovalRow } from '../../../data/repositories/agent-task-approval-repository';

function fakeStore() {
    const rows = new Map<string, ApprovalRow>();
    const row = (p: Partial<ApprovalRow> & { approval_id: string }): ApprovalRow => ({
        task_id: 't1', user_id: 'owner', tool_name: 'bash', args: { command: 'ls' }, args_hash: 'h', risk_class: null, status: 'pending',
        answer_text: null, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(), decided_at: null, consumed_at: null, ...p,
    });
    const store: ApprovalStore & { rows: Map<string, ApprovalRow> } = {
        rows,
        insertPending: async (r) => { rows.set(r.approvalId, row({ approval_id: r.approvalId, task_id: r.taskId, user_id: r.userId, tool_name: r.toolName, args: r.args, args_hash: r.argsHash })); },
        markDecided: async (id, status) => { const r = rows.get(id); if (!r || r.status !== 'pending') return false; r.status = status; return true; },
        listPending: async (userId) => [...rows.values()].filter((r) => (r.assignee_user_id ?? r.user_id) === userId && r.status === 'pending'),
        getPending: async (id) => { const r = rows.get(id); return r && r.status === 'pending' ? r : undefined; },
        takeoverForCall: async () => undefined,
        expirePendingForTask: async () => undefined,
        reassign: async (id, to, o) => { const r = rows.get(id); if (!r || r.status !== 'pending') return false; r.assignee_user_id = to; if (o?.escalate) r.escalated_at = new Date().toISOString(); return true; },
        recordEvent: async () => undefined,
    };
    return store;
}
const input = { taskId: 't1', userId: 'owner', toolName: 'bash', args: { command: 'ls' } };

describe('ApprovalRegistry.reassign', () => {
    it('이관 후 소유자 목록에서 빠지고 담당자 목록에 나타나며, 담당자의 승인으로 해소된다', async () => {
        const store = fakeStore(); const reg = new ApprovalRegistry(store);
        let id = '';
        const p = reg.request(input, { timeoutMs: 5000, onPending: (pa) => { id = pa.approvalId; } });
        await new Promise((r) => setImmediate(r));
        expect((await reg.list('owner')).map((x) => x.approvalId)).toEqual([id]);
        expect(await reg.reassign(id, 'peer', 'owner')).toBe(true);
        expect(await reg.list('owner')).toHaveLength(0);
        const peerList = await reg.list('peer');
        expect(peerList.map((x) => x.approvalId)).toEqual([id]);
        expect(peerList[0].assigneeUserId).toBe('peer');
        expect(await reg.approve(id, 'peer')).toBe(true);
        await expect(p).resolves.toMatchObject({ decision: 'approved' });
    });
    it('프로세스가 내려간 pending(저장소만) 도 이관된다; 없는 id 는 false', async () => {
        const store = fakeStore(); const reg = new ApprovalRegistry(store);
        store.rows.set('a1', { ...(await (async () => ({}))()), approval_id: 'a1', task_id: 't1', user_id: 'owner', tool_name: 'bash', args: {}, args_hash: 'h', risk_class: null, status: 'pending', answer_text: null, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(), decided_at: null, consumed_at: null });
        expect(await reg.reassign('a1', 'peer', 'owner', { escalate: true, reason: 'busy' })).toBe(true);
        expect(store.rows.get('a1')?.assignee_user_id).toBe('peer');
        expect(store.rows.get('a1')?.escalated_at).toBeTruthy();
        expect(await reg.reassign('nope', 'peer', 'owner')).toBe(false);
    });
});
