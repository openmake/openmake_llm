/**
 * 같은 taskId 중복 제출 거부(2026-10-09 점검 ①) — 실행 중이든 대기 중이든 두 번째 submit 은 'duplicate' 이고 대기열에 들어가지 않는다.
 */
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ updateAgentTask: async () => undefined }) }));

import { AgentTaskQueue } from '../task-queue';

function job() {
    let finish = (): void => undefined;
    const run = () => new Promise<void>((resolve) => { finish = () => resolve(); });
    return { run, finish: async () => { finish(); await new Promise((r) => setImmediate(r)); } };
}

describe('AgentTaskQueue — taskId 중복', () => {
    it('실행 중인 taskId 를 다시 제출하면 duplicate 이고 실행·대기 수가 늘지 않는다', async () => {
        const q = new AgentTaskQueue(2, 1);
        const a = job();
        expect(q.submit({ taskId: 't1', userId: 'u1', run: a.run })).toBe('started');
        expect(q.submit({ taskId: 't1', userId: 'u1', run: job().run })).toBe('duplicate');
        expect(q.stats()).toMatchObject({ globalActive: 1, pending: 0 });
        await a.finish();
        expect(q.stats()).toMatchObject({ globalActive: 0, pending: 0 });
    });
    it('대기 중인 taskId 를 다시 제출해도 duplicate 이고 대기열은 한 건이다(사용자 상한 1)', () => {
        const q = new AgentTaskQueue(2, 1);
        expect(q.submit({ taskId: 't1', userId: 'u1', run: job().run })).toBe('started');
        expect(q.submit({ taskId: 't2', userId: 'u1', run: job().run })).toBe('queued');
        expect(q.submit({ taskId: 't2', userId: 'u1', run: job().run })).toBe('duplicate');
        expect(q.stats().pending).toBe(1);
        expect(q.position('t2')).toBe(1);
    });
    it('끝난 taskId 는 다시 제출할 수 있다', async () => {
        const q = new AgentTaskQueue(2, 1);
        const a = job();
        q.submit({ taskId: 't1', userId: 'u1', run: a.run });
        await a.finish();
        expect(q.submit({ taskId: 't1', userId: 'u1', run: job().run })).toBe('started');
    });
});
