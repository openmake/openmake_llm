/**
 * 승인 대기 슬롯 양보 — 실제 런타임 배선 통합 테스트(로컬 라이브 r4 S2 FAIL 재현).
 * 라이브 조건 그대로: 운영이 아닌 NODE_ENV, AGENT_TASK_QUEUE_YIELD_ON_APPROVAL 미설정, 큐 ON·사용자당 1·유예 60초.
 * 설정 모듈을 env 로 새로 읽고, 싱글턴(getApprovalRegistry 기본 저장소·기본 슬롯 포트, getAgentTaskQueue, dispatchAgentTask)을
 * 손대지 않고 쓴다 — 플래그를 테스트에서 직접 켜는 단위 테스트가 놓친 배선(개발 기본값 false)을 잡는다.
 * DB 만 메모리 가짜로 바꾼다(승인 저장소 클래스·unified-database).
 */
jest.mock('../../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ updateAgentTask: async () => undefined }),
    getPool: () => ({}),
}));

jest.mock('../../../data/repositories/agent-task-approval-repository', () => {
    const rows = new Map<string, { status: string }>();
    class AgentTaskApprovalRepository {
        async insertPending(r: { approvalId: string }) { rows.set(r.approvalId, { status: 'pending' }); }
        async markDecided(id: string, status: string) {
            const row = rows.get(id);
            if (!row || row.status !== 'pending') return false;
            row.status = status;
            return true;
        }
        async listPending() { return []; }
        async getPending() { return undefined; }
        async takeoverForCall() { return undefined; }
        async expirePendingForTask() { return undefined; }
        async revokeUnconsumed() { return 'not_found'; }
        async listRecentDecisions() { return []; }
        async recordEvent() { return undefined; }
        async reassign() { return false; }
        async extendPending(id: string) { return rows.get(id)?.status === 'pending'; }
        async voidUnconsumedForTask() { return undefined; }
    }
    return { ...jest.requireActual('../../../data/repositories/agent-task-approval-repository'), AgentTaskApprovalRepository };
});

export {}; // 모듈 범위(다른 테스트의 전역 이름과 겹치지 않게) — 대상 모듈은 env 를 정한 뒤 isolateModules 안에서 불러온다

const tick = () => new Promise((r) => setImmediate(r));
const ENV_KEYS = ['NODE_ENV', 'AGENT_TASK_QUEUE_ENABLED', 'AGENT_TASK_QUEUE_USER_MAX', 'AGENT_TASK_QUEUE_GLOBAL_MAX',
    'AGENT_TASK_HITL_PARK_GRACE_MS', 'AGENT_TASK_QUEUE_YIELD_ON_APPROVAL'] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    // 로컬 라이브(worktree 루트 .env) 조건 — 양보 플래그는 설정하지 않는다
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    process.env.AGENT_TASK_QUEUE_ENABLED = 'true';
    process.env.AGENT_TASK_QUEUE_USER_MAX = '1';
    process.env.AGENT_TASK_QUEUE_GLOBAL_MAX = '4';
    process.env.AGENT_TASK_HITL_PARK_GRACE_MS = '60000';
    delete process.env.AGENT_TASK_QUEUE_YIELD_ON_APPROVAL;
});

afterAll(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete (process.env as Record<string, string | undefined>)[k];
        else (process.env as Record<string, string | undefined>)[k] = saved[k];
    }
});

describe('승인 대기 슬롯 양보 — 런타임 배선(개발 env, 플래그 미설정)', () => {
    it('A 의 memory_save 승인 카드가 떠 있는 동안 같은 사용자의 B 가 대기열에 걸리지 않고 시작된다', async () => {
        await jest.isolateModulesAsync(async () => {
            const { dispatchAgentTask, getAgentTaskQueue } = await import('../task-queue');
            const { getApprovalRegistry } = await import('../../task-sandbox/approval-gate');

            let approvalId = '';
            let aResult: { decision: string; reason?: string } | undefined;
            const aDone = dispatchAgentTask({
                taskId: 'wiring-A', userId: 'u1',
                run: async () => {
                    aResult = await getApprovalRegistry().request(
                        { taskId: 'wiring-A', userId: 'u1', toolName: 'memory_save', args: { content: '라이브 S2' } },
                        { timeoutMs: 600_000, parkable: true, onPending: (p) => { approvalId = p.approvalId; } },
                    );
                },
            });
            expect(await aDone).toBe('started');
            for (let i = 0; i < 10 && !approvalId; i++) await tick();
            expect(approvalId).not.toBe('');

            let finishB: () => void = () => undefined;
            let bStarted = false;
            const outcome = await dispatchAgentTask({
                taskId: 'wiring-B', userId: 'u1',
                run: () => new Promise<void>((resolve) => { bStarted = true; finishB = resolve; }),
            });
            expect(outcome).toBe('started');
            expect(bStarted).toBe(true);

            // B 가 끝난 뒤 결정 — 자리가 있으니 되찾아 그 자리에서 승인으로 진행한다(주차 없음)
            finishB();
            await tick(); await tick();
            await getApprovalRegistry().approve(approvalId, 'u1');
            for (let i = 0; i < 10 && !aResult; i++) await tick();
            expect(aResult).toMatchObject({ decision: 'approved' });
            await tick();
            expect(getAgentTaskQueue().stats().globalActive).toBe(0);
        });
    });
});
