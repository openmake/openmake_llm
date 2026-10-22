/**
 * 마지막 진행 시각(191, R8) SQL — 실행 중 작업만 앞으로만 갱신하고, 멈춘 실행 중 작업 조회는 주차·승인 대기를 뺀다.
 * 191 미적용(컬럼 없음, 42703)이면 한 번만 경고하고 건너뛴다.
 */
import type { Pool } from 'pg';
const warn = jest.fn();
jest.mock('../../../utils/logger', () => ({
    createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: (m: string) => warn(m), error: jest.fn() }),
}));
import { AgentTaskProgressRepository } from '../agent-task-progress-repository';
import { parkedTaskCondition } from '../agent-task-repository';

const COLUMN_MISSING_WARNING = 'last_progress_at 컬럼 없음(191 미적용) — 진행 기록 생략';

function fakePool(results: Array<{ rows: unknown[]; rowCount?: number }>) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = { query: jest.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return results.shift() ?? { rows: [], rowCount: 0 }; }) };
    return { pool: pool as unknown as Pool, calls };
}

function columnMissingPool(): Pool {
    return { query: jest.fn(async () => { throw Object.assign(new Error('column "last_progress_at" does not exist'), { code: '42703' }); }) } as unknown as Pool;
}

describe('AgentTaskProgressRepository', () => {
    it('flushProgress — 항목마다 실행 중 작업의 last_progress_at 을 앞으로만 갱신하고 영향 행 합계를 돌려준다', async () => {
        const { pool, calls } = fakePool([{ rows: [], rowCount: 1 }, { rows: [], rowCount: 0 }]);
        const a = new Date(1_000), b = new Date(2_000);
        await expect(new AgentTaskProgressRepository(pool).flushProgress([{ taskId: 't1', at: a }, { taskId: 't2', at: b }])).resolves.toBe(1);
        expect(calls).toHaveLength(2);
        for (const c of calls) {
            expect(c.sql).toContain('last_progress_at');
            expect(c.sql).toContain('GREATEST');
            expect(c.sql).toContain("status = 'running'");
        }
        expect(calls[0].params).toEqual(['t1', a.toISOString()]);
        expect(calls[1].params).toEqual(['t2', b.toISOString()]);
    });

    it('listStaleRunningTasks — 실행 중·주차 아님·살아 있는 승인 대기 없음·진행이 staleMs 보다 오래된 작업', async () => {
        const row = { id: 't1', user_id: 'u1', current_turn: 3, lease_owner: 'host:0', stalled_ms: '960000' };
        const { pool, calls } = fakePool([{ rows: [row] }]);
        await expect(new AgentTaskProgressRepository(pool).listStaleRunningTasks(900_000, 50))
            .resolves.toEqual([{ ...row, stalled_ms: 960_000 }]); // pg 는 bigint 를 문자열로 준다
        const sql = calls[0].sql;
        expect(sql).toContain("t.status = 'running'");
        expect(sql).toContain(parkedTaskCondition('t'));
        expect(sql).toContain('agent_task_approvals');
        expect(sql).toContain('expires_at > NOW()');
        expect(sql).toContain('make_interval');
        // 재개 직후(다음 flush 전)엔 상태 전이가 올린 updated_at 이 옛 last_progress_at 을 이긴다 — 조건·정렬·stalled_ms 모두 같은 식
        expect(sql.split('GREATEST(COALESCE(t.last_progress_at, to_timestamp(0)), t.updated_at)')).toHaveLength(4);
        expect(sql).not.toContain('COALESCE(t.last_progress_at, t.updated_at)');
        expect(calls[0].params).toEqual([900_000, 50]);
    });

    it('191 미적용(42703) — flush 는 0, 조회는 빈 배열, 경고는 한 번만', async () => {
        const repo = new AgentTaskProgressRepository(columnMissingPool());
        await expect(repo.flushProgress([{ taskId: 't1', at: new Date() }])).resolves.toBe(0);
        expect(warn.mock.calls.filter(([m]) => m === COLUMN_MISSING_WARNING)).toHaveLength(1);
        await expect(repo.flushProgress([{ taskId: 't1', at: new Date() }])).resolves.toBe(0);
        await expect(repo.listStaleRunningTasks(900_000)).resolves.toEqual([]);
        expect(warn.mock.calls.filter(([m]) => m === COLUMN_MISSING_WARNING)).toHaveLength(1);
    });

    it('그 밖의 오류는 던진다', async () => {
        const pool = { query: jest.fn(async () => { throw Object.assign(new Error('boom'), { code: '23505' }); }) } as unknown as Pool;
        await expect(new AgentTaskProgressRepository(pool).flushProgress([{ taskId: 't1', at: new Date() }])).rejects.toThrow('boom');
    });
});
