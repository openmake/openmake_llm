/**
 * 실행 소유권(176) SQL — 잡기·연장·반납·지난 소유권 가져오기는 조건부 UPDATE 이고, 부팅 복구 조회는 다른 서버의 살아 있는 작업을 뺀다.
 */
import type { Pool } from 'pg';
import { AgentTaskRepository, parkedTaskCondition } from '../agent-task-repository';
import { AgentTaskLeaseRepository } from '../agent-task-lease-repository';

function fakePool(results: Array<{ rows: unknown[]; rowCount?: number }>) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = { query: jest.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return results.shift() ?? { rows: [], rowCount: 0 }; }) };
    return { pool: pool as unknown as Pool, calls };
}

describe('AgentTaskRepository — 실행 소유권', () => {
    it('acquireLease — 소유권이 없거나 내 것이거나 지났을 때만 잡는다', async () => {
        const { pool, calls } = fakePool([{ rows: [], rowCount: 1 }, { rows: [], rowCount: 0 }]);
        const repo = new AgentTaskLeaseRepository(pool);
        await expect(repo.acquireLease('t1', 'host:0', 60_000)).resolves.toBe(true);
        await expect(repo.acquireLease('t1', 'host:0', 60_000)).resolves.toBe(false);
        expect(calls[0].sql).toContain('lease_owner IS NULL OR lease_owner = $2 OR lease_until < NOW()');
        expect(calls[0].params).toEqual(['t1', 'host:0', 60]);
    });

    it('renewLease — 여전히 내 것일 때만 연장한다(0행 = 잃음)', async () => {
        const { pool, calls } = fakePool([{ rows: [], rowCount: 1 }, { rows: [], rowCount: 0 }]);
        const repo = new AgentTaskLeaseRepository(pool);
        await expect(repo.renewLease('t1', 'host:0', 60_000)).resolves.toBe(true);
        await expect(repo.renewLease('t1', 'host:0', 60_000)).resolves.toBe(false);
        expect(calls[0].sql).toContain('WHERE id = $1 AND lease_owner = $2');
    });

    it('releaseLease — 내 것일 때만 비운다', async () => {
        const { pool, calls } = fakePool([{ rows: [], rowCount: 1 }]);
        await new AgentTaskLeaseRepository(pool).releaseLease('t1', 'host:0');
        expect(calls[0].sql).toContain('lease_owner = NULL, lease_until = NULL');
        expect(calls[0].sql).toContain('AND lease_owner = $2');
    });

    it('listExpiredLeaseTasks — 실행 중이고 소유권이 지난 작업만, 주차·소유권 없는 작업은 뺀다', async () => {
        const { pool, calls } = fakePool([{ rows: [{ id: 't1' }] }]);
        await expect(new AgentTaskLeaseRepository(pool).listExpiredLeaseTasks()).resolves.toEqual([{ id: 't1' }]);
        expect(calls[0].sql).toContain("status IN ('running', 'paused', 'pending')");
        expect(calls[0].sql).toContain('lease_until IS NOT NULL AND lease_until < NOW()');
        expect(calls[0].sql).toContain(`NOT ${parkedTaskCondition('agent_tasks')}`);
    });

    // claim(pending 전이)과 running 사이에서 죽은 행 — claim 이 소유권을 같이 쓰므로 지나면 주기 점검이 가져간다(2026-10-22 R2)
    it('listExpiredLeaseTasks/takeOverExpiredLease — 소유권이 있고 지난 pending(claim 고아)도 대상', async () => {
        const { pool, calls } = fakePool([{ rows: [] }, { rows: [], rowCount: 1 }]);
        const repo = new AgentTaskLeaseRepository(pool);
        await repo.listExpiredLeaseTasks();
        await expect(repo.takeOverExpiredLease('t1', 'host:1', 60_000)).resolves.toBe(true);
        for (const c of calls) {
            expect(c.sql).toContain("status IN ('running', 'paused', 'pending')");
            expect(c.sql).toContain('lease_until IS NOT NULL AND lease_until < NOW()'); // 실행한 적 없는 pending(소유권 NULL)은 빠진다
        }
    });

    it('takeOverExpiredLease — 지난 소유권만 원자적으로 가져온다', async () => {
        const { pool, calls } = fakePool([{ rows: [], rowCount: 1 }, { rows: [], rowCount: 0 }]);
        const repo = new AgentTaskLeaseRepository(pool);
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

    it('getInterruptedAgentTasks — 소유권 있는 pending 을 포함하고 소유권 없는 pending 은 제외', async () => {
        const { pool, calls } = fakePool([{ rows: [] }, { rows: [] }]);
        const repo = new AgentTaskRepository(pool);
        await repo.getInterruptedAgentTasks(60_000, 'host:0');
        expect(calls[0].sql).toContain("status = 'pending' AND lease_until IS NOT NULL");
        // running/paused/queued 와 같은 묶음 — 주차·다른 서버의 살아 있는 소유권은 똑같이 뺀다
        expect(calls[0].sql).toMatch(/\(\(status IN \('running', 'paused', 'queued'\) OR \(status = 'pending' AND lease_until IS NOT NULL\)\) AND NOT /);
        await repo.getInterruptedAgentTasks(60_000);
        expect(calls[1].sql).not.toContain('lease_until'); // 176 적용 전 종전 조회는 소유권 컬럼을 읽지 않는다
    });

    it('claimAgentTaskForRecovery — lease 를 주면 같은 문장에서 lease_owner·lease_until 을 쓴다', async () => {
        const { pool, calls } = fakePool([{ rows: [{ prev: 'pending' }], rowCount: 1 }, { rows: [], rowCount: 1 }, { rows: [], rowCount: 0 }]);
        const repo = new AgentTaskRepository(pool);
        await expect(repo.claimAgentTaskForRecovery('t1', 'pending', { owner: 'host:0', leaseMs: 60_000 })).resolves.toBe(true);
        expect(calls[0].sql).toContain('lease_owner = $3, lease_until = NOW() + make_interval(secs => $4)');
        // 소유권 있는 pending 도 대상 — 단 지났거나 내 것일 때만(목록을 읽은 뒤 다른 서버가 가져갔으면 0행)
        expect(calls[0].sql).toContain("(o.prev = 'pending' AND o.lease_until IS NOT NULL AND (o.lease_until < NOW() OR o.lease_owner = $3))");
        expect(calls[0].sql).toContain('SELECT id, status AS prev, lease_until, lease_owner FROM agent_tasks');
        expect(calls[0].params).toEqual(['t1', 'pending', 'host:0', 60]);
        await repo.claimAgentTaskForRecovery('t1', 'failed');
        expect(calls[2].sql).not.toContain('lease_'); // 소유권을 끄면(또는 176 적용 전) 종전 문장
        expect(calls[2].params).toEqual(['t1', 'failed']);
    });

    it('claimParkedTask — lease 를 주면 같은 문장에서 lease_owner·lease_until 을 쓴다', async () => {
        const { pool, calls } = fakePool([{ rows: [{ id: 't1' }], rowCount: 1 }, { rows: [], rowCount: 1 }, { rows: [], rowCount: 0 }]);
        const repo = new AgentTaskRepository(pool);
        await expect(repo.claimParkedTask('t1', { owner: 'host:0', leaseMs: 60_000 })).resolves.toBe(true);
        expect(calls[0].sql).toContain('lease_owner = $2, lease_until = NOW() + make_interval(secs => $3)');
        expect(calls[0].sql).toContain(parkedTaskCondition('t'));
        expect(calls[0].params).toEqual(['t1', 'host:0', 60]);
        await repo.claimParkedTask('t1');
        expect(calls[2].sql).not.toContain('lease_');
        expect(calls[2].params).toEqual(['t1']);
    });
});
