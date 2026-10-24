/**
 * 오래된 pending 집계(#1478) — **실제 Postgres**. 소유권 없거나(NULL) 지난 소유권의 pending 중 최근 활동
 * (last_progress_at·updated_at 중 늦은 쪽)이 staleMs 보다 오래된 것만 센다. 살아 있는 소유권(lease_until >= NOW())·
 * 최근 활동·주차·살아 있는 승인 대기·다른 상태는 빠진다. 건수·최대 나이는 전체 행 기준, 표본은 오래된 순(같은 시각이면 id 순).
 *
 * 시각 경계는 한 트랜잭션 안에서 본다 — Postgres 의 NOW() 는 트랜잭션 시작 시각으로 고정이라 fixture 와 조회가 같은 NOW() 를 쓴다.
 * REPEATABLE READ 라 다른 세션의 행이 도중에 끼지 않아 기준선과의 차이가 정확하다. 모든 행은 ROLLBACK 으로 사라지고,
 * 끝에 이 파일이 만든 id 로만 한 번 더 지운다. TEST_DATABASE_URL(격리 시험 DB) 이 없으면 skip.
 */
import { randomUUID } from 'crypto';
import { Pool, type PoolClient } from 'pg';
import { AgentTaskProgressRepository } from '../agent-task-progress-repository';
import { AGENT_TASK_MODEL_WAIT_REASON, AGENT_TASK_PARKED_REASON } from '../../../config/agent-task-park-reasons';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;

const MIN = 60_000;
const STALE_MS = 30 * MIN;
/** 시험 DB 의 어떤 행보다도 오래된 활동(약 31년 전 — 1970 이후라 활동식의 to_timestamp(0) 하한에 걸리지 않는다, 정수 초라 나이가 ms 까지 정확하다) */
const ANCIENT_MS = 1_000_000_000_000;
const HOUR = 60 * MIN;

