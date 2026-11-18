/**
 * 미소비 결정 이어받기·무효화 — **실제 Postgres**. 승인 대기 중 슬롯을 양보한 작업이 결정 때 자리가 없으면 결정을
 * 소비 표시 없이(consumed=false) 저장하고 주차한다. 재시작·재개 뒤 같은 호출(task+tool+인자 해시)이 takeoverForCall 로
 * 1회만 이어받고, 작업이 끝나면(closeTask) voidUnconsumedForTask 가 남은 미소비 승인을 aborted 로 닫는다.
 * 모든 행은 트랜잭션 ROLLBACK 으로 사라지고, 끝에 이 파일이 만든 id 로만 한 번 더 지운다. TEST_DATABASE_URL(격리 시험 DB) 이 없으면 skip.
 */
import { randomUUID } from 'crypto';
import { Pool, type PoolClient } from 'pg';
import { AgentTaskApprovalRepository, hashApprovalArgs } from '../agent-task-approval-repository';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;

describeOrSkip('AgentTaskApprovalRepository — 미소비 결정 이어받기·무효화 (실제 Postgres)', () => {
    let pool: Pool;
    const tag = `unc-${randomUUID().slice(0, 8)}`;
    const userId = `${tag}-user`;
    const createdIds: string[] = [];
    const args = { actions: [{ type: 'goto', url: 'https://example.com' }] };
    const argsHash = hashApprovalArgs(args);

    /** 결과와 상관없이 항상 ROLLBACK — 사용자·작업 행을 만들고 저장소를 이 연결에 묶는다. */
    async function inTx(fn: (repo: AgentTaskApprovalRepository, c: PoolClient, task: (key: string) => Promise<string>) => Promise<void>): Promise<void> {
        const c = await pool.connect();
        try {
            await c.query('BEGIN');
            await c.query(`INSERT INTO users (id, username, password_hash) VALUES ($1, $1, 'x')`, [userId]);
            const task = async (key: string): Promise<string> => {
                const id = `${tag}-${key}`;
                createdIds.push(id);
                await c.query(`INSERT INTO agent_tasks (id, user_id, goal, status) VALUES ($1, $2, 'unconsumed fixture', 'paused')`, [id, userId]);
                return id;
            };
            await fn(new AgentTaskApprovalRepository(c as unknown as Pool), c, task);
        } finally {
            await c.query('ROLLBACK').catch(() => undefined);
            c.release();
        }
    }

    async function pending(repo: AgentTaskApprovalRepository, taskId: string, key: string, toolName = 'browser'): Promise<string> {
        const approvalId = `${taskId}-${key}`;
        await repo.insertPending({ approvalId, taskId, userId, toolName, args, argsHash, timeoutMs: 60_000 });
        return approvalId;
    }

    const row = async (c: PoolClient, id: string) =>
        (await c.query<{ status: string; consumed_at: Date | null; answer_text: string | null }>('SELECT status, consumed_at, answer_text FROM agent_task_approvals WHERE approval_id = $1', [id])).rows[0];

    beforeAll(() => { pool = new Pool({ connectionString: CONN, max: 2 }); });

    afterAll(async () => {
        if (createdIds.length) await pool.query('DELETE FROM agent_tasks WHERE id = ANY($1::text[])', [createdIds]);
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        await pool.end();
    });

    it('소비 표시 없이 승인된 행은 takeoverForCall 이 1회만 돌려준다(두 번째는 없음)', async () => {
        await inTx(async (repo, c, task) => {
            const t = await task('approve');
            const id = await pending(repo, t, 'a');
            await expect(repo.markDecided(id, 'approved', undefined, userId, false)).resolves.toBe(true);
            expect((await row(c, id)).consumed_at).toBeNull();
            const first = await repo.takeoverForCall(t, 'browser', argsHash);
            expect(first).toMatchObject({ approval_id: id, status: 'approved' });
            expect(first?.consumed_at).not.toBeNull();
            await expect(repo.takeoverForCall(t, 'browser', argsHash)).resolves.toBeUndefined();
        });
    });

    it('거절 + 사유도 같은 방식으로 이어받는다', async () => {
        await inTx(async (repo, _c, task) => {
            const t = await task('reject');
            const id = await pending(repo, t, 'r');
            await repo.markDecided(id, 'rejected', '하지 마', userId, false);
            await expect(repo.takeoverForCall(t, 'browser', argsHash)).resolves.toMatchObject({ approval_id: id, status: 'rejected', answer_text: '하지 마' });
            await expect(repo.takeoverForCall(t, 'browser', argsHash)).resolves.toBeUndefined();
        });
    });

    it('voidUnconsumedForTask 뒤에는 이어받지 못하고 행이 aborted — 소비된 행·다른 작업·pending 은 그대로', async () => {
        await inTx(async (repo, c, task) => {
            const t = await task('void');
            const other = await task('void-other');
            const unconsumed = await pending(repo, t, 'u');
            await repo.markDecided(unconsumed, 'approved', undefined, userId, false);
            const consumed = await pending(repo, t, 'c', 'bash');
            await repo.markDecided(consumed, 'approved', undefined, userId, true);
            const stillPending = await pending(repo, t, 'p', 'file_ops');
            const otherTask = await pending(repo, other, 'o');
            await repo.markDecided(otherTask, 'approved', undefined, userId, false);

            await repo.voidUnconsumedForTask(t);

            expect((await row(c, unconsumed)).status).toBe('aborted');
            await expect(repo.takeoverForCall(t, 'browser', argsHash)).resolves.toBeUndefined();
            expect(await row(c, consumed)).toMatchObject({ status: 'approved', consumed_at: expect.any(Date) });
            expect((await row(c, stillPending)).status).toBe('pending');
            expect(await row(c, otherTask)).toMatchObject({ status: 'approved', consumed_at: null });
        });
    });

    it('미소비 승인은 revokeUnconsumed 로 철회되고, 철회 뒤에는 이어받지 못한다', async () => {
        await inTx(async (repo, c, task) => {
            const t = await task('revoke');
            const id = await pending(repo, t, 'v');
            await repo.markDecided(id, 'approved', undefined, userId, false);
            await expect(repo.revokeUnconsumed(id, userId)).resolves.toBe('revoked');
            expect((await row(c, id)).status).toBe('revoked');
            await expect(repo.takeoverForCall(t, 'browser', argsHash)).resolves.toBeUndefined();
        });
    });
});
