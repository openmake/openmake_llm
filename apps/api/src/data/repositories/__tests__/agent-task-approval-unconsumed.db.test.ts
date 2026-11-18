/**
 * 미소비 결정 이어받기·무효화 — **실제 Postgres**. 승인 대기 중 슬롯을 양보한 작업이 결정 때 자리가 없으면 결정을
 * 소비 표시 없이(consumed=false) 저장하고 주차한다. 재시작·재개 뒤 같은 호출(task+tool+인자 해시)이 takeoverForCall 로
 * 1회만 이어받고, 작업이 끝나면(closeTask) voidUnconsumedForTask 가 남은 미소비 승인을 aborted 로 닫는다.
 * 모든 행은 트랜잭션 ROLLBACK 으로 사라지고, 끝에 이 파일이 만든 id 로만 한 번 더 지운다. TEST_DATABASE_URL(격리 시험 DB) 이 없으면 skip.
 */
import { randomUUID } from 'crypto';
import { Pool, type PoolClient } from 'pg';
import { AgentTaskApprovalRepository, hashApprovalArgs } from '../agent-task-approval-repository';
import { AgentTaskRepository } from '../agent-task-repository';
import { ApprovalRegistry } from '../../../services/task-sandbox/approval-gate';

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

    /** 결정 시각을 고정 — 한 트랜잭션 안에서는 NOW() 가 같아 앞뒤를 직접 정한다. */
    const decidedAt = (c: PoolClient, id: string, offsetSec: number) =>
        c.query(`UPDATE agent_task_approvals SET decided_at = NOW() + make_interval(secs => $2) WHERE approval_id = $1`, [id, offsetSec]);
    const transition = (c: PoolClient, taskId: string, to: string, reason: string | null, offsetSec = 0) =>
        c.query(`INSERT INTO agent_task_events (task_id, from_status, to_status, reason, created_at) VALUES ($1, 'running', $2, $3, NOW() + make_interval(secs => $4))`,
            [taskId, to, reason, offsetSec]);

    it('마지막 취소보다 앞서 결정된 미소비 결정은 이어받지 않는다 — 취소 뒤 결정은 이어받는다', async () => {
        await inTx(async (repo, c, task) => {
            const t = await task('cut-cancel');
            const before = await pending(repo, t, 'b');
            await repo.markDecided(before, 'approved', undefined, userId, false);
            await decidedAt(c, before, -10);
            const rejectedBefore = await pending(repo, t, 'rb', 'bash');
            await repo.markDecided(rejectedBefore, 'rejected', '하지 마', userId, false);
            await decidedAt(c, rejectedBefore, -10);
            await transition(c, t, 'cancelled', 'aborted', -5);
            await expect(repo.takeoverForCall(t, 'browser', argsHash)).resolves.toBeUndefined();
            await expect(repo.takeoverForCall(t, 'bash', argsHash)).resolves.toBeUndefined();
            // 재실행 자신이 주차로 넘긴 결정(취소 뒤)은 그대로 이어받는다
            const after = await pending(repo, t, 'a');
            await repo.markDecided(after, 'approved', undefined, userId, false);
            await decidedAt(c, after, -1);
            await expect(repo.takeoverForCall(t, 'browser', argsHash)).resolves.toMatchObject({ approval_id: after, status: 'approved' });
        });
    });

    it('사용자 실패(failed)도 경계다 — 서버 재시작으로 끊긴 실패(server restarted)는 경계가 아니라 재시작 전 결정을 이어받는다', async () => {
        await inTx(async (repo, c, task) => {
            const restarted = await task('cut-restart');
            const kept = await pending(repo, restarted, 'k');
            await repo.markDecided(kept, 'approved', undefined, userId, false);
            await decidedAt(c, kept, -10);
            await transition(c, restarted, 'failed', 'server restarted', -5);
            await expect(repo.takeoverForCall(restarted, 'browser', argsHash)).resolves.toMatchObject({ approval_id: kept });

            const failed = await task('cut-failed');
            const dropped = await pending(repo, failed, 'd');
            await repo.markDecided(dropped, 'approved', undefined, userId, false);
            await decidedAt(c, dropped, -10);
            await transition(c, failed, 'failed', 'boom', -5);
            await expect(repo.takeoverForCall(failed, 'browser', argsHash)).resolves.toBeUndefined();
        });
    });

    it('취소 때 무효화가 실패하고 프로세스가 재시작돼도(새 레지스트리) 재실행은 취소 전 미소비 승인을 쓰지 않고 다시 묻는다', async () => {
        await inTx(async (repo, c, task) => {
            const t = await task('restart-void-fail');
            // 자리가 없어 주차로 넘긴 미소비 승인(취소 전 결정)
            const prior = await pending(repo, t, 'prior');
            await repo.markDecided(prior, 'approved', undefined, userId, false);
            await decidedAt(c, prior, -10);
            // 취소: 무효화가 실패하는 저장소로 closeTask → 취소 상태 저장(전이 이벤트는 상태 저장과 함께 남는다)
            const failingVoid = Object.assign(Object.create(repo) as AgentTaskApprovalRepository, {
                voidUnconsumedForTask: async () => { throw new Error('db down'); },
            });
            await new ApprovalRegistry(failingVoid).closeTask(t);
            expect((await row(c, prior)).status).toBe('approved');   // 무효화 실패로 미소비 승인이 남았다
            await new AgentTaskRepository(c as unknown as Pool).updateAgentTask(t, { status: 'cancelled', error: 'aborted' });
            // 재시작 — 메모리 상태 없는 새 레지스트리. DB 는 회복됐다. 재실행이 같은 호출을 다시 요청한다
            const restarted = new ApprovalRegistry(repo);
            const ac = new AbortController();
            let cardId = '';
            const result = restarted.request(
                { taskId: t, userId, toolName: 'browser', args },
                { timeoutMs: 60_000, signal: ac.signal, onPending: (p) => { cardId = p.approvalId; ac.abort(); } },
            );
            await expect(result).resolves.toMatchObject({ decision: 'rejected', reason: 'abort' });   // 옛 승인으로 approved 가 아니다
            expect(cardId).not.toBe('');
            expect(cardId).not.toBe(prior);
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
