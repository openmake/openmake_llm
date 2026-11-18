/**
 * 승인 대기 중 실행 슬롯 양보(레지스트리 쪽) — 재개 가능한 대기만 양보하고, 결정 때 자리가 없으면 결정을 미소비로 저장한 뒤
 * parked 로 답한다. 저장을 기다리는 사이의 두 번째 결정·철회·중단, 저장 실패(상한을 넘겨 실행), 중단 우선(r4)을 고정한다.
 */
import { ApprovalRegistry, type ApprovalStore } from '../approval-gate';
import type { ApprovalSlotPort } from '../../agent-task/approval-slot-port';
import { AGENT_TASK_LIMITS } from '../../../config/runtime-limits';

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

function store(opts: { extend?: boolean; voidUnconsumed?: boolean } = {}) {
    const s = {
        insertPending: jest.fn(async () => undefined),
        markDecided: jest.fn(async (..._a: unknown[]): Promise<boolean> => true),
        listPending: jest.fn(async () => []),
        getPending: jest.fn(async () => undefined),
        takeoverForCall: jest.fn(async (..._a: unknown[]): Promise<unknown> => undefined),
        expirePendingForTask: jest.fn(async () => undefined),
        revokeUnconsumed: jest.fn(async () => 'revoked' as const),
        ...(opts.extend === false ? {} : { extendPending: jest.fn(async (..._a: unknown[]): Promise<boolean> => true) }),
        ...(opts.voidUnconsumed === false ? {} : { voidUnconsumedForTask: jest.fn(async () => undefined) }),
    };
    return s as typeof s & ApprovalStore & { extendPending: jest.Mock; voidUnconsumedForTask: jest.Mock };
}

function slots(room: boolean) {
    const order: string[] = [];
    const port = {
        yieldSlot: jest.fn((_t: string) => { order.push('yield'); }),
        tryReclaimSlot: jest.fn((_t: string) => { order.push('reclaim'); return room; }),
        forceReclaimSlot: jest.fn((_t: string) => { order.push('force'); }),
        resumeAfterRelease: jest.fn((_t: string) => { order.push('resume'); }),
    };
    return { port: port as typeof port & ApprovalSlotPort, order };
}

/** 손으로 푸는 저장 — markDecided·extendPending 대용. */
function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

// 무응답 만료 분기를 보려면 유예 주차가 없어야 한다 — 로컬 .env 의 AGENT_TASK_HITL_PARK_GRACE_MS 와 무관하게 0 으로 고정
const graceLimits = AGENT_TASK_LIMITS as { HITL_PARK_GRACE_MS: number };
const originalGrace = graceLimits.HITL_PARK_GRACE_MS;
beforeEach(() => { graceLimits.HITL_PARK_GRACE_MS = 0; });
afterAll(() => { graceLimits.HITL_PARK_GRACE_MS = originalGrace; });

const input = { taskId: 't1', userId: 'u1', toolName: 'browser', args: { actions: [{ type: 'goto', url: 'https://example.com' }] } };

/** 대기를 시작하고 카드 id 를 돌려준다. */
async function ask(reg: ApprovalRegistry, extra: Partial<Parameters<ApprovalRegistry['request']>[1]> = {}, toolName = input.toolName) {
    let approvalId = '';
    const settled: string[] = [];
    const p = reg.request({ ...input, toolName }, { timeoutMs: 60_000, parkable: true, onPending: (a) => { approvalId = a.approvalId; }, ...extra });
    void p.then((r) => settled.push(r.reason ?? r.decision));
    await flush();
    return { p, id: () => approvalId, settled };
}

