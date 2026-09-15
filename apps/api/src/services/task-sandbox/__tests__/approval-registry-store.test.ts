/**
 * 승인 대기 영속(124) — 저장소가 붙은 ApprovalRegistry 의 재시작 이어받기 계약.
 * 메모리 waiter 가 SoT 이고 저장소는 그림자다: 저장소 오류는 흐름을 막지 않는다(fail-open).
 */
import { ApprovalRegistry, type ApprovalStore } from '../approval-gate';
import type { ApprovalRow } from '../../../data/repositories/agent-task-approval-repository';

function fakeStore() {
    const rows = new Map<string, ApprovalRow>();
    const row = (p: Partial<ApprovalRow> & { approval_id: string }): ApprovalRow => ({
        task_id: 't1', user_id: 'u1', tool_name: 'bash', args: { command: 'ls' }, args_hash: 'h', status: 'pending',
        answer_text: null, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(),
        decided_at: null, consumed_at: null, ...p,
    });
    const store: ApprovalStore & { rows: Map<string, ApprovalRow>; seed: (p: Partial<ApprovalRow> & { approval_id: string }) => void } = {
        rows,
        seed: (p) => { rows.set(p.approval_id, row(p)); },
        insertPending: async (r) => { rows.set(r.approvalId, row({ approval_id: r.approvalId, task_id: r.taskId, user_id: r.userId, tool_name: r.toolName, args: r.args, args_hash: r.argsHash })); },
        markDecided: async (id, status, text) => { const r = rows.get(id); if (!r || r.status !== 'pending') return false; r.status = status; r.answer_text = text ?? null; r.decided_at = new Date().toISOString(); return true; },
        listPending: async (userId) => [...rows.values()].filter((r) => r.user_id === userId && r.status === 'pending'),
        getPending: async (id) => { const r = rows.get(id); return r && r.status === 'pending' ? r : undefined; },
        takeoverForCall: async (taskId, toolName, argsHash) => {
            const same = [...rows.values()].filter((r) => r.task_id === taskId && r.tool_name === toolName && r.args_hash === argsHash);
            const decided = same.find((r) => (r.status === 'approved' || r.status === 'rejected') && !r.consumed_at);
            if (decided) { decided.consumed_at = new Date().toISOString(); return decided; }
            return same.find((r) => r.status === 'pending');
        },
        expirePendingForTask: async (taskId) => { for (const r of rows.values()) if (r.task_id === taskId && r.status === 'pending') r.status = 'aborted'; },
    };
    return store;
}
const input = { taskId: 't1', userId: 'u1', toolName: 'bash', args: { command: 'ls' } };

describe('ApprovalRegistry + 저장소', () => {
    it('요청은 pending 행을 남기고, 승인은 행을 approved 로 닫는다', async () => {
        const store = fakeStore();
        const reg = new ApprovalRegistry(store);
        let id = '';
        const p = reg.request(input, { timeoutMs: 5000, onPending: (pa) => { id = pa.approvalId; } });
        await new Promise((r) => setImmediate(r));
        expect(store.rows.get(id)?.status).toBe('pending');
        expect(await reg.approve(id)).toBe(true);
        await expect(p).resolves.toMatchObject({ decision: 'approved' });
        await new Promise((r) => setImmediate(r));
        expect(store.rows.get(id)?.status).toBe('approved');
    });

    it('프로세스가 내려간 동안(메모리 waiter 없음) 내린 결정은 저장소에 남고, 재개된 작업이 같은 호출로 이어받는다', async () => {
        const store = fakeStore();
        const reg = new ApprovalRegistry(store);
        // 재시작 전 남은 pending 행 — 승인함에는 보이지만 waiter 는 없다.
        store.seed({ approval_id: 'apv_old', args_hash: hashOf(input.args) });
        expect((await reg.list('u1')).map((p) => p.approvalId)).toEqual(['apv_old']);
        expect(await reg.get('apv_old')).toMatchObject({ toolName: 'bash' });
        expect(await reg.approve('apv_old')).toBe(true); // waiter 없음 → 저장소에만 기록
        // 재개된 작업이 같은 호출을 다시 요청 → 대기 없이 approved 를 소비
        const r = await reg.request(input, { timeoutMs: 5000 });
        expect(r).toMatchObject({ decision: 'approved', waitedMs: 0 });
        expect(store.rows.get('apv_old')?.consumed_at).toBeTruthy();
        // 한 번 소비한 결정은 다시 쓰이지 않는다(새 pending 생성)
        let id2 = '';
        void reg.request(input, { timeoutMs: 50, onPending: (pa) => { id2 = pa.approvalId; } });
        await new Promise((r) => setImmediate(r));
        expect(id2).not.toBe('apv_old');
    });

    it('재개된 작업이 아직 pending 인 행을 만나면 그 id 를 그대로 이어받아 대기한다', async () => {
        const store = fakeStore();
        const reg = new ApprovalRegistry(store);
        store.seed({ approval_id: 'apv_keep', args_hash: hashOf(input.args) });
        let id = '';
        const p = reg.request(input, { timeoutMs: 5000, onPending: (pa) => { id = pa.approvalId; } });
        await new Promise((r) => setImmediate(r));
        expect(id).toBe('apv_keep');
        expect(await reg.reject('apv_keep')).toBe(true);
        await expect(p).resolves.toMatchObject({ decision: 'rejected', reason: 'user' });
    });

    it('저장소 오류는 삼켜지고 메모리 흐름은 그대로 동작한다(fail-open)', async () => {
        const broken = { ...fakeStore(), insertPending: async () => { throw new Error('db down'); }, takeoverForCall: async () => { throw new Error('db down'); } };
        const reg = new ApprovalRegistry(broken);
        let id = '';
        const p = reg.request(input, { timeoutMs: 5000, onPending: (pa) => { id = pa.approvalId; } });
        await new Promise((r) => setImmediate(r));
        expect(await reg.approve(id)).toBe(true);
        await expect(p).resolves.toMatchObject({ decision: 'approved' });
    });

    it('closeTask 는 저장소의 남은 pending 을 닫는다', async () => {
        const store = fakeStore();
        const reg = new ApprovalRegistry(store);
        store.seed({ approval_id: 'apv_left' });
        reg.closeTask('t1');
        await new Promise((r) => setImmediate(r));
        expect(store.rows.get('apv_left')?.status).toBe('aborted');
    });
});

function hashOf(args: Record<string, unknown>): string {
    // 저장소 구현과 같은 규칙(sha256 of JSON) — 테스트는 실제 헬퍼를 쓴다.
    return require('../../../data/repositories/agent-task-approval-repository').hashApprovalArgs(args);
}
