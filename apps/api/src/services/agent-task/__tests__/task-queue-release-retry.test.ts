/**
 * 자리 반납 뒤 재시도(주차 재개 지연 해소) — 직전 실행이 큐 자리를 쥔 동안 보류된 재개는 자리가 반납되는 즉시 한 번 다시 시도된다.
 * 큐 on(submit)·off(runDirect) 양쪽, 그리고 실제 resumeParkedTask 와 묶은 흐름.
 */
const getAgentTask = jest.fn();
const updateAgentTask = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ getAgentTask, getAgentTaskSteps: async () => [], updateAgentTask: (...a: unknown[]) => updateAgentTask(...a) }),
    getPool: () => ({}),
}));
const claimParkedTask = jest.fn(async (..._a: unknown[]) => true);
jest.mock('../../../data/repositories/agent-task-repository', () => ({ AgentTaskRepository: jest.fn().mockImplementation(() => ({ claimParkedTask })) }));
jest.mock('../../../data/repositories/agent-task-approval-repository', () => ({ AgentTaskApprovalRepository: jest.fn() }));
const execute = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../AgentTaskService', () => ({ AgentTaskService: jest.fn().mockImplementation(() => ({ execute })) }));
jest.mock('../boot-recovery', () => ({ resolveUserRole: async () => 'user' }));
jest.mock('../../local-bridge/registry', () => ({ getLocalBridgeRegistry: () => ({ getDevice: () => undefined }) }));

import { AgentTaskQueue, getAgentTaskQueue } from '../task-queue';
import { resumeParkedTask } from '../hitl-park';

function job() {
    let finish = (): void => undefined;
    const run = () => new Promise<void>((resolve) => { finish = () => resolve(); });
    return { run, finish: async () => { finish(); await flush(); } };
}
async function flush(): Promise<void> { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); }

const parkedTask = {
    id: 't1', user_id: 'u1', goal: 'g', status: 'paused', max_turns: 10, priority: 0, executor: 'sandbox',
    checkpoint: { conversation: [{ role: 'user', content: 'g' }], completedTurn: 3 }, plan: [], input_files: null, input_images: null,
};

beforeEach(() => { jest.clearAllMocks(); claimParkedTask.mockResolvedValue(true); });

describe('AgentTaskQueue.retryAfterRelease', () => {
    const holders: Array<[string, (q: AgentTaskQueue, run: () => Promise<void>) => unknown]> = [
        ['큐 on(submit)', (q, run) => q.submit({ taskId: 't1', userId: 'u1', run })],
        ['큐 off(runDirect)', (q, run) => q.runDirect({ taskId: 't1', userId: 'u1', run })],
    ];
    it.each(holders)('%s — 자리를 쥔 동안 등록한 재시도는 자리 반납 뒤 한 번만 실행된다(중복 등록은 한 건)', async (_n, hold) => {
        const q = new AgentTaskQueue(2, 1);
        const a = job();
        hold(q, a.run);
        const retry = jest.fn(() => { expect(q.has('t1')).toBe(false); });
        q.retryAfterRelease('t1', retry);
        q.retryAfterRelease('t1', retry);
        expect(retry).not.toHaveBeenCalled();
        await a.finish();
        expect(retry).toHaveBeenCalledTimes(1);
        // 실행 후 제거 — 같은 작업이 다시 돌고 끝나도 또 불리지 않는다
        const b = job();
        hold(q, b.run);
        await b.finish();
        expect(retry).toHaveBeenCalledTimes(1);
    });
    it.each(holders)('%s — 등록이 없던 작업은 자리 반납 때 아무 일도 없다', async (_n, hold) => {
        const q = new AgentTaskQueue(2, 1);
        const a = job();
        const other = jest.fn();
        hold(q, a.run);
        q.submit({ taskId: 't2', userId: 'u2', run: job().run });
        q.retryAfterRelease('t2', other);
        await a.finish();
        expect(other).not.toHaveBeenCalled();
    });
    it('자리를 쥐고 있지 않은 작업에는 등록되지 않는다(쌓이지 않는다)', async () => {
        const q = new AgentTaskQueue(2, 1);
        const retry = jest.fn();
        q.retryAfterRelease('t1', retry);
        const a = job();
        q.submit({ taskId: 't1', userId: 'u1', run: a.run });
        await a.finish();
        expect(retry).not.toHaveBeenCalled();
    });
    it.each(holders)('%s — 재시도가 던지거나 reject 해도 큐 동작은 그대로다', async (_n, hold) => {
        const q = new AgentTaskQueue(1, 1);
        const a = job();
        const b = job();
        hold(q, a.run);
        q.retryAfterRelease('t1', () => { throw new Error('boom'); });
        const started = jest.fn(b.run);
        const queuedOn = q.submit({ taskId: 't2', userId: 'u2', run: started }) === 'queued';
        await a.finish();
        expect(q.has('t1')).toBe(false);
        if (queuedOn) expect(started).toHaveBeenCalledTimes(1); // 대기 중이던 다음 작업이 꺼내졌다
        await b.finish();
        const c = job();
        hold(q, c.run);
        q.retryAfterRelease('t1', async () => { throw new Error('async boom'); });
        await c.finish();
        expect(q.has('t1')).toBe(false);
        expect(q.stats()).toMatchObject({ globalActive: 0, pending: 0 });
    });
});

