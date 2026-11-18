/**
 * 승인 대기 중 실행 슬롯 양보(재시도 카드가 대기열을 막는 문제) — 재개 가능한 승인 대기에 들어가면 슬롯을 내놓고,
 * 결정이 오면 자리가 있을 때만 되찾는다(자리가 없으면 호출부가 주차). 저장 실패 때만 상한을 넘겨 되찾는다.
 */
jest.mock('../../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ updateAgentTask: async () => undefined }),
    getPool: () => ({}),
}));

import { AgentTaskQueue, getAgentTaskQueue } from '../task-queue';
import { ApprovalRegistry, type ApprovalStore } from '../../task-sandbox/approval-gate';
import { AGENT_TASK_LIMITS } from '../../../config/runtime-limits';

const tick = () => new Promise((r) => setImmediate(r));
const limits = AGENT_TASK_LIMITS as { QUEUE_YIELD_ON_APPROVAL: boolean };

interface Job { started: boolean; finish: () => Promise<void> }

function harness(globalMax = 2, userMax = 1) {
    const q = new AgentTaskQueue(globalMax, userMax);
    const jobs = new Map<string, Job>();
    const submit = (taskId: string, userId: string): 'started' | 'queued' | 'duplicate' => {
        const job: Job = { started: false, finish: async () => undefined };
        jobs.set(taskId, job);
        return q.submit({
            taskId, userId,
            run: () => new Promise<void>((resolve) => {
                job.started = true;
                job.finish = async () => { resolve(); await tick(); };
            }),
        });
    };
    return { q, jobs, submit, started: (id: string) => jobs.get(id)?.started ?? false };
}

beforeEach(() => { limits.QUEUE_YIELD_ON_APPROVAL = true; });

describe('AgentTaskQueue — 승인 대기 양보·되찾기', () => {
    it('양보하면 같은 사용자의 대기 항목이 바로 시작된다(전역 2·사용자당 1)', async () => {
        const h = harness();
        expect(h.submit('a', 'u1')).toBe('started');
        expect(h.submit('b', 'u1')).toBe('queued');
        h.q.yieldSlot('a');
        await tick();
        expect(h.started('b')).toBe(true);
        expect(h.q.stats().globalActive).toBe(1);
    });

    it('자리가 비어 있으면 tryReclaimSlot 이 true 이고 카운터가 다시 찬다', () => {
        const h = harness();
        h.submit('a', 'u1');
        h.q.yieldSlot('a');
        expect(h.q.stats().globalActive).toBe(0);
        expect(h.q.tryReclaimSlot('a')).toBe(true);
        expect(h.q.stats().globalActive).toBe(1);
        // 다시 보유 중이라 같은 사용자의 새 작업은 대기한다
        expect(h.submit('b', 'u1')).toBe('queued');
    });

    it('자리가 없으면 false 이고 카운터·대기열이 그대로다', () => {
        const h = harness();
        h.submit('a', 'u1');
        h.q.yieldSlot('a');
        h.submit('b', 'u1'); // a 가 내놓은 자리로 시작
        h.submit('c', 'u1'); // 대기
        const before = h.q.stats();
        expect(h.q.tryReclaimSlot('a')).toBe(false);
        expect(h.q.stats()).toEqual(before);
        expect(h.q.position('c')).toBe(1);
    });

    it('다른 사용자의 되찾기는 그 사용자 상한과 전역 상한을 함께 본다(동시 실행이 상한을 넘지 않음)', async () => {
        const h = harness(2, 1);
        h.submit('a', 'u1');
        h.submit('x', 'u2');
        h.q.yieldSlot('a');
        h.submit('y', 'u3'); // 전역 자리 1 → 시작
        expect(h.started('y')).toBe(true);
        expect(h.q.stats().globalActive).toBe(2);
        expect(h.q.tryReclaimSlot('a')).toBe(false); // 전역 상한
        await h.jobs.get('y')!.finish();
        h.submit('a2', 'u1'); // u1 의 다른 작업이 자리를 채운다(사용자 상한 1)
        expect(h.q.stats().globalActive).toBe(2);
        await h.jobs.get('x')!.finish();
        expect(h.q.stats().globalActive).toBe(1);
        expect(h.q.tryReclaimSlot('a')).toBe(false); // 전역 자리는 있지만 u1 상한
        await h.jobs.get('a2')!.finish();
        expect(h.q.tryReclaimSlot('a')).toBe(true);
        expect(h.q.stats().globalActive).toBe(1);
    });

    it('양보 상태로 끝난 작업은 카운터를 줄이지 않는다(이후 정확히 상한만큼 시작된다)', async () => {
        const h = harness(2, 1);
        h.submit('a', 'u1');
        h.q.yieldSlot('a');
        await h.jobs.get('a')!.finish();
        expect(h.q.stats().globalActive).toBe(0);
        expect(h.q.has('a')).toBe(false);
        expect(['b', 'c', 'd'].map((id, i) => h.submit(id, `v${i}`))).toEqual(['started', 'started', 'queued']);
    });

    it('대기가 겹치면 0→1 에서만 양보하고, 첫 결정에서 되찾는다', () => {
        const h = harness(2, 1);
        h.submit('a', 'u1');
        h.q.yieldSlot('a');
        h.q.yieldSlot('a'); // 두 번째 대기 — 이미 양보 상태
        expect(h.q.stats().globalActive).toBe(0);
        expect(h.q.tryReclaimSlot('a')).toBe(true); // 첫 결정
        expect(h.q.stats().globalActive).toBe(1);
        // 남은 대기가 있는 동안 새 대기는 양보하지 않는다(보수적 — 대기 수 1→2)
        h.q.yieldSlot('a');
        expect(h.q.stats().globalActive).toBe(1);
        expect(h.q.tryReclaimSlot('a')).toBe(true); // 이미 보유
        expect(h.q.tryReclaimSlot('a')).toBe(true);
        expect(h.q.stats().globalActive).toBe(1);
        // 대기가 모두 풀린 뒤의 새 대기는 다시 양보한다
        h.q.yieldSlot('a');
        expect(h.q.stats().globalActive).toBe(0);
    });

    it('큐에 없는 taskId·runDirect 작업·플래그 OFF 에서는 아무 일도 하지 않고 되찾기는 true', async () => {
        const h = harness(2, 1);
        h.q.yieldSlot('nope');
        expect(h.q.tryReclaimSlot('nope')).toBe(true);
        let finish = (): void => undefined;
        h.q.runDirect({ taskId: 'd', userId: 'u1', run: () => new Promise<void>((r) => { finish = r; }) });
        h.q.yieldSlot('d');
        expect(h.q.tryReclaimSlot('d')).toBe(true);
        expect(h.q.stats().globalActive).toBe(0);
        finish();
        limits.QUEUE_YIELD_ON_APPROVAL = false;
        h.submit('a', 'u1');
        h.q.yieldSlot('a');
        expect(h.q.stats().globalActive).toBe(1);
        expect(h.submit('b', 'u1')).toBe('queued');
        expect(h.q.tryReclaimSlot('a')).toBe(true);
        expect(h.q.stats().globalActive).toBe(1);
    });

    it('forceReclaimSlot: 자리가 없어도 보유로 바뀌고 끝나면 카운터가 정확히 돌아온다. 양보 상태가 아니면 무시', async () => {
        const h = harness(2, 1);
        h.submit('a', 'u1');
        h.q.yieldSlot('a');
        h.submit('b', 'u1');
        h.submit('x', 'u2');
        expect(h.q.stats().globalActive).toBe(2);
        h.q.forceReclaimSlot('a');
        expect(h.q.stats().globalActive).toBe(3); // 상한 + 1
        h.q.forceReclaimSlot('a'); // 이미 보유 — 무시
        h.q.forceReclaimSlot('nope');
        expect(h.q.stats().globalActive).toBe(3);
        expect(h.submit('y', 'u3')).toBe('queued');
        await h.jobs.get('a')!.finish();
        expect(h.q.stats().globalActive).toBe(2);
        expect(h.started('y')).toBe(false); // 아직 상한
        await h.jobs.get('b')!.finish();
        expect(h.started('y')).toBe(true);
        expect(h.q.stats().globalActive).toBe(2);
    });

    it('양보 중에도 has() 는 true, 같은 작업 재제출은 duplicate', () => {
        const h = harness();
        h.submit('a', 'u1');
        h.q.yieldSlot('a');
        expect(h.q.has('a')).toBe(true);
        expect(h.submit('a', 'u1')).toBe('duplicate');
    });

    it('양보·되찾기를 반복해도 슬롯을 든 작업 수는 상한을 넘지 않는다', async () => {
        const h = harness(2, 1);
        for (const [id, u] of [['a', 'u1'], ['b', 'u2'], ['c', 'u3'], ['d', 'u4']] as const) h.submit(id, u);
        h.q.yieldSlot('a');
        h.q.yieldSlot('b');
        expect(h.q.stats().globalActive).toBe(2); // c·d 시작
        expect(h.q.tryReclaimSlot('a')).toBe(false);
        await h.jobs.get('c')!.finish();
        expect(h.q.tryReclaimSlot('a')).toBe(true);
        expect(h.q.tryReclaimSlot('b')).toBe(false);
        expect(h.q.stats().globalActive).toBe(2);
    });
});

