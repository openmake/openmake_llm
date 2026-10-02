/**
 * 실행 소유권(176) SQL — 잡기·연장·반납·지난 소유권 가져오기는 조건부 UPDATE 이고, 부팅 복구 조회는 다른 서버의 살아 있는 작업을 뺀다.
 */
import type { Pool } from 'pg';
import { AgentTaskRepository, parkedTaskCondition } from '../agent-task-repository';

function fakePool(results: Array<{ rows: unknown[]; rowCount?: number }>) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = { query: jest.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return results.shift() ?? { rows: [], rowCount: 0 }; }) };
    return { pool: pool as unknown as Pool, calls };
}

describe('AgentTaskRepository — 실행 소유권', () => {
    it('acquireLease — 소유권이 없거나 내 것이거나 지났을 때만 잡는다', async () => {
        const { pool, calls } = fakePool([{ rows: [], rowCount: 1 }, { rows: [], rowCount: 0 }]);
        const repo = new AgentTaskRepository(pool);
        await expect(repo.acquireLease('t1', 'host:0', 60_000)).resolves.toBe(true);
        await expect(repo.acquireLease('t1', 'host:0', 60_000)).resolves.toBe(false);
        expect(calls[0].sql).toContain('lease_owner IS NULL OR lease_owner = $2 OR lease_until < NOW()');
        expect(calls[0].params).toEqual(['t1', 'host:0', 60]);
    });

    it('renewLease — 여전히 내 것일 때만 연장한다(0행 = 잃음)', async () => {
        const { pool, calls } = fakePool([{ rows: [], rowCount: 1 }, { rows: [], rowCount: 0 }]);
        const repo = new AgentTaskRepository(pool);
        await expect(repo.renewLease('t1', 'host:0', 60_000)).resolves.toBe(true);
        await expect(repo.renewLease('t1', 'host:0', 60_000)).resolves.toBe(false);
        expect(calls[0].sql).toContain('WHERE id = $1 AND lease_owner = $2');
    });

    it('releaseLease — 내 것일 때만 비운다', async () => {
        const { pool, calls } = fakePool([{ rows: [], rowCount: 1 }]);
        await new AgentTaskRepository(pool).releaseLease('t1', 'host:0');
        expect(calls[0].sql).toContain('lease_owner = NULL, lease_until = NULL');
        expect(calls[0].sql).toContain('AND lease_owner = $2');
    });

    it('listExpiredLeaseTasks — 실행 중이고 소유권이 지난 작업만, 주차·소유권 없는 작업은 뺀다', async () => {
        const { pool, calls } = fakePool([{ rows: [{ id: 't1' }] }]);
        await expect(new AgentTaskRepository(pool).listExpiredLeaseTasks()).resolves.toEqual([{ id: 't1' }]);
        expect(calls[0].sql).toContain("status IN ('running', 'paused')");
        expect(calls[0].sql).toContain('lease_until IS NOT NULL AND lease_until < NOW()');
        expect(calls[0].sql).toContain(`NOT ${parkedTaskCondition('agent_tasks')}`);
    });

    it('takeOverExpiredLease — 지난 소유권만 원자적으로 가져온다', async () => {
        const { pool, calls } = fakePool([{ rows: [], rowCount: 1 }, { rows: [], rowCount: 0 }]);
        const repo = new AgentTaskRepository(pool);
        await expect(repo.takeOverExpiredLease('t1', 'host:1', 60_000)).resolves.toBe(true);
        await expect(repo.takeOverExpiredLease('t1', 'host:1', 60_000)).resolves.toBe(false);
        expect(calls[0].sql).toContain('lease_until IS NOT NULL AND lease_until < NOW()');
    });

    it('부팅 복구 조회 — owner 를 주면 다른 서버의 살아 있는 소유권을 가진 실행 중 작업을 뺀다', async () => {
        const { pool, calls } = fakePool([{ rows: [] }, { rows: [] }]);
        const repo = new AgentTaskRepository(pool);
        await repo.getInterruptedAgentTasks(60_000, 'host:0');
        expect(calls[0].sql).toContain('lease_owner IS NULL OR lease_owner = $2 OR lease_until < NOW()');
        expect(calls[0].params).toEqual([60, 'host:0']);
        await repo.getInterruptedAgentTasks(60_000);
        expect(calls[1].sql).not.toContain('lease_owner'); // owner 없이 부르면 종전 조회(소유권 끔·176 적용 전)
        expect(calls[1].params).toEqual([60]);
    });
});
