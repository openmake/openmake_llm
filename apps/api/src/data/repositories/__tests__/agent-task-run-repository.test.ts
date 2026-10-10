/**
 * 실행 시작 claim(2026-10-09 점검 ①) — pending/failed/cancelled 에서만 queued 로 원자 전이. 0행이면 다른 요청이 먼저 잡은 것.
 */
import type { Pool } from 'pg';
import { AgentTaskRunRepository } from '../agent-task-run-repository';

function fakePool(results: Array<{ rows: unknown[]; rowCount?: number }>) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = { query: jest.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return results.shift() ?? { rows: [], rowCount: 0 }; }) };
    return { pool: pool as unknown as Pool, calls };
}

describe('AgentTaskRunRepository.claimForExecute', () => {
    it('pending/failed/cancelled 에서만 queued 로 잡고 이전 상태로 이벤트를 남긴다', async () => {
        const { pool, calls } = fakePool([{ rows: [{ prev: 'failed' }], rowCount: 1 }, { rows: [], rowCount: 1 }]);
        await expect(new AgentTaskRunRepository(pool).claimForExecute('t1', { resetProgress: true, reason: 'execute claim' })).resolves.toBe(true);
        expect(calls[0].sql).toContain("SET status = 'queued'");
        expect(calls[0].sql).toContain('progress = 0');
        expect(calls[0].sql).toContain("o.prev IN ('pending', 'failed', 'cancelled')");
        expect(calls[0].sql).toContain('FOR UPDATE');
        expect(calls[0].sql).toContain('RETURNING o.prev');
        expect(calls[0].params).toEqual(['t1']);
        expect(calls[1].sql).toContain('INSERT INTO agent_task_events');
        expect(calls[1].params).toEqual(['t1', 'failed', 'queued', 'execute claim']);
    });

    it('resume claim 은 progress 를 건드리지 않는다', async () => {
        const { pool, calls } = fakePool([{ rows: [{ prev: 'cancelled' }], rowCount: 1 }, { rows: [], rowCount: 1 }]);
        await expect(new AgentTaskRunRepository(pool).claimForExecute('t1', { resetProgress: false, reason: 'resume claim' })).resolves.toBe(true);
        expect(calls[0].sql).not.toContain('progress = 0');
        expect(calls[1].params).toEqual(['t1', 'cancelled', 'queued', 'resume claim']);
    });

    it('0행(이미 queued/running/paused/completed)이면 false 이고 이벤트를 남기지 않는다', async () => {
        const { pool, calls } = fakePool([{ rows: [], rowCount: 0 }]);
        await expect(new AgentTaskRunRepository(pool).claimForExecute('t1', { resetProgress: true, reason: 'execute claim' })).resolves.toBe(false);
        expect(calls).toHaveLength(1);
    });
});