describe('ApprovalRegistry — 양보 조건', () => {
    it('parkable + 대기 연장 저장소면 대기 진입 때 yieldSlot', async () => {
        const { port } = slots(true);
        const reg = new ApprovalRegistry(store(), port);
        const a = await ask(reg);
        expect(port.yieldSlot).toHaveBeenCalledWith('t1');
        await reg.approve(a.id());
        await expect(a.p).resolves.toMatchObject({ decision: 'approved' });
        expect(port.tryReclaimSlot).toHaveBeenCalledWith('t1');
    });

    it.each([
        ['parkable 아님', () => store(), { parkable: false }],
        ['연장 저장소 없음', () => store({ extend: false }), {}],
        ['parkDeferred(mcp_elicit)', () => store(), { parkDeferred: true }],
    ] as const)('%s 이면 yieldSlot·tryReclaimSlot 을 부르지 않는다', async (_n, mk, extra) => {
        const { port } = slots(false);
        const reg = new ApprovalRegistry(mk(), port);
        const a = await ask(reg, extra);
        await reg.approve(a.id());
        await expect(a.p).resolves.toMatchObject({ decision: 'approved' });
        expect(port.yieldSlot).not.toHaveBeenCalled();
        expect(port.tryReclaimSlot).not.toHaveBeenCalled();
    });

    it('저장소가 없으면 양보하지 않는다', async () => {
        const { port } = slots(false);
        const reg = new ApprovalRegistry(undefined, port);
        const a = await ask(reg);
        await reg.approve(a.id());
        await expect(a.p).resolves.toMatchObject({ decision: 'approved' });
        expect(port.yieldSlot).not.toHaveBeenCalled();
        expect(port.tryReclaimSlot).not.toHaveBeenCalled();
    });

    it('자동승인·정책 바닥 거절·무인 결론·이어받은 결정은 yieldSlot·tryReclaimSlot 을 부르지 않는다', async () => {
        const { port } = slots(false);
        const s = store();
        const reg = new ApprovalRegistry(s, port);
        reg.setAutoApprove('auto', true);
        await expect(reg.request({ ...input, taskId: 'auto' }, { timeoutMs: 60_000, parkable: true })).resolves.toMatchObject({ decision: 'approved' });
        await expect(reg.request({ ...input, toolName: 'file_ops', args: { op: 'write', path: 'CLAUDE.md' } }, { timeoutMs: 60_000, parkable: true, policy: 'none' }))
            .resolves.toMatchObject({ reason: 'policy_floor' });
        reg.setUnattended('un', true);
        await expect(reg.request({ ...input, taskId: 'un', toolName: 'bash', args: { command: 'ls' } }, { timeoutMs: 60_000, parkable: true }))
            .resolves.toMatchObject({ waitedMs: 0 });
        s.takeoverForCall.mockResolvedValueOnce({ approval_id: 'apv_old', status: 'approved', decided_at: new Date().toISOString(), created_at: new Date().toISOString() });
        await expect(reg.request(input, { timeoutMs: 60_000, parkable: true })).resolves.toMatchObject({ decision: 'approved', waitedMs: 0 });
        expect(port.yieldSlot).not.toHaveBeenCalled();
        expect(port.tryReclaimSlot).not.toHaveBeenCalled();
    });
});

