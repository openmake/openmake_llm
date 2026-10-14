/**
 * 결정자 기록 — 승인·거절·답변의 actorId 가 agent_task_approvals.decided_by 에 남는다
 * (살아 있는 waiter 경로와 waiter 없는(재시작 뒤) 경로 모두).
 */
import { ApprovalRegistry, type ApprovalStore } from '../approval-gate';
import type { ApprovalRow } from '../../../data/repositories/agent-task-approval-repository';

function fakeStore() {
    const rows = new Map<string, ApprovalRow>();
    const row = (p: Partial<ApprovalRow> & { approval_id: string }): ApprovalRow => ({
        task_id: 't1', user_id: 'u1', tool_name: 'bash', args: { command: 'ls' }, args_hash: 'h', risk_class: null, status: 'pending',
        answer_text: null, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(),
        decided_at: null, consumed_at: null, decided_by: null, ...p,
    });
    const store: ApprovalStore & { rows: Map<string, ApprovalRow>; seed: (p: Partial<ApprovalRow> & { approval_id: string }) => void } = {
        rows,
        seed: (p) => { rows.set(p.approval_id, row(p)); },
        insertPending: async (r) => { rows.set(r.approvalId, row({ approval_id: r.approvalId, task_id: r.taskId, user_id: r.userId, tool_name: r.toolName, args: r.args, args_hash: r.argsHash })); },
        markDecided: async (id, status, text, by, consumed) => {
            const r = rows.get(id); if (!r || r.status !== 'pending') return false;
            r.status = status; r.answer_text = text ?? null; r.decided_at = new Date().toISOString(); r.decided_by = by ?? r.decided_by ?? null;
            if (consumed) r.consumed_at = new Date().toISOString(); return true;
        },
        listPending: async (userId) => [...rows.values()].filter((r) => r.user_id === userId && r.status === 'pending'),
        getPending: async (id) => { const r = rows.get(id); return r && r.status === 'pending' ? r : undefined; },
        takeoverForCall: async (taskId, toolName, argsHash) => [...rows.values()].find((r) => r.task_id === taskId && r.tool_name === toolName && r.args_hash === argsHash && r.status === 'pending'),
        expirePendingForTask: async () => undefined,
    };
    return store;
}
const input = { taskId: 't1', userId: 'u1', toolName: 'bash', args: { command: 'ls' } };
const flush = () => new Promise((r) => setImmediate(r));

async function waiting(reg: ApprovalRegistry): Promise<{ id: string; p: Promise<unknown> }> {
    let id = '';
    const p = reg.request(input, { timeoutMs: 5000, onPending: (pa) => { id = pa.approvalId; } });
    await flush();
    return { id, p };
}

describe('ApprovalRegistry — decided_by 기록', () => {
    it('살아 있는 waiter 승인: decided_by 와 consumed_at 이 남는다', async () => {
        const store = fakeStore();
        const reg = new ApprovalRegistry(store);
        const { id, p } = await waiting(reg);
        expect(await reg.approve(id, 'admin-1')).toBe(true);
        await p; await flush();
        const r = store.rows.get(id);
        expect(r?.status).toBe('approved');
        expect(r?.decided_by).toBe('admin-1');
        expect(r?.consumed_at).toBeTruthy();
    });

    it('살아 있는 waiter 거절: decided_by 와 사유가 남는다', async () => {
        const store = fakeStore();
        const reg = new ApprovalRegistry(store);
        const { id, p } = await waiting(reg);
        await reg.reject(id, 'u9', '사유');
        await p; await flush();
        const r = store.rows.get(id);
        expect(r?.status).toBe('rejected');
        expect(r?.decided_by).toBe('u9');
        expect(r?.answer_text).toBe('사유');
    });

    it('살아 있는 waiter 답변: decided_by 가 남는다', async () => {
        const store = fakeStore();
        const reg = new ApprovalRegistry(store);
        const { id, p } = await waiting(reg);
        await reg.answer(id, '답변', 'u1');
        await p; await flush();
        const r = store.rows.get(id);
        expect(r?.answer_text).toBe('답변');
        expect(r?.decided_by).toBe('u1');
    });

    it('waiter 없음(재시작 뒤): 저장소 행에 decided_by 가 남고 소비 표시는 없다', async () => {
        const store = fakeStore();
        const reg = new ApprovalRegistry(store);
        store.seed({ approval_id: 'a1' });
        expect(await reg.approve('a1', 'admin-1')).toBe(true);
        const r = store.rows.get('a1');
        expect(r?.status).toBe('approved');
        expect(r?.decided_by).toBe('admin-1');
        expect(r?.consumed_at).toBeNull();
    });

    it('actorId 를 넘기지 않으면 decided_by 는 null', async () => {
        const store = fakeStore();
        const reg = new ApprovalRegistry(store);
        const { id, p } = await waiting(reg);
        await reg.approve(id);
        await p; await flush();
        store.seed({ approval_id: 'a2' });
        await reg.approve('a2');
        expect(store.rows.get(id)?.decided_by).toBeNull();
        expect(store.rows.get('a2')?.decided_by).toBeNull();
    });
});
