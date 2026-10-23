/**
 * watchdog 집계(#1478) — **실제 Postgres**. 모델 대기 통계는 임의 200건 목록이 아니라 조건에 맞는 전체 행의 DB 집계이고,
 * 표본은 가장 오래 기다린 순(같은 시각이면 id 순)으로 안정적이다. 상태별 건수는 사라진 상태도 0 으로 돌려준다.
 * TEST_DATABASE_URL(격리 시험 DB) 이 없으면 skip. 만든 사용자·작업은 이 파일이 만든 id 로만 지운다.
 */
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { AgentTaskProgressRepository } from '../agent-task-progress-repository';
import { AgentTaskRepository } from '../agent-task-repository';
import { AGENT_TASK_MODEL_WAIT_REASON, AGENT_TASK_PARKED_REASON } from '../../../config/agent-task-park-reasons';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;

const MIN = 60_000;
const LONG_MS = 30 * MIN;

describeOrSkip('AgentTaskProgressRepository — watchdog 집계 (실제 Postgres, #1478)', () => {
    let pool: Pool;
    const tag = `wd-${randomUUID().slice(0, 8)}`;
    const userId = `${tag}-user`;
    const taskIds: string[] = [];

    /** 작업 n 개를 만들고 각각 마지막 전이 이벤트 하나를 단다. 이벤트 시각은 2000-01-01 + oldMinute(g) 분(기본 g), recent 의 g 는 1분 전. */
    async function seed(prefix: string, n: number, status: string, reason: string, opts: { oldMinute?: (g: string) => string; recent?: number[]; updatedAt?: string } = {}): Promise<string[]> {
        const ids = Array.from({ length: n }, (_, g) => `${tag}-${prefix}-${String(g).padStart(3, '0')}`);
        taskIds.push(...ids);
        await pool.query(
            `INSERT INTO agent_tasks (id, user_id, goal, status, updated_at)
             SELECT x, $2, 'watchdog fixture', $3, COALESCE($4::timestamptz, NOW()) FROM unnest($1::text[]) x`,
            [ids, userId, status, opts.updatedAt ?? null]);
        const recent = new Set(opts.recent ?? []);
        await pool.query(
            `INSERT INTO agent_task_events (task_id, from_status, to_status, reason, created_at)
             SELECT x, 'paused', $2, $3,
                    CASE WHEN o - 1 = ANY($4::int[]) THEN NOW() - interval '1 minute'
                         ELSE '2000-01-01T00:00:00Z'::timestamptz + make_interval(mins => (${opts.oldMinute?.('(o - 1)') ?? '(o - 1)'})::int) END
               FROM unnest($1::text[]) WITH ORDINALITY AS u(x, o)`,
            [ids, status, reason, [...recent]]);
        return ids;
    }

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN, max: 2 });
        await pool.query(`INSERT INTO users (id, username, password_hash) VALUES ($1, $1, 'x')`, [userId]);
    });

    afterAll(async () => {
        if (taskIds.length) await pool.query('DELETE FROM agent_tasks WHERE id = ANY($1::text[])', [taskIds]);
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        await pool.end();
    });

    it('모델 대기는 200건을 넘어도 전체를 세고(장기 건수 포함), 표본 5개는 가장 오래 기다린 순·같은 시각이면 id 순', async () => {
        const before = await new AgentTaskProgressRepository(pool).summarizeParkedByReason(AGENT_TASK_MODEL_WAIT_REASON, LONG_MS, 5);
        // 205건 — g=0,1 은 같은 시각(2000-01-01 00:00), 그 뒤 1분씩. 202~204 는 1분 전(장기 아님)
        const model = await seed('mw', 205, 'paused', AGENT_TASK_MODEL_WAIT_REASON, { oldMinute: (g) => `GREATEST(${g} - 1, 0)`, recent: [202, 203, 204] });
        // 대상 아님: 질문 대기 주차(그중 updated_at 이 오래돼 기존 200건 목록 앞자리를 차지), 모델 대기 뒤 재개된 작업, 실행 중인 작업
        await seed('hitl', 10, 'paused', AGENT_TASK_PARKED_REASON, { updatedAt: '1999-01-01T00:00:00Z' });
        const resumed = await seed('resumed', 2, 'paused', AGENT_TASK_MODEL_WAIT_REASON);
        await pool.query(`INSERT INTO agent_task_events (task_id, from_status, to_status, reason) SELECT x, 'paused', 'pending', 'hitl_park_resume' FROM unnest($1::text[]) x`, [resumed]);
        await pool.query(`UPDATE agent_tasks SET status = 'pending' WHERE id = ANY($1::text[])`, [resumed]);
        await seed('running', 2, 'running', AGENT_TASK_MODEL_WAIT_REASON);

        const s = await new AgentTaskProgressRepository(pool).summarizeParkedByReason(AGENT_TASK_MODEL_WAIT_REASON, LONG_MS, 5);
        expect(s.count - before.count).toBe(205);
        expect(s.longCount - before.longCount).toBe(202);
        expect(s.oldest.map((r) => r.id)).toEqual(model.slice(0, 5));
        for (const r of s.oldest) {
            expect(typeof r.waited_ms).toBe('number');
            expect(r.waited_ms).toBeGreaterThanOrEqual(LONG_MS);
        }
        expect(s.oldest[0].waited_ms).toBeGreaterThanOrEqual(s.oldest[4].waited_ms);

        // 기존 목록(200건 상한) 은 질문 대기 주차가 앞자리를 차지해 모델 대기를 덜 센다 — 집계가 필요한 이유
        const listed = (await new AgentTaskRepository(pool).listParkedTasks(200)).filter((t) => t.reason === AGENT_TASK_MODEL_WAIT_REASON);
        expect(listed.length).toBeLessThan(205);
    });

    it('해당 사유 주차가 없으면 0건·빈 표본', async () => {
        const s = await new AgentTaskProgressRepository(pool).summarizeParkedByReason(`${tag}-no-such-reason`, LONG_MS, 5);
        expect(s).toEqual({ count: 0, longCount: 0, oldest: [] });
    });

    it('상태별 건수 — 있던 상태가 사라져도 그 상태를 0(기준선)으로 돌려준다', async () => {
        const repo = new AgentTaskRepository(pool);
        const base = await repo.countActiveAgentTasksByStatus();
        const [q] = await seed('queued', 1, 'queued', 'fixture');
        expect((await repo.countActiveAgentTasksByStatus()).queued).toBe(base.queued + 1);
        await pool.query(`UPDATE agent_tasks SET status = 'completed' WHERE id = $1`, [q]);
        const after = await repo.countActiveAgentTasksByStatus();
        expect(Object.keys(after).sort()).toEqual(['paused', 'pending', 'queued', 'running']);
        expect(after.queued).toBe(base.queued);
    });
});