describe('승인 대기 중인 작업은 실행 슬롯을 차지하지 않는다', () => {
    const store = {
        insertPending: async () => undefined, markDecided: async () => true, listPending: async () => [],
        getPending: async () => undefined, takeoverForCall: async () => undefined,
        expirePendingForTask: async () => undefined, extendPending: async () => true,
    } as unknown as ApprovalStore;

    it('사용자 상한만큼의 작업이 승인 대기 중이어도 새 작업이 바로 시작된다', async () => {
        // 상한을 기본값(전역 4·유저 2)으로 고정 — 로컬 .env 의 AGENT_TASK_QUEUE_USER_MAX 와 무관하게(싱글톤은 첫 조회 때 상한을 읽는다)
        Object.assign(AGENT_TASK_LIMITS as { QUEUE_GLOBAL_MAX: number; QUEUE_USER_MAX: number }, { QUEUE_GLOBAL_MAX: 4, QUEUE_USER_MAX: 2 });
        const q = getAgentTaskQueue();
        const registry = new ApprovalRegistry(store);
        const cards: string[] = [];
        const waitForApproval = (taskId: string) => () => registry.request(
            { taskId, userId: 'u1', toolName: 'browser', args: { actions: [{ type: 'goto', url: 'https://example.com' }] } },
            { timeoutMs: 60_000, parkable: true, onPending: (p) => cards.push(p.approvalId) },
        ).then(() => undefined);

        expect(q.submit({ taskId: 'retry-card-1', userId: 'u1', run: waitForApproval('retry-card-1') })).toBe('started');
        expect(q.submit({ taskId: 'retry-card-2', userId: 'u1', run: waitForApproval('retry-card-2') })).toBe('started');
        await tick();
        expect(cards).toHaveLength(2); // 두 작업 모두 카드가 떠 있다

        let ran = false;
        const outcome = q.submit({ taskId: 'next-task', userId: 'u1', run: async () => { ran = true; } });
        expect(outcome).toBe('started');
        expect(ran).toBe(true);

        for (const id of cards) await registry.reject(id, 'u1', '시험 종료');
        await tick();
    });
});
