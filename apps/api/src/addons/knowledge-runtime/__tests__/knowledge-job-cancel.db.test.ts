// apps/api/src/addons/knowledge-runtime/__tests__/knowledge-job-cancel.db.test.ts
/**
 * 취소 실 DB 검증 — TEST_DATABASE_URL 없으면 skip. 작업 큐 직렬화 lock 아래에서 돈다.
 *  ① 대기 중 본인 수집 작업 → API 가 바로 cancelled, 문서 버전 failed·CANCELLED, 이후 claim 이 집지 않는다
 *  ② 실행 중 → API 는 cancelling, 실행자의 heartbeat(1초)가 읽고 단계 경계에서 멈춘 뒤 cancelled(청크 없음)
 *  ③ 남의 작업 404, 관리자는 시스템 작업 취소, 끝난 작업 409
 * 만든 job·space 는 id 로만 지운다.
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { applyKnowledgeSchema, lockKnowledgeQueueTests, resetWorkerMode } from './helpers/db-serial';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;

jest.mock('../db', () => {
    const { Pool: PgPool } = require('pg');
    const pool = new PgPool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
    return {
        __esModule: true,
        __pool: pool,
        kdb: () => pool,
        inTransaction: async (fn: (c: unknown) => Promise<unknown>) => {
            const c = await pool.connect();
            try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
            catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; }
            finally { c.release(); }
        },
    };
});
jest.mock('../config/profiles', () => ({
    ...jest.requireActual('../config/profiles'),
    // heartbeat 주기 = max(1초, 2초 × 0.4) = 1초 — 실행 중 취소 감지를 빨리 보게
    getDefaultLimits: async () => ({ ingestConcurrency: 1, jobLeaseMs: 2_000, jobMaxAttempts: 3 }),
}));
jest.mock('../embedding/provider', () => ({ makeIndexEmbedder: () => { throw new Error('모델 호출 금지'); } }));
jest.mock('../documents/storage', () => ({ readStoredFile: () => { throw new Error('파일 읽기 금지'); }, deleteStoredFile: jest.fn() }));
jest.mock('../../../runtime-ports/addon-admission', () => ({
    readAddonRunVerdict: async () => ({ run: true }),
    checkUserEntitlement: async () => 'ok',
    readAddonStateRevision: async () => 1,
    warmAddonStates: async () => undefined,
}));
const audit = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('../../../runtime-ports/audit-port', () => ({ recordAddonAudit: (...a: unknown[]) => audit(...a) }));

import { KnowledgeWorker } from '../jobs/worker';
import { requestJobCancel } from '../jobs/cancel';

const pool = (jest.requireMock('../db') as { __pool: Pool }).__pool;
const jobIds: string[] = [];
const spaceIds: string[] = [];
const OWNER = 'cancel-owner';

interface Fixture { space: string; doc: string; version: string; job: string }
async function ingestFixture(): Promise<Fixture> {
    const f = { space: randomUUID(), doc: randomUUID(), version: randomUUID(), job: randomUUID() };
    await pool.query(`INSERT INTO knowledge_spaces (id, scope_type, scope_id, created_by, name) VALUES ($1, 'user', $2, $2, 'cancel')`, [f.space, OWNER]);
    await pool.query(`INSERT INTO knowledge_documents (id, space_id, logical_name, created_by) VALUES ($1, $2, 'cancel.txt', $3)`, [f.doc, f.space, OWNER]);
    await pool.query(
        `INSERT INTO knowledge_document_versions (id, document_id, content_hash, mime_type, original_filename, storage_ref, source_size)
         VALUES ($1, $2, $3, 'text/plain', 'cancel.txt', 'unused', 100)`,
        [f.version, f.doc, 'c'.repeat(64)],
    );
    await pool.query(
        `INSERT INTO knowledge_ingestion_jobs (id, kind, document_version_id, space_id, actor_kind, actor_user_id, run_after)
         VALUES ($1, 'ingest', $2, $3, 'user', $4, NOW() - INTERVAL '1 day')`,
        [f.job, f.version, f.space, OWNER],
    );
    jobIds.push(f.job);
    spaceIds.push(f.space);
    return f;
}

async function snapshot(f: Fixture) {
    return (await pool.query<{ state: string; cancel_requested_at: Date | null; version_status: string; failure_code: string | null; document_status: string; chunks: string }>(
        `SELECT j.state, j.cancel_requested_at, v.status AS version_status, v.failure_code, d.status AS document_status,
                (SELECT COUNT(*)::text FROM knowledge_chunks c WHERE c.document_version_id = v.id) AS chunks
           FROM knowledge_ingestion_jobs j
           JOIN knowledge_document_versions v ON v.id = j.document_version_id
           JOIN knowledge_documents d ON d.id = v.document_id
          WHERE j.id = $1`,
        [f.job],
    )).rows[0];
}

describeOrSkip('knowledge 작업 취소 (실 DB)', () => {
    let unlock: () => Promise<void>;
    beforeAll(async () => {
        unlock = await lockKnowledgeQueueTests(pool);
        await applyKnowledgeSchema(pool);
        await resetWorkerMode(pool);
    });
    afterAll(async () => {
        if (jobIds.length) await pool.query('DELETE FROM knowledge_ingestion_jobs WHERE id = ANY($1::text[])', [jobIds]);
        if (spaceIds.length) await pool.query('DELETE FROM knowledge_spaces WHERE id = ANY($1::text[])', [spaceIds]);
        await unlock();
        await pool.end();
    });

    it('대기 중 본인 작업은 바로 cancelled, 문서 버전은 failed·CANCELLED, 이후 claim 이 집지 않는다', async () => {
        const f = await ingestFixture();
        await expect(requestJobCancel({ jobId: f.job, userId: OWNER, isAdmin: false })).resolves.toEqual({ jobId: f.job, state: 'cancelled' });
        const s = await snapshot(f);
        expect(s).toMatchObject({ state: 'cancelled', version_status: 'failed', failure_code: 'CANCELLED', document_status: 'failed' });
        expect(s.cancel_requested_at).not.toBeNull();
        const claimed = await (new KnowledgeWorker() as unknown as { claim(l: number, ms: number): Promise<Array<{ id: string }>> }).claim(5, 2_000);
        expect(claimed.map((r) => r.id)).not.toContain(f.job);
    });

    it('실행 중 취소 — heartbeat 가 읽고 단계 경계에서 멈춘 뒤 cancelled(청크·ready 쓰기 없음)', async () => {
        const f = await ingestFixture();
        let entered!: () => void;
        const enteredP = new Promise<void>((r) => { entered = r; });
        // readFile 에서 2.5초 머문다 — 그 사이 heartbeat(1초 주기)가 취소 요청을 읽는다. 끝나면 extracting 경계에서 멈춘다
        const w = new KnowledgeWorker({
            readFile: async () => { entered(); await new Promise((r) => setTimeout(r, 2_500)); return Buffer.from('취소될 문서'); },
            ensureIndex: async () => { throw new Error('여기까지 오면 안 된다'); },
        });
        const ticking = w.tick();
        await enteredP;
        await expect(requestJobCancel({ jobId: f.job, userId: OWNER, isAdmin: false })).resolves.toEqual({ jobId: f.job, state: 'cancelling' });
        expect(await ticking).toBe(1);
        const s = await snapshot(f);
        expect(s).toMatchObject({ state: 'cancelled', version_status: 'failed', failure_code: 'CANCELLED', chunks: '0' });
    }, 20_000);

    it('남의 작업은 404, 관리자는 시스템 작업을 취소, 끝난 작업은 409', async () => {
        const f = await ingestFixture();
        await expect(requestJobCancel({ jobId: f.job, userId: 'someone-else', isAdmin: false })).rejects.toMatchObject({ statusCode: 404 });
        const sys = randomUUID();
        jobIds.push(sys);
        await pool.query(`INSERT INTO knowledge_ingestion_jobs (id, kind, actor_kind, run_after) VALUES ($1, 'cleanup', 'system', NOW() + INTERVAL '1 day')`, [sys]);
        await expect(requestJobCancel({ jobId: sys, userId: 'admin-1', isAdmin: true })).resolves.toEqual({ jobId: sys, state: 'cancelled' });
        await expect(requestJobCancel({ jobId: sys, userId: 'admin-1', isAdmin: true })).rejects.toMatchObject({ statusCode: 409, code: 'JOB_NOT_CANCELLABLE' });
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'knowledge.job_cancelled', resourceId: sys }));
    });
});