describeOrSkip('AgentTaskProgressRepository.summarizeStalePendingTasks (실제 Postgres, #1478)', () => {
    let pool: Pool;
    const tag = `wdp-${randomUUID().slice(0, 8)}`;
    const userId = `${tag}-user`;
    const createdIds: string[] = [];

    /** 고정 NOW() 의 트랜잭션 — 결과와 상관없이 항상 ROLLBACK */
    async function inTx(fn: (c: PoolClient) => Promise<void>): Promise<void> {
        const c = await pool.connect();
        try {
            await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
            await c.query(`INSERT INTO users (id, username, password_hash) VALUES ($1, $1, 'x')`, [userId]);
            await fn(c);
        } finally {
            await c.query('ROLLBACK').catch(() => undefined);
            c.release();
        }
    }

    /** 나이(ms)는 모두 고정 NOW() 기준 — leaseAgoMs: null 은 소유권 없음, 0 은 lease_until = NOW(), 음수는 미래 */
    async function put(c: PoolClient, key: string, o: { status?: string; updatedAgoMs: number; progressAgoMs?: number | null; leaseAgoMs?: number | null }): Promise<string> {
        const id = `${tag}-${key}`;
        createdIds.push(id);
        await c.query(
            `INSERT INTO agent_tasks (id, user_id, goal, status, updated_at, last_progress_at, lease_owner, lease_until)
             VALUES ($1, $2, 'stale pending fixture', $3,
                     NOW() - make_interval(secs => $4::float8 / 1000.0),
                     CASE WHEN $5::float8 IS NULL THEN NULL ELSE NOW() - make_interval(secs => $5::float8 / 1000.0) END,
                     CASE WHEN $6::float8 IS NULL THEN NULL ELSE 'other-host:1' END,
                     CASE WHEN $6::float8 IS NULL THEN NULL ELSE NOW() - make_interval(secs => $6::float8 / 1000.0) END)`,
            [id, userId, o.status ?? 'pending', o.updatedAgoMs, o.progressAgoMs ?? null, o.leaseAgoMs ?? null]);
        return id;
    }

    async function approval(c: PoolClient, taskId: string, status: string, expiresAgoMs: number): Promise<void> {
        await c.query(
            `INSERT INTO agent_task_approvals (approval_id, task_id, user_id, tool_name, args_hash, status, expires_at)
             VALUES ($1, $2, $3, 'shell', 'h', $4, NOW() - make_interval(secs => $5::float8 / 1000.0))`,
            [`${taskId}-ap`, taskId, userId, status, expiresAgoMs]);
    }

    /** 읽기 전후 비교용 — 행 내용·물리 위치(ctid, UPDATE 면 바뀐다)·xmax(FOR UPDATE 잠금이면 바뀐다)와 이 트랜잭션의 쓰기 통계 */
    async function snapshot(c: PoolClient, ids: string[]): Promise<unknown> {
        const tasks = await c.query(`SELECT t.ctid::text AS ctid, t.xmax::text AS xmax, row_to_json(t)::text AS j FROM agent_tasks t WHERE t.id = ANY($1::text[]) ORDER BY t.id`, [ids]);
        const approvals = await c.query(`SELECT a.ctid::text AS ctid, a.xmax::text AS xmax, row_to_json(a)::text AS j FROM agent_task_approvals a WHERE a.task_id = ANY($1::text[]) ORDER BY a.approval_id`, [ids]);
        const events = await c.query(`SELECT e.ctid::text AS ctid, e.xmax::text AS xmax, row_to_json(e)::text AS j FROM agent_task_events e WHERE e.task_id = ANY($1::text[]) ORDER BY e.id`, [ids]);
        const writes = await c.query(
            `SELECT relname, n_tup_ins, n_tup_upd, n_tup_del, n_tup_hot_upd FROM pg_stat_xact_user_tables
              WHERE relname IN ('agent_tasks', 'agent_task_approvals', 'agent_task_events') ORDER BY relname`);
        return { tasks: tasks.rows, approvals: approvals.rows, events: events.rows, writes: writes.rows };
    }

    beforeAll(() => { pool = new Pool({ connectionString: CONN, max: 2 }); });

    afterAll(async () => {
        // ROLLBACK 으로 이미 없지만, 이 파일이 만든 id 로만 한 번 더 지운다
        if (createdIds.length) await pool.query('DELETE FROM agent_tasks WHERE id = ANY($1::text[])', [createdIds]);
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        await pool.end();
    });

    it('오래된 NULL·지난 소유권 pending 만 정확히 센다(50건 초과) — 표본 5개는 오래된 순·같은 시각이면 id 순, 최대 나이는 전체 기준, 작업 행은 읽기 전후 그대로', async () => {
        await inTx(async (c) => {
            const repo = new AgentTaskProgressRepository(c as unknown as Pool);
            const before = await repo.summarizeStalePendingTasks(STALE_MS, 5);

            // ── 포함: 가장 오래된 다섯(표본) — tie-b 를 먼저 넣어도 같은 시각이면 id 순(tie-a 먼저)
            const tieB = await put(c, 'in-tie-b', { updatedAgoMs: ANCIENT_MS });
            const tieA = await put(c, 'in-tie-a', { updatedAgoMs: ANCIENT_MS });
            const old3 = await put(c, 'in-old3-expired-1d', { updatedAgoMs: ANCIENT_MS - 1000, leaseAgoMs: 24 * HOUR });
            const old4 = await put(c, 'in-old4-expired-1ms', { updatedAgoMs: ANCIENT_MS - 2000, leaseAgoMs: 1 });
            // 최근 활동 = 늦은 쪽(last_progress_at) — updated_at 만 보면 가장 오래된 것으로 잘못 앞선다
            const old5 = await put(c, 'in-old5-progress', { updatedAgoMs: ANCIENT_MS + 5000, progressAgoMs: ANCIENT_MS - 3000 });
            const included = [tieB, tieA, old3, old4, old5];
            included.push(await put(c, 'in-old6', { updatedAgoMs: ANCIENT_MS - 4000 }));
            // 경계 — 기준보다 1ms 더 오래됐으면 포함
            included.push(await put(c, 'in-boundary-1ms', { updatedAgoMs: STALE_MS + 1 }));
            // 살아 있지 않은 승인 — 만료 시각이 NOW()(> NOW() 아님), 이미 결정된 승인
            const expiredAp = await put(c, 'in-approval-expired', { updatedAgoMs: STALE_MS + 10 * MIN });
            await approval(c, expiredAp, 'pending', 0);
            const decidedAp = await put(c, 'in-approval-decided', { updatedAgoMs: STALE_MS + 11 * MIN });
            await approval(c, decidedAp, 'approved', -HOUR);
            included.push(expiredAp, decidedAp);
            // 대량 — 50건(짝수 NULL, 홀수 1시간 전 지난 소유권)
            for (let k = 0; k < 50; k++) {
                included.push(await put(c, `in-bulk-${String(k).padStart(2, '0')}`, { updatedAgoMs: STALE_MS + (20 + k) * MIN, leaseAgoMs: k % 2 === 0 ? null : HOUR }));
            }

            // ── 제외 — 대부분 가장 오래된 나이라, 잘못 들어오면 건수·표본·최대 나이가 모두 틀어진다
            const excluded = [
                await put(c, 'out-fresh', { updatedAgoMs: STALE_MS - MIN }),
                await put(c, 'out-boundary-exact', { updatedAgoMs: STALE_MS }), // 기존 `<` 경계 — 정확히 기준이면 아직 아니다
                await put(c, 'out-recent-progress', { updatedAgoMs: ANCIENT_MS, progressAgoMs: MIN }),
                await put(c, 'out-recent-update', { updatedAgoMs: MIN, progressAgoMs: ANCIENT_MS }),
                await put(c, 'out-lease-now', { updatedAgoMs: ANCIENT_MS, leaseAgoMs: 0 }), // lease_until = NOW() 는 살아 있다
                await put(c, 'out-lease-future', { updatedAgoMs: ANCIENT_MS, leaseAgoMs: -HOUR }),
            ];
            const liveAp = await put(c, 'out-approval-live', { updatedAgoMs: ANCIENT_MS });
            await approval(c, liveAp, 'pending', -HOUR);
            excluded.push(liveAp);
            // 실제 주차(paused + 마지막 이벤트가 주차 사유) — parkedTaskCondition 그대로
            for (const reason of [AGENT_TASK_MODEL_WAIT_REASON, AGENT_TASK_PARKED_REASON]) {
                const parked = await put(c, `out-parked-${reason}`, { status: 'paused', updatedAgoMs: ANCIENT_MS });
                await c.query(`INSERT INTO agent_task_events (task_id, from_status, to_status, reason) VALUES ($1, 'paused', 'paused', $2)`, [parked, reason]);
                excluded.push(parked);
            }
            for (const status of ['queued', 'running', 'paused', 'completed', 'failed', 'cancelled']) {
                excluded.push(await put(c, `out-status-${status}`, { status, updatedAgoMs: ANCIENT_MS }));
                excluded.push(await put(c, `out-status-${status}-expired`, { status, updatedAgoMs: ANCIENT_MS, leaseAgoMs: HOUR }));
            }

            const ids = [...included, ...excluded];
            const pre = await snapshot(c, ids);
            const s = await repo.summarizeStalePendingTasks(STALE_MS, 5);
            expect(await snapshot(c, ids)).toEqual(pre);

            expect(included).toHaveLength(59);
            expect(s.count - before.count).toBe(59);
            expect(s.taskIds).toEqual([tieA, tieB, old3, old4, old5]);
            expect(typeof s.oldestStalledMs).toBe('number');
            expect(s.oldestStalledMs).toBe(ANCIENT_MS);
            for (const id of excluded) expect(s.taskIds).not.toContain(id);
        });
    });

    it('표본 수는 sampleLimit 를 따르고 건수는 표본과 무관하게 전체다', async () => {
        await inTx(async (c) => {
            const repo = new AgentTaskProgressRepository(c as unknown as Pool);
            const before = await repo.summarizeStalePendingTasks(STALE_MS, 2);
            const a = await put(c, 'lim-a', { updatedAgoMs: ANCIENT_MS });
            const b = await put(c, 'lim-b', { updatedAgoMs: ANCIENT_MS - 1000, leaseAgoMs: HOUR });
            await put(c, 'lim-c', { updatedAgoMs: ANCIENT_MS - 2000 });
            const s = await repo.summarizeStalePendingTasks(STALE_MS, 2);
            expect(s.taskIds).toEqual([a, b]);
            expect(s.count - before.count).toBe(3);
        });
    });

    it('대상이 없으면 0건·최대 나이 0·빈 표본', async () => {
        await inTx(async (c) => {
            const repo = new AgentTaskProgressRepository(c as unknown as Pool);
            await put(c, 'none-fresh', { updatedAgoMs: MIN });
            await put(c, 'none-live', { updatedAgoMs: ANCIENT_MS, leaseAgoMs: -HOUR });
            // 어떤 행보다 긴 기준 — 이 스냅샷에서 해당 행이 없다
            await expect(repo.summarizeStalePendingTasks(ANCIENT_MS * 2, 5)).resolves.toEqual({ count: 0, oldestStalledMs: 0, taskIds: [] });
        });
    });
});
