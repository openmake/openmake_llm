/**
 * 실패 분류·우선순위(131) 저장 — failed 전이는 error 로 분류해 기록, 다른 전이는 분류를 지우고, 실패 큐는 필터·집계.
 */
import type { Pool } from 'pg';
import { AgentTaskRepository } from '../agent-task-repository';

function fakePool(rows: Array<{ rows: unknown[]; rowCount?: number }>) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
        query: jest.fn(async (sql: string, params: unknown[] = []) => {
            calls.push({ sql, params });
            return rows.shift() ?? { rows: [], rowCount: 0 };
        }),
    };
    return { pool: pool as unknown as Pool, calls };
}

/** SET 절에서 `컬럼 = $n` 의 n 번째 파라미터 값 */
function setParam(call: { sql: string; params: unknown[] }, column: string): unknown {
    const m = call.sql.match(new RegExp(`${column} = \\$(\\d+)`));
    return m ? call.params[Number(m[1]) - 1] : undefined;
}

describe('AgentTaskRepository — 실패 분류·우선순위(131)', () => {
    it('failed 전이는 error 로 failure_class 를 기록한다', async () => {
        const { pool, calls } = fakePool([{ rows: [{ prev: 'running' }], rowCount: 1 }]);
        await new AgentTaskRepository(pool).updateAgentTask('t1', { status: 'failed', error: 'Request timed out.' });
        expect(setParam(calls[0], 'failure_class')).toBe('timeout');
        expect(setParam(calls[0], 'error')).toBe('Request timed out.');
        expect(setParam(calls[0], 'status')).toBe('failed');
    });

    it('failed 가 아닌 전이는 failure_class 를 지운다', async () => {
        const { pool, calls } = fakePool([{ rows: [{ prev: 'failed' }], rowCount: 1 }]);
        await new AgentTaskRepository(pool).updateAgentTask('t1', { status: 'pending', progress: 0 });
        expect(calls[0].sql).toContain('failure_class = NULL');
        expect(setParam(calls[0], 'progress')).toBe(0);
    });

    it('상태 없는 갱신은 분류를 건드리지 않고 priority 만 쓴다', async () => {
        const { pool, calls } = fakePool([{ rows: [], rowCount: 1 }]);
        await new AgentTaskRepository(pool).updateAgentTask('t1', { priority: -1 });
        expect(calls[0].sql).not.toContain('failure_class');
        expect(setParam(calls[0], 'priority')).toBe(-1);
    });

    it('실패 큐 — 분류 필터·기간·상한을 파라미터로 넘기고 분류별 건수를 모은다', async () => {
        const { pool, calls } = fakePool([
            { rows: [{ id: 't1', failure_class: 'timeout' }] },
            { rows: [{ c: 'timeout', n: '3' }, { c: null, n: '2' }] },
        ]);
        const r = await new AgentTaskRepository(pool).listFailedAgentTasks({ failureClass: 'timeout', sinceDays: 7, limit: 50 });
        expect(calls[0].params).toEqual([7, 'timeout', 50]);
        expect(calls[0].sql).toContain('failure_class = $2');
        expect(calls[0].sql).toContain('LIMIT $3');
        expect(r.byClass).toEqual({ timeout: 3, unclassified: 2 });

        const { pool: p2, calls: c2 } = fakePool([{ rows: [] }, { rows: [] }]);
        await new AgentTaskRepository(p2).listFailedAgentTasks({ sinceDays: 1, limit: 10 });
        expect(c2[0].params).toEqual([1, 10]);
        expect(c2[0].sql).toContain('LIMIT $2');
    });
});