describe('resumeParkedTask — 자리 반납 뒤 자동 재개', () => {
    const holders: Array<[string, (run: () => Promise<void>) => unknown]> = [
        ['큐 on(submit)', (run) => getAgentTaskQueue().submit({ taskId: 't1', userId: 'u1', run })],
        ['큐 off(runDirect)', (run) => getAgentTaskQueue().runDirect({ taskId: 't1', userId: 'u1', run })],
    ];
    it.each(holders)('%s — 종료 정리 중에는 false, 자리가 반납되면 스윕을 기다리지 않고 재개된다', async (_n, hold) => {
        getAgentTask.mockResolvedValue(parkedTask);
        const prev = job();
        hold(prev.run);
        await expect(resumeParkedTask('t1')).resolves.toBe(false);
        expect(claimParkedTask).not.toHaveBeenCalled();
        await prev.finish();
        expect(claimParkedTask).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledWith(expect.objectContaining({ taskId: 't1', resume: expect.objectContaining({ fromTurn: 4 }) }));
        await flush();
        expect(getAgentTaskQueue().has('t1')).toBe(false);
    });
    it('재시도는 기존 검사를 다시 거친다 — 그 사이 주차가 풀렸으면(paused 아님) 아무 일도 없다', async () => {
        getAgentTask.mockResolvedValueOnce(parkedTask).mockResolvedValue({ ...parkedTask, status: 'failed' });
        const prev = job();
        getAgentTaskQueue().runDirect({ taskId: 't1', userId: 'u1', run: prev.run });
        await expect(resumeParkedTask('t1')).resolves.toBe(false);
        await prev.finish();
        expect(claimParkedTask).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
    });
    it('보류된 재개가 없던 작업은 자리 반납 때 재개 검사조차 하지 않는다', async () => {
        const prev = job();
        getAgentTaskQueue().runDirect({ taskId: 't1', userId: 'u1', run: prev.run });
        await prev.finish();
        expect(getAgentTask).not.toHaveBeenCalled();
    });
    it('재시도 중 예외(조회 실패)는 삼켜지고 큐는 계속 쓸 수 있다', async () => {
        getAgentTask.mockResolvedValueOnce(parkedTask).mockRejectedValueOnce(new Error('db down'));
        const prev = job();
        getAgentTaskQueue().runDirect({ taskId: 't1', userId: 'u1', run: prev.run });
        await expect(resumeParkedTask('t1')).resolves.toBe(false);
        await prev.finish();
        expect(execute).not.toHaveBeenCalled();
        const again = job();
        expect(getAgentTaskQueue().runDirect({ taskId: 't1', userId: 'u1', run: again.run })).toBe('started');
        await again.finish();
    });
});
