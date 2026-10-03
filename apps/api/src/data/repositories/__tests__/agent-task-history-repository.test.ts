/**
 * 과거 작업 조회(교훈 후보·검색) SQL — 사용자 범위와 출처·실패 분류 조건.
 */
import type { Pool } from 'pg';
import { AgentTaskHistoryRepository } from '../agent-task-history-repository';

function fakePool(results: Array<{ rows: unknown[] }> = []) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = { query: jest.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return results.shift() ?? { rows: [] }; }) };
    return { pool: pool as unknown as Pool, calls };
}

describe('AgentTaskHistoryRepository.getLessonCandidates', () => {
    it('예약이 만든 작업과 환경 탓 실패를 뺀다', async () => {
        const { pool, calls } = fakePool();
        await new AgentTaskHistoryRepository(pool).getLessonCandidates('u1', 30, { skipScheduled: true, skipFailureClasses: ['interrupted', 'llm_error'] });
        expect(calls[0].sql).toContain('user_id = $1');
        expect(calls[0].sql).toContain('NOT EXISTS (SELECT 1 FROM agent_task_schedule_runs');
        expect(calls[0].sql).toContain('failure_class = ANY(');
        expect(calls[0].params).toEqual(['u1', ['interrupted', 'llm_error'], 30]);
    });

    it('조건을 끄면 종전 조회와 같다', async () => {
        const { pool, calls } = fakePool();
        await new AgentTaskHistoryRepository(pool).getLessonCandidates('u1', 30, { skipScheduled: false, skipFailureClasses: [] });
        expect(calls[0].sql).not.toContain('agent_task_schedule_runs');
        expect(calls[0].sql).not.toContain('failure_class');
        expect(calls[0].params).toEqual(['u1', 30]);
    });
});