describe('ApprovalRegistry — 결정 때 되찾기', () => {
    it('자리 있음: 승인·거절 모두 종전 결과, markDecided 의 소비 인자가 true', async () => {
        const { port } = slots(true);
        const s = store();
        const reg = new ApprovalRegistry(s, port);
        const a = await ask(reg);
        await reg.approve(a.id(), 'actor');
        await expect(a.p).resolves.toMatchObject({ decision: 'approved' });
        const b = await ask(reg);
        await reg.reject(b.id(), 'actor', '싫다');
        await expect(b.p).resolves.toMatchObject({ decision: 'rejected', reason: 'user', text: '싫다' });
        await flush();
        expect(s.markDecided).toHaveBeenNthCalledWith(1, a.id(), 'approved', undefined, 'actor', true);
        expect(s.markDecided).toHaveBeenNthCalledWith(2, b.id(), 'rejected', '싫다', 'actor', true);
        expect(port.resumeAfterRelease).not.toHaveBeenCalled();
    });

    it('자리 없음 + 승인: parked, markDecided 의 소비 인자가 false, resumeAfterRelease 1회', async () => {
        const { port } = slots(false);
        const s = store();
        const reg = new ApprovalRegistry(s, port);
        const a = await ask(reg);
        await reg.approve(a.id(), 'actor');
        await expect(a.p).resolves.toMatchObject({ decision: 'rejected', reason: 'parked' });
        expect(s.markDecided).toHaveBeenCalledTimes(1);
        expect(s.markDecided).toHaveBeenCalledWith(a.id(), 'approved', undefined, 'actor', false);
        expect(port.resumeAfterRelease).toHaveBeenCalledTimes(1);
        expect(port.resumeAfterRelease).toHaveBeenCalledWith('t1');
        expect(port.forceReclaimSlot).not.toHaveBeenCalled();
        expect(s.extendPending).not.toHaveBeenCalled();
    });

    it('자리 없음 + 거절(사유)·답변: 같은 경로, 본문이 저장된다', async () => {
        const { port } = slots(false);
        const s = store();
        const reg = new ApprovalRegistry(s, port);
        const a = await ask(reg);
        await reg.reject(a.id(), 'actor', '하지 마');
        await expect(a.p).resolves.toMatchObject({ decision: 'rejected', reason: 'parked' });
        const b = await ask(reg, {}, 'ask_human');
        await reg.answer(b.id(), '파란색', 'actor');
        await expect(b.p).resolves.toMatchObject({ decision: 'rejected', reason: 'parked' });
        expect(s.markDecided).toHaveBeenNthCalledWith(1, a.id(), 'rejected', '하지 마', 'actor', false);
        expect(s.markDecided).toHaveBeenNthCalledWith(2, b.id(), 'approved', '파란색', 'actor', false);
        expect(port.resumeAfterRelease).toHaveBeenCalledTimes(2);
    });

    it('자리 없음 + 무응답 만료: extendPending, markDecided 없음, resumeAfterRelease 없음', async () => {
        const { port } = slots(false);
        const s = store();
        const reg = new ApprovalRegistry(s, port);
        const r = await reg.request(input, { timeoutMs: 5, parkable: true });
        expect(r).toMatchObject({ decision: 'rejected', reason: 'parked' });
        expect(s.extendPending).toHaveBeenCalledWith(expect.stringContaining('apv_t1_'), AGENT_TASK_LIMITS.HITL_PARK_MAX_MS);
        expect(s.markDecided).not.toHaveBeenCalled();
        expect(port.resumeAfterRelease).not.toHaveBeenCalled();
    });

    it('abort·유예 parked 는 tryReclaimSlot 을 부르지 않는다', async () => {
        const { port } = slots(true);
        const reg = new ApprovalRegistry(store(), port);
        const ac = new AbortController();
        const a = await ask(reg, { signal: ac.signal });
        ac.abort();
        await expect(a.p).resolves.toMatchObject({ reason: 'abort' });
        graceLimits.HITL_PARK_GRACE_MS = 5;
        await expect(reg.request(input, { timeoutMs: 60_000, parkable: true })).resolves.toMatchObject({ reason: 'parked' });
        expect(port.yieldSlot).toHaveBeenCalledTimes(2);
        expect(port.tryReclaimSlot).not.toHaveBeenCalled();
    });

    it('closeTask 가 voidUnconsumedForTask 를 부른다', async () => {
        const s = store();
        new ApprovalRegistry(s, slots(true).port).closeTask('t1');
        await flush();
        expect(s.expirePendingForTask).toHaveBeenCalledWith('t1');
        expect(s.voidUnconsumedForTask).toHaveBeenCalledWith('t1');
    });
});

