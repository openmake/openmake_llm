/**
 * 시험 헬퍼 waitFor — 승인 대기 등록이 DB 쿼리(takeoverForCall·insertPending) 뒤로 밀려도 기다리는지.
 * dev CI(실제 Postgres)에서 "한 틱 양보" 가정이 깨져 approvalId 가 빈 값으로 남던 실패의 재현.
 */
import { ApprovalRegistry, type ApprovalStore } from '../approval-gate';
import { waitFor } from './helpers/wait-for';

/** 대기 등록 전 쿼리만 늦추는 저장소 — 바쁜 DB 흉내. */
const SLOW_STORE_MS = 50;
const slow = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), SLOW_STORE_MS));
const slowStore: ApprovalStore = {
    insertPending: () => slow(undefined),
    markDecided: async () => true,
    listPending: async () => [],
    getPending: async () => undefined,
    takeoverForCall: () => slow(undefined),
    expirePendingForTask: async () => undefined,
};
const input = { taskId: 't-wait', userId: 'u1', toolName: 'bash', args: { command: 'rm -rf build' } };

describe('waitFor', () => {
    it('저장소가 늦으면 한 틱 안에는 등록되지 않지만, waitFor 는 등록될 때까지 기다린다', async () => {
        const reg = new ApprovalRegistry(slowStore);
        let approvalId = '';
        const p = reg.request(input, { timeoutMs: 5000, onPending: (pa) => { approvalId = pa.approvalId; } });
        await new Promise((r) => setImmediate(r));
        expect(approvalId).toBe(''); // 옛 시험의 가정이 깨지는 지점
        const id = await waitFor(() => approvalId, '승인 대기 등록');
        expect(id).toMatch(/^apv_t-wait_/);
        await reg.reject(id, 'u1');
        await expect(p).resolves.toMatchObject({ decision: 'rejected' });
    });

    it('상한을 넘으면 무엇을 기다렸는지 밝히며 실패한다', async () => {
        await expect(waitFor(() => '', '오지 않는 값', 30)).rejects.toThrow('오지 않는 값 — 30ms 안에 준비되지 않았습니다');
    });
});
