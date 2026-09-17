/**
 * 주차(F16.7) SQL — 표식은 paused→paused(hitl_parked) 이벤트, 재개 claim·목록·부팅 복구가 같은 조건을 쓴다.
 */
import type { Pool } from 'pg';
import { AgentTaskRepository, parkedTaskCondition } from '../agent-task-repository';

function fakePool(results: Array<{ rows: unknown[]; rowCount?: number }>) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = { query: jest.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return results.shift() ?? { rows: [], rowCount: 0 }; }) };
    return { pool: pool as unknown as Pool, calls };
}

describe('AgentTaskRepository — 주차(F16.7)', () => {
    it('parkedTaskCondition 은 paused + 마지막 이벤트 사유 hitl_parked', () => {
        const c = parkedTaskCondition('t');
        expect(c).toContain("t.status = 'paused'");
        expect(c).toContain('ORDER BY e.id DESC LIMIT 1');
        expect(c).toContain('COALESCE('); // NULL 사유에서 NOT(조건) 이 NULL 이 되지 않게(부팅 마킹 누락 방지)
        expect(c).toContain("= 'hitl_parked'");
    });

    it('markParked 는 오류를 삼키지 않는다', async () => {
        const pool = { query: jest.fn(async () => { throw new Error('db down'); }) } as unknown as Pool;
        await expect(new AgentTaskRepository(pool).markParked('t1')).rejects.toThrow();
    });

    it('claimParkedTask — 주차 조건으로 pending 전이하고 성공 시에만 이벤트를 남긴다', async () => {
        const { pool, calls } = fakePool([{ rows: [{ id: 't1' }], rowCount: 1 }, { rows: [], rowCount: 1 }]);
        await expect(new AgentTaskRepository(pool).claimParkedTask('t1')).resolves.toBe(true);
        expect(calls[0].sql).toContain(parkedTaskCondition('t'));
        expect(calls[1].params).toEqual(['t1', 'paused', 'pending', 'hitl_park_resume']);
        const lost = fakePool([{ rows: [], rowCount: 0 }]);
        await expect(new AgentTaskRepository(lost.pool).claimParkedTask('t1')).resolves.toBe(false);
        expect(lost.calls).toHaveLength(1);
    });

    it('부팅 복구 조회·claim 은 주차 작업을 뺀다', async () => {
        const { pool, calls } = fakePool([{ rows: [] }, { rows: [], rowCount: 0 }]);
        const repo = new AgentTaskRepository(pool);
        await repo.getInterruptedAgentTasks(60_000);
        await repo.claimAgentTaskForRecovery('t1');
        expect(calls[0].sql).toContain(`NOT ${parkedTaskCondition('agent_tasks')}`);
        expect(calls[1].sql).toContain(`NOT ${parkedTaskCondition('t')}`);
    });
});