describe('ApprovalRegistry — 자리 없음 분기의 저장 순서', () => {
    it('저장이 끝나기 전에는 request 가 풀리지 않고, 끝나면 resumeAfterRelease → parked 순', async () => {
        const { port, order } = slots(false);
        const s = store();
        const save = deferred<boolean>();
        s.markDecided.mockReturnValueOnce(save.promise);
        const reg = new ApprovalRegistry(s, port);
        const a = await ask(reg);
        void a.p.then(() => order.push('parked'));
        await reg.approve(a.id());
        await flush();
        expect(a.settled).toEqual([]);
        expect(port.resumeAfterRelease).not.toHaveBeenCalled();
        save.resolve(true);
        await expect(a.p).resolves.toMatchObject({ reason: 'parked' });
        await flush();
        expect(order).toEqual(['yield', 'reclaim', 'resume', 'parked']);
    });

    it('저장 중 두 번째 결정·철회: markDecided 1회, 결과는 첫 결정 기준, 철회는 consumed', async () => {
        const { port } = slots(false);
        const s = store();
        const save = deferred<boolean>();
        s.markDecided.mockReturnValueOnce(save.promise);
        const reg = new ApprovalRegistry(s, port);
        const a = await ask(reg);
        await reg.approve(a.id());
        await reg.reject(a.id(), 'other', '반대');
        await expect(reg.revoke(a.id(), 'u1')).resolves.toBe('consumed');
        save.resolve(true);
        await expect(a.p).resolves.toMatchObject({ reason: 'parked' });
        await flush();
        expect(s.markDecided).toHaveBeenCalledTimes(1);
        expect(s.markDecided).toHaveBeenCalledWith(a.id(), 'approved', undefined, undefined, false);
        expect(port.tryReclaimSlot).toHaveBeenCalledTimes(1);
    });

    it('저장 중 중단 + 저장 성공: 저장이 끝난 뒤 abort, resumeAfterRelease 없음', async () => {
        const { port } = slots(false);
        const s = store();
        const save = deferred<boolean>();
        s.markDecided.mockReturnValueOnce(save.promise);
        const reg = new ApprovalRegistry(s, port);
        const ac = new AbortController();
        const a = await ask(reg, { signal: ac.signal });
        await reg.approve(a.id());
        ac.abort();
        await flush();
        expect(a.settled).toEqual([]);
        save.resolve(true);
        await expect(a.p).resolves.toMatchObject({ decision: 'rejected', reason: 'abort' });
        expect(port.resumeAfterRelease).not.toHaveBeenCalled();
        expect(port.forceReclaimSlot).not.toHaveBeenCalled();
    });

    describe.each([
        ['예외', (d: ReturnType<typeof deferred<boolean>>) => d.reject(new Error('db down'))],
        ['false', (d: ReturnType<typeof deferred<boolean>>) => d.resolve(false)],
    ] as const)('저장 실패(%s)', (_n, fail) => {
        it.each([
            ['승인', (reg: ApprovalRegistry, id: string) => reg.approve(id)],
            ['거절', (reg: ApprovalRegistry, id: string) => reg.reject(id, 'u1', '싫다')],
            ['답변', (reg: ApprovalRegistry, id: string) => reg.answer(id, '답')],
        ] as const)('저장 중 중단 + 저장 실패(%s): abort, forceReclaimSlot·resumeAfterRelease 0회, 저장소 추가 호출 없음', async (_k, decide) => {
            const { port } = slots(false);
            const s = store();
            const save = deferred<boolean>();
            s.markDecided.mockReturnValueOnce(save.promise);
            const reg = new ApprovalRegistry(s, port);
            const ac = new AbortController();
            const a = await ask(reg, { signal: ac.signal });
            await decide(reg, a.id());
            ac.abort();
            fail(save);
            await expect(a.p).resolves.toEqual({ decision: 'rejected', reason: 'abort', waitedMs: expect.any(Number) });
            await flush();
            expect(port.forceReclaimSlot).not.toHaveBeenCalled();
            expect(port.resumeAfterRelease).not.toHaveBeenCalled();
            expect(s.markDecided).toHaveBeenCalledTimes(1);
            expect(s.extendPending).not.toHaveBeenCalled();
            expect(s.expirePendingForTask).not.toHaveBeenCalled();
        });

        it('중단 없이 저장 실패: forceReclaimSlot 1회, 결과는 approved, resumeAfterRelease 없음', async () => {
            const { port } = slots(false);
            const s = store();
            const save = deferred<boolean>();
            s.markDecided.mockReturnValueOnce(save.promise);
            const reg = new ApprovalRegistry(s, port);
            const a = await ask(reg);
            await reg.approve(a.id());
            fail(save);
            await expect(a.p).resolves.toMatchObject({ decision: 'approved' });
            expect(port.forceReclaimSlot).toHaveBeenCalledTimes(1);
            expect(port.resumeAfterRelease).not.toHaveBeenCalled();
        });

        it('거절·답변도 원래 결정과 본문이 그대로 온다', async () => {
            const { port } = slots(false);
            const s = store();
            const reg = new ApprovalRegistry(s, port);
            const d1 = deferred<boolean>();
            s.markDecided.mockReturnValueOnce(d1.promise);
            const a = await ask(reg);
            await reg.reject(a.id(), 'u1', '싫다');
            fail(d1);
            await expect(a.p).resolves.toMatchObject({ decision: 'rejected', reason: 'user', text: '싫다' });
            const d2 = deferred<boolean>();
            s.markDecided.mockReturnValueOnce(d2.promise);
            const b = await ask(reg, {}, 'ask_human');
            await reg.answer(b.id(), '파란색');
            fail(d2);
            await expect(b.p).resolves.toMatchObject({ decision: 'approved', text: '파란색' });
            expect(port.forceReclaimSlot).toHaveBeenCalledTimes(2);
        });

        it('무응답 만료의 extendPending 실패: forceReclaimSlot, 결과는 timeout 거절', async () => {
            const { port } = slots(false);
            const s = store();
            const ext = deferred<boolean>();
            s.extendPending.mockReturnValueOnce(ext.promise);
            const reg = new ApprovalRegistry(s, port);
            const p = reg.request(input, { timeoutMs: 5, parkable: true });
            await new Promise((r) => setTimeout(r, 20));
            fail(ext);
            await expect(p).resolves.toMatchObject({ decision: 'rejected', reason: 'timeout' });
            expect(port.forceReclaimSlot).toHaveBeenCalledTimes(1);
            expect(port.resumeAfterRelease).not.toHaveBeenCalled();
        });

        it('무응답 만료 연장을 기다리는 사이 중단: abort, forceReclaimSlot 0회', async () => {
            const { port } = slots(false);
            const s = store();
            const ext = deferred<boolean>();
            s.extendPending.mockReturnValueOnce(ext.promise);
            const reg = new ApprovalRegistry(s, port);
            const ac = new AbortController();
            const p = reg.request(input, { timeoutMs: 5, parkable: true, signal: ac.signal });
            await new Promise((r) => setTimeout(r, 20));
            ac.abort();
            fail(ext);
            await expect(p).resolves.toMatchObject({ decision: 'rejected', reason: 'abort' });
            expect(port.forceReclaimSlot).not.toHaveBeenCalled();
        });
    });

    it('저장이 실패한 뒤에 온 중단은 결과를 바꾸지 않는다(approved, forceReclaimSlot 1회)', async () => {
        const { port } = slots(false);
        const s = store();
        const save = deferred<boolean>();
        s.markDecided.mockReturnValueOnce(save.promise);
        const reg = new ApprovalRegistry(s, port);
        const ac = new AbortController();
        const a = await ask(reg, { signal: ac.signal });
        await reg.approve(a.id());
        save.reject(new Error('db down'));
        await expect(a.p).resolves.toMatchObject({ decision: 'approved' });
        ac.abort();
        await flush();
        expect(port.forceReclaimSlot).toHaveBeenCalledTimes(1);
    });
});
