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

describe('AgentTaskHistoryRepository — 과거 작업 검색(사용자 범위)', () => {
    it('검색은 user_id 로 범위를 제한하고 낱말마다 목표·결과에서 찾는다', async () => {
        const { pool, calls } = fakePool();
        await new AgentTaskHistoryRepository(pool).searchTasks('u1', ['매출', '50%'], { limit: 5, excludeTaskId: 't-now' });
        expect(calls[0].sql).toContain('t.user_id = $1');
        expect(calls[0].sql).toContain('t.id <> $2');
        expect(calls[0].sql.match(/ILIKE/g)).toHaveLength(4);
        expect(calls[0].params).toEqual(['u1', 't-now', '%매출%', '%50\\%%', 5]);
    });

    it('최근 목록도 user_id 로 범위를 제한한다', async () => {
        const { pool, calls } = fakePool();
        await new AgentTaskHistoryRepository(pool).searchTasks('u1', [], { limit: 5 });
        expect(calls[0].sql).toContain('t.user_id = $1');
        expect(calls[0].sql).not.toContain('ILIKE');
        expect(calls[0].params).toEqual(['u1', 5]);
    });

    it('한 건 보기는 작업 id 와 user_id 를 함께 건다 — 다른 사용자의 작업이면 null 이고 도구 기록도 읽지 않는다', async () => {
        const { pool, calls } = fakePool([{ rows: [] }]);
        await expect(new AgentTaskHistoryRepository(pool).getTaskSummary('u2', 't-of-u1', 2000)).resolves.toBeNull();
        expect(calls).toHaveLength(1);
        expect(calls[0].sql).toContain('t.id = $1 AND t.user_id = $2');
        expect(calls[0].params).toEqual(['t-of-u1', 'u2', 2000]);
    });

    it('한 건 보기는 본인 작업이면 요약과 쓴 도구를 돌려준다', async () => {
        const row = { id: 't1', goal: 'g', status: 'completed', error: null, result: 'r', current_turn: 3, created_at: 'c', completed_at: 'd' };
        const { pool, calls } = fakePool([{ rows: [row] }, { rows: [{ tool_name: 'bash' }] }]);
        await expect(new AgentTaskHistoryRepository(pool).getTaskSummary('u1', 't1', 2000)).resolves.toEqual({ ...row, tools: ['bash'] });
        expect(calls[1].params).toEqual(['t1']);
    });
});
