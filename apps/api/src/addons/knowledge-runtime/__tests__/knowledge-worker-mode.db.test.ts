/**
 * 모드 실 DB 검증 — TEST_DATABASE_URL 없으면 skip. 작업 큐 직렬화 lock 아래에서 돈다.
 *  ① 모드 inprocess: external 소비자는 집지 않고 inprocess 는 집는다
 *  ② 모드 external(generation+1): 반대로 된다
 *  ③ 모드 행이 없으면 아무도 집지 않는다
 *  ④ 모드 전환 트랜잭션이 행을 잡고 있는 동안 시작한 claim 은 기다렸다가 새 모드를 본다(FOR SHARE)
 *  ⑤ scripts/knowledge-worker-mode.sh set·generation·running-leases(호스트에 psql 이 있을 때만)
 * claim 만 부르고 핸들러는 돌리지 않는다. 만든 job 은 id 로만 지운다.
 */
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { applyKnowledgeSchema, lockKnowledgeQueueTests, resetWorkerMode } from './helpers/db-serial';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;
const HAS_PSQL = spawnSync('psql', ['--version']).status === 0;
const MODE_SH = resolve(__dirname, '../../../../../../scripts/knowledge-worker-mode.sh');

jest.mock('../db', () => {
    const { Pool: PgPool } = require('pg');
    const pool = new PgPool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
    return { __esModule: true, __pool: pool, kdb: () => pool, inTransaction: async () => { throw new Error('사용 안 함'); } };
});
jest.mock('../../../runtime-ports/addon-admission', () => ({
    readAddonRunVerdict: async () => ({ run: true }),
    checkUserEntitlement: async () => 'ok',
    readAddonStateRevision: async () => 1,
    warmAddonStates: async () => undefined,
}));

import { KnowledgeWorker } from '../jobs/worker';

const pool = (jest.requireMock('../db') as { __pool: Pool }).__pool;
const jobIds: string[] = [];
type Claimer = { claim(limit: number, leaseMs: number): Promise<Array<{ id: string }>> };
const claimer = (kind: 'inprocess' | 'external') => new KnowledgeWorker({ consumerKind: kind }) as unknown as Claimer;

/** 아주 오래전에 due 가 된 cleanup 작업 — ORDER BY run_after 로 가장 먼저 집힌다 */
async function insertJob(): Promise<string> {
    const id = randomUUID();
    await pool.query(`INSERT INTO knowledge_ingestion_jobs (id, kind, actor_kind, run_after) VALUES ($1, 'cleanup', 'system', NOW() - INTERVAL '30 days')`, [id]);
    jobIds.push(id);
    return id;
}
const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);
async function setMode(mode: 'inprocess' | 'external'): Promise<number> {
    const r = await pool.query<{ generation: number }>(
        `UPDATE knowledge_worker_mode SET mode = $1, generation = generation + 1, updated_at = NOW() WHERE id = 1 RETURNING generation`,
        [mode],
    );
    return r.rows[0].generation;
}

describeOrSkip('knowledge worker 모드 (실 DB)', () => {
    let unlock: () => Promise<void>;
    beforeAll(async () => {
        unlock = await lockKnowledgeQueueTests(pool);
        await applyKnowledgeSchema(pool);
    });
    beforeEach(async () => { await resetWorkerMode(pool); });
    afterAll(async () => {
        if (jobIds.length) await pool.query('DELETE FROM knowledge_ingestion_jobs WHERE id = ANY($1::text[])', [jobIds]);
        await pool.query(`INSERT INTO knowledge_worker_mode (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
        await resetWorkerMode(pool);
        await unlock();
        await pool.end();
    });

    it('모드 inprocess — external 소비자는 집지 않고 inprocess 는 집는다', async () => {
        const job = await insertJob();
        expect(ids(await claimer('external').claim(1, 60_000))).not.toContain(job);
        expect(ids(await claimer('inprocess').claim(1, 60_000))).toContain(job);
    });

    it('모드 external(generation+1) — 반대로 된다', async () => {
        const before = (await pool.query<{ generation: number }>('SELECT generation FROM knowledge_worker_mode WHERE id = 1')).rows[0].generation;
        expect(await setMode('external')).toBe(before + 1);
        const job = await insertJob();
        expect(ids(await claimer('inprocess').claim(1, 60_000))).not.toContain(job);
        expect(ids(await claimer('external').claim(1, 60_000))).toContain(job);
    });

    it('모드 행이 없으면 아무도 집지 않는다', async () => {
        const job = await insertJob();
        await pool.query('DELETE FROM knowledge_worker_mode WHERE id = 1');
        try {
            expect(ids(await claimer('inprocess').claim(1, 60_000))).not.toContain(job);
            expect(ids(await claimer('external').claim(1, 60_000))).not.toContain(job);
        } finally {
            await pool.query(`INSERT INTO knowledge_worker_mode (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
        }
    });

    it('전환 트랜잭션이 커밋되기 전에 시작한 claim 은 기다렸다가 새 모드를 본다', async () => {
        const job = await insertJob();
        const tx = await pool.connect();
        try {
            await tx.query('BEGIN');
            await tx.query(`UPDATE knowledge_worker_mode SET mode = 'external', generation = generation + 1 WHERE id = 1`);
            let settled = false;
            const pending = claimer('inprocess').claim(1, 60_000).then((rows) => { settled = true; return rows; });
            await new Promise((r) => setTimeout(r, 300));
            expect(settled).toBe(false); // FOR SHARE 가 전환 행 잠금을 기다린다
            await tx.query('COMMIT');
            expect(ids(await pending)).not.toContain(job);
        } finally {
            tx.release();
        }
    });

    (HAS_PSQL ? it : it.skip)('모드 스크립트 — set 은 generation 을 1 올리고, generation·running-leases 를 읽는다', async () => {
        const env = { PATH: process.env.PATH ?? '', DATABASE_URL: CONN ?? '' };
        const before = Number(spawnSync('bash', [MODE_SH, 'generation'], { env, encoding: 'utf8' }).stdout.trim());
        const set = spawnSync('bash', [MODE_SH, 'set', 'external'], { env, encoding: 'utf8' });
        expect(set.status).toBe(0);
        expect(set.stdout.trim()).toBe(`mode|external|generation ${before + 1}`);
        expect(Number(spawnSync('bash', [MODE_SH, 'generation'], { env, encoding: 'utf8' }).stdout.trim())).toBe(before + 1);
        const leases = spawnSync('bash', [MODE_SH, 'running-leases'], { env, encoding: 'utf8' });
        expect(leases.status).toBe(0);
        expect(Number.isInteger(Number(leases.stdout.trim()))).toBe(true);
        const show = spawnSync('bash', [MODE_SH, 'show'], { env, encoding: 'utf8' });
        expect(show.stdout).toMatch(/^mode\|external\|generation /m);
    });
});
