/**
 * worktree 격리 상태(200) — **실제 Postgres**. JSONB 쓰기·읽기 왕복, 넘기지 않으면 기존 값 유지, null 은 SQL NULL.
 * TEST_DATABASE_URL(격리 시험 DB) 이 없으면 skip. 만든 사용자·작업은 이 파일이 만든 id 로만 지운다.
 */
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { AgentTaskRepository } from '../agent-task-repository';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;

describeOrSkip('AgentTaskRepository — isolation 열 (실제 Postgres, 200)', () => {
    let pool: Pool;
    const tag = `iso-${randomUUID().slice(0, 8)}`;
    const userId = `${tag}-user`;
    const taskId = `${tag}-task`;

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN, max: 2 });
        await pool.query(`INSERT INTO users (id, username, password_hash) VALUES ($1, $1, 'x')`, [userId]);
        await pool.query(`INSERT INTO agent_tasks (id, user_id, goal, status) VALUES ($1, $2, 'isolation fixture', 'running')`, [taskId, userId]);
    });

    afterAll(async () => {
        await pool.query('DELETE FROM agent_tasks WHERE id = $1', [taskId]);
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        await pool.end();
    });

    it('쓰기·읽기 왕복(JSONB), 다른 갱신은 값을 유지하고, null 은 SQL NULL 로 비운다', async () => {
        const repo = new AgentTaskRepository(pool);
        const isolation = { state: 'worktree' as const, branch: `omk-task/${tag}`, worktreeRel: `.openmake/worktrees/${taskId}`, outcome: 'kept' as const };
        await repo.updateAgentTask(taskId, { isolation });
        expect((await repo.getAgentTask(taskId))?.isolation).toEqual(isolation);

        await repo.updateAgentTask(taskId, { progress: 50 });
        expect((await repo.getAgentTask(taskId))?.isolation).toEqual(isolation);

        await repo.updateAgentTask(taskId, { isolation: null });
        const r = await pool.query('SELECT isolation IS NULL AS is_null FROM agent_tasks WHERE id = $1', [taskId]);
        expect(r.rows[0].is_null).toBe(true);
    });

    it('연결 폴더 기준 작업 폴더 경로(rootRel)도 그대로 왕복한다', async () => {
        const repo = new AgentTaskRepository(pool);
        const isolation = { state: 'worktree' as const, branch: `omk-task/${tag}`, worktreeRel: `.openmake/worktrees/${taskId}/sub`, rootRel: `ws-git/sub/.openmake/worktrees/${taskId}/sub`, outcome: 'kept' as const };
        await repo.updateAgentTask(taskId, { isolation });
        expect((await repo.getAgentTask(taskId))?.isolation).toEqual(isolation);
    });
});
