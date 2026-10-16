// apps/api/src/addons/knowledge-runtime/__tests__/knowledge-migration-004.db.test.ts
/**
 * 004 마이그레이션 실 DB 검증 — TEST_DATABASE_URL 없으면 skip. 운영·로컬 본 DB 에 붙지 않는다.
 *  ① 두 번 적용해도 오류 없음(멱등) ② 모드 행은 정확히 1개(id=1), 두 번째 행은 CHECK 로 거절
 *  ③ state 'cancelled' 는 들어가고 모르는 상태는 23514 ④ actor_kind 는 user|org|system|NULL 만
 *  ⑤ heartbeat upsert ⑥ 004 이전에 넣은 행(새 열 NULL)도 그대로 읽힌다
 * 만든 행은 id 로만 지운다.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { applyKnowledgeSchema, KNOWLEDGE_DB_LOCK_HOOK_TIMEOUT_MS, lockKnowledgeQueueTests, resetWorkerMode } from './helpers/db-serial';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;
const MIGRATION_004 = resolve(__dirname, '../../../../addons/builtin/knowledge-runtime/migrations/004_jobs_actor_cancel_mode.sql');

describeOrSkip('knowledge 마이그레이션 004 (실 DB)', () => {
    const pool = new Pool({ connectionString: CONN, max: 3 });
    const jobIds: string[] = [];
    const workerIds: string[] = [];
    let unlock: () => Promise<void>;

    beforeAll(async () => {
        unlock = await lockKnowledgeQueueTests(pool);
        await applyKnowledgeSchema(pool);
    }, KNOWLEDGE_DB_LOCK_HOOK_TIMEOUT_MS);
    afterAll(async () => {
        if (jobIds.length) await pool.query('DELETE FROM knowledge_ingestion_jobs WHERE id = ANY($1::text[])', [jobIds]);
        if (workerIds.length) await pool.query('DELETE FROM knowledge_worker_heartbeats WHERE worker_id = ANY($1::text[])', [workerIds]);
        await resetWorkerMode(pool);
        await unlock();
        await pool.end();
    });

    it('두 번 더 적용해도 오류가 없다(멱등)', async () => {
        const sql = readFileSync(MIGRATION_004, 'utf8');
        await expect(pool.query(sql)).resolves.toBeDefined();
        await expect(pool.query(sql)).resolves.toBeDefined();
    });

    it('모드 행은 id=1 하나뿐이고 두 번째 행은 CHECK 로 거절된다', async () => {
        const r = await pool.query<{ id: number; mode: string; generation: number }>('SELECT id, mode, generation FROM knowledge_worker_mode');
        expect(r.rows).toHaveLength(1);
        expect(r.rows[0].id).toBe(1);
        expect(['inprocess', 'external']).toContain(r.rows[0].mode);
        expect(r.rows[0].generation).toBeGreaterThanOrEqual(1);
        await expect(pool.query(`INSERT INTO knowledge_worker_mode (id) VALUES (2)`)).rejects.toMatchObject({ code: '23514' });
        await expect(pool.query(`UPDATE knowledge_worker_mode SET mode = 'both' WHERE id = 1`)).rejects.toMatchObject({ code: '23514' });
    });

    it("state 'cancelled' 는 들어가고 모르는 상태는 23514 로 거절된다", async () => {
        const ok = randomUUID();
        jobIds.push(ok);
        await pool.query(`INSERT INTO knowledge_ingestion_jobs (id, kind, state) VALUES ($1, 'cleanup', 'cancelled')`, [ok]);
        const bad = randomUUID();
        await expect(pool.query(`INSERT INTO knowledge_ingestion_jobs (id, kind, state) VALUES ($1, 'cleanup', 'paused')`, [bad]))
            .rejects.toMatchObject({ code: '23514' });
    });

    it('actor_kind 는 user|org|system|NULL 만 받는다', async () => {
        const id = randomUUID();
        jobIds.push(id);
        await pool.query(
            `INSERT INTO knowledge_ingestion_jobs (id, kind, actor_kind, actor_user_id, org_id, policy_revision) VALUES ($1, 'rechunk', 'org', 'u-1', 'o-1', 3)`,
            [id],
        );
        const r = await pool.query('SELECT actor_kind, actor_user_id, org_id, policy_revision, cancel_requested_at FROM knowledge_ingestion_jobs WHERE id = $1', [id]);
        expect(r.rows[0]).toEqual({ actor_kind: 'org', actor_user_id: 'u-1', org_id: 'o-1', policy_revision: 3, cancel_requested_at: null });
        await expect(pool.query(`INSERT INTO knowledge_ingestion_jobs (id, kind, actor_kind) VALUES ($1, 'rechunk', 'robot')`, [randomUUID()]))
            .rejects.toMatchObject({ code: '23514' });
    });

    it('heartbeat 는 worker_id 로 upsert 된다', async () => {
        const wid = `test-${randomUUID()}`;
        workerIds.push(wid);
        const upsert = `INSERT INTO knowledge_worker_heartbeats (worker_id, mode, generation, inflight) VALUES ($1, 'external', $2, $3)
                        ON CONFLICT (worker_id) DO UPDATE SET generation = EXCLUDED.generation, inflight = EXCLUDED.inflight, last_seen = NOW()`;
        await pool.query(upsert, [wid, 1, 0]);
        await pool.query(upsert, [wid, 2, 1]);
        const r = await pool.query('SELECT mode, generation, inflight FROM knowledge_worker_heartbeats WHERE worker_id = $1', [wid]);
        expect(r.rows).toEqual([{ mode: 'external', generation: 2, inflight: 1 }]);
    });

    it('004 이전 모양으로 넣은 행(새 열을 안 줌)은 새 열이 NULL 로 읽힌다 — 옛 코드의 INSERT 가 깨지지 않는다', async () => {
        const id = randomUUID();
        jobIds.push(id);
        await pool.query(`INSERT INTO knowledge_ingestion_jobs (id, kind, run_after) VALUES ($1, 'cleanup', NOW())`, [id]);
        const r = await pool.query('SELECT state, actor_kind, policy_revision FROM knowledge_ingestion_jobs WHERE id = $1', [id]);
        expect(r.rows[0]).toEqual({ state: 'queued', actor_kind: null, policy_revision: null });
    });
});
