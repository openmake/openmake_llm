/**
 * 이어받기 경계(Fable r4 P2) — 주차 스윕의 has_decision 이 takeoverForCall 과 같은 경계를 쓰고, closeTask 무효화가 미소비 거절도 닫는다.
 * SQL 실행 검증은 agent-task-approval-unconsumed.db.test.ts(실제 Postgres).
 */
import type { Pool } from 'pg';
import { AgentTaskRepository } from '../agent-task-repository';
import { AgentTaskApprovalRepository } from '../agent-task-approval-repository';
import { decidedAfterTakeoverBoundarySql } from '../agent-task-event-sql';

function fakePool() {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = { query: jest.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: [], rowCount: 0 }; }) };
    return { pool: pool as unknown as Pool, calls };
}
const squash = (s: string) => s.replace(/\s+/g, ' ');

describe('이어받기 경계 SQL', () => {
    it('listParkedTasks 의 has_decision 은 경계 뒤 결정만 센다', async () => {
        const { pool, calls } = fakePool();
        await new AgentTaskRepository(pool).listParkedTasks();
        const hasDecision = squash(calls[0].sql).match(/EXISTS \(SELECT 1 FROM agent_task_approvals a WHERE[^]*?\) AS has_decision/)?.[0] ?? '';
        expect(hasDecision).toContain(squash(decidedAfterTakeoverBoundarySql('a', 't.id')));
    });

    it('takeoverForCall 도 같은 경계 조각을 쓴다', async () => {
        const { pool, calls } = fakePool();
        await new AgentTaskApprovalRepository(pool).takeoverForCall('t1', 'browser', 'h');
        expect(squash(calls[0].sql)).toContain(squash(decidedAfterTakeoverBoundarySql('agent_task_approvals', '$1')));
    });

    it('경계는 취소 전체와 재시작 중단이 아닌 실패다', () => {
        const sql = squash(decidedAfterTakeoverBoundarySql('a', 't.id'));
        expect(sql).toContain("e.to_status = 'cancelled'");
        expect(sql).toContain("e.to_status = 'failed' AND e.reason IS DISTINCT FROM 'server restarted'");
        expect(sql).toContain('a.decided_at >');
    });

    it('voidUnconsumedForTask 는 미소비 승인을 aborted 로, 미소비 거절은 상태를 두고 소비 표시한다', async () => {
        const { pool, calls } = fakePool();
        await new AgentTaskApprovalRepository(pool).voidUnconsumedForTask('t1');
        const sql = squash(calls.map((c) => c.sql).join(' ; '));
        expect(sql).toMatch(/status IN \('approved', 'rejected'\)/);
        expect(sql).toMatch(/consumed_at = NOW\(\)|consumed_at = CASE/);
        expect(sql).toContain("'aborted'");
    });
});
