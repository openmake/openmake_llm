/**
 * worktree 격리 상태(200) 저장 — 값은 JSON 으로, null 은 SQL NULL 로 쓰고, 넘기지 않으면 칸을 건드리지 않는다.
 */
import type { Pool } from 'pg';
import { AgentTaskRepository } from '../agent-task-repository';

function fakePool() {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = { query: jest.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: [], rowCount: 1 }; }) };
    return { pool: pool as unknown as Pool, calls };
}

function setParam(call: { sql: string; params: unknown[] }, column: string): unknown {
    const m = call.sql.match(new RegExp(`\\b${column} = \\$(\\d+)`));
    return m ? call.params[Number(m[1]) - 1] : undefined;
}

describe('AgentTaskRepository — worktree 격리 상태(200)', () => {
    it('값을 JSON 문자열로 쓴다', async () => {
        const { pool, calls } = fakePool();
        const isolation = { state: 'worktree' as const, branch: 'omk-task/abcd1234', worktreeRel: '.openmake/worktrees/t1' };
        await new AgentTaskRepository(pool).updateAgentTask('t1', { isolation });
        expect(JSON.parse(setParam(calls[0], 'isolation') as string)).toEqual(isolation);
    });

    it('null 은 SQL NULL 로 쓴다', async () => {
        const { pool, calls } = fakePool();
        await new AgentTaskRepository(pool).updateAgentTask('t1', { isolation: null });
        expect(calls[0].sql).toMatch(/\bisolation = \$\d+/);
        expect(setParam(calls[0], 'isolation')).toBeNull();
    });

    it('넘기지 않으면 칸을 건드리지 않는다', async () => {
        const { pool, calls } = fakePool();
        await new AgentTaskRepository(pool).updateAgentTask('t1', { progress: 10 });
        expect(calls[0].sql).not.toContain('isolation');
    });
});
