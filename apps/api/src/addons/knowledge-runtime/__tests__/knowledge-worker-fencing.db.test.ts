/**
 * 재선점 fencing 실 DB 검증(일회용 pgvector 컨테이너) — TEST_DATABASE_URL 없으면 skip. 운영·로컬 본 DB 에 붙지 않는다.
 * 빈 DB 를 전제로 beforeAll 이 최소 선행 테이블(conversation_sessions)과 knowledge 마이그레이션 001 을 적용한다
 * (2026-10-16 운영 재현 하네스와 같은 fixture).
 *  ① A 의 lease 만료 뒤 B 재선점 → A heartbeat 0행·검사 거절, B 통과
 *  ② 게시 트랜잭션이 FOR SHARE 로 잡은 행은 다른 claim 이 건너뛴다
 *  ③ 실제 worker 둘: A 가 readFile 에서 기다리는 동안 B 가 완료 → A 의 늦은 청크·ready 쓰기 거절, B 결과 유지
 *  ④ 재선점 뒤 A 의 readFile 오류 → failed 를 쓰지 않는다(B 의 ready 유지)
 *  ⑤ 다중 행 쓰기(한 문장 상한 2행): 배치 경계를 넘는 청크·임베딩이 한 번씩만 저장(중복 0)
 *  ⑥ 같은 청크에 insertEmbeddings 를 다시 하면 ON CONFLICT 로 갱신(행 수 불변)
 * 끝나면 만든 job·space 를 id 로 지운다.
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { applyKnowledgeSchema, KNOWLEDGE_DB_LOCK_HOOK_TIMEOUT_MS, lockKnowledgeQueueTests, resetWorkerMode } from './helpers/db-serial';

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
    getDefaultLimits: async () => ({ ingestConcurrency: 1, jobLeaseMs: 60_000, jobMaxAttempts: 3 }),
}));
// 한 문장당 행 수 상한을 작게 — 다중 행 INSERT 가 배치 경계를 넘는 경우를 실 DB 로 본다
jest.mock('../constants', () => {
    const actual = jest.requireActual('../constants');
    return { ...actual, KNOWLEDGE_RUNTIME: { ...actual.KNOWLEDGE_RUNTIME, WRITE_BATCH_ROWS: 2 } };
});
// 외부 모델·파일 저장소는 부르지 않는다 — deps 로 주입한 readFile·embed 만 쓴다
jest.mock('../embedding/provider', () => ({ makeIndexEmbedder: () => { throw new Error('모델 호출 금지'); }, classifyEmbedError: () => 'provider' }));
jest.mock('../documents/storage', () => ({ readStoredFile: () => { throw new Error('파일 읽기 금지'); }, deleteStoredFile: jest.fn() }));
jest.mock('../../../runtime-ports/addon-admission', () => ({
    readAddonRunVerdict: async () => ({ run: true }),
    checkUserEntitlement: async () => 'ok',
    readAddonStateRevision: async () => 1,
    warmAddonStates: async () => undefined,
}));

import { KnowledgeWorker, type JobRow } from '../jobs/worker';
import { createJobLease, assertLeaseHeld, LeaseLostError, type JobLease } from '../jobs/lease';
import { insertEmbeddings, type KnowledgeIndex } from '../embedding/index-catalog';

const dbMock = jest.requireMock('../db') as { __pool: Pool; inTransaction: <T>(fn: (c: PoolClient) => Promise<T>) => Promise<T> };
const pool = dbMock.__pool;
type WorkerInternals = { owner: string; claim(limit: number, leaseMs: number): Promise<JobRow[]>; renew(lease: JobLease, ms: number): Promise<void> };
const internals = (w: KnowledgeWorker) => w as unknown as WorkerInternals;
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; };

let unlock: (() => Promise<void>) | undefined;

let index: KnowledgeIndex;
const jobIds: string[] = [];
const spaceIds: string[] = [];

async function insertJob(): Promise<string> {
    const id = randomUUID();
    await pool.query(`INSERT INTO knowledge_ingestion_jobs (id, kind, state, run_after) VALUES ($1, 'cleanup', 'queued', NOW())`, [id]);
    jobIds.push(id);
    return id;
}

interface IngestFixture { space: string; doc: string; version: string; job: string }
/** 수집 작업 하나 — space·문서·버전(text/plain, 원본은 deps.readFile 이 준다)·ingest job */
async function ingestFixture(): Promise<IngestFixture> {
    const f = { space: randomUUID(), doc: randomUUID(), version: randomUUID(), job: randomUUID() };
    // 공간은 테스트 색인에 고정한다(006) — 게시 검사가 공간 포인터를 본다
    await pool.query(
        `INSERT INTO knowledge_spaces (id, scope_type, scope_id, created_by, name, embedding_index_id) VALUES ($1, 'user', 'fence-test', 'fence-test', 'fence', $2)`,
        [f.space, index.id],
    );
    await pool.query(`INSERT INTO knowledge_documents (id, space_id, logical_name, created_by) VALUES ($1, $2, 'fence.txt', 'fence-test')`, [f.doc, f.space]);
    await pool.query(
        `INSERT INTO knowledge_document_versions (id, document_id, content_hash, mime_type, original_filename, storage_ref, source_size)
         VALUES ($1, $2, $3, 'text/plain', 'fence.txt', 'unused', 100)`,
        [f.version, f.doc, 'a'.repeat(64)],
    );
    await pool.query(`INSERT INTO knowledge_ingestion_jobs (id, kind, document_version_id, space_id) VALUES ($1, 'ingest', $2, $3)`, [f.job, f.version, f.space]);
    jobIds.push(f.job);
    spaceIds.push(f.space);
    return f;
}

const deps = (readFile: () => Promise<Buffer>) => ({
    readFile, ensureIndex: async () => index, embed: async (texts: string[]) => texts.map(() => [1, 0, 0, 0, 0, 0, 0, 0]),
});

async function state(f: IngestFixture) {
    return (await pool.query<{ state: string; fencing_token: string; version_status: string; document_status: string; content: string | null }>(
        `SELECT j.state, j.fencing_token, v.status AS version_status, d.status AS document_status,
                (SELECT string_agg(content, ' ' ORDER BY sequence) FROM knowledge_chunks WHERE document_version_id = v.id) AS content
           FROM knowledge_ingestion_jobs j
           JOIN knowledge_document_versions v ON v.id = j.document_version_id
           JOIN knowledge_documents d ON d.id = v.document_id
          WHERE j.id = $1`,
        [f.job],
    )).rows[0];
}

describeOrSkip('knowledge worker fencing (실 DB)', () => {
    beforeAll(async () => {
        unlock = await lockKnowledgeQueueTests(pool);
        await applyKnowledgeSchema(pool); // 001 + 004 + 006, IF NOT EXISTS — 재실행 안전
        await resetWorkerMode(pool); // claim 은 inprocess 소비자로 집는다(Task 4)
        const id = randomUUID();
        // 공간마다 색인을 고정하므로 전역 활성을 건드리지 않는다 — provider_ref 를 달리해 ready 유니크와도 겹치지 않게
        const providerRef = `fake-fence:embed-${id.slice(0, 8)}`;
        await pool.query(
            `INSERT INTO knowledge_embedding_indexes (id, provider_ref, model_id, dimension, distance_metric, status, is_active, activated_at)
             VALUES ($1, $2, 'fake', 8, 'cosine', 'ready', FALSE, NOW())`,
            [id, providerRef],
        );
        index = { id, providerRef, modelId: 'fake', dimension: 8, metric: 'cosine', status: 'ready', requestParams: {} };
    }, KNOWLEDGE_DB_LOCK_HOOK_TIMEOUT_MS);
    afterAll(async () => {
        if (jobIds.length) await pool.query(`DELETE FROM knowledge_ingestion_jobs WHERE id = ANY($1::text[])`, [jobIds]);
        if (spaceIds.length) await pool.query(`DELETE FROM knowledge_spaces WHERE id = ANY($1::text[])`, [spaceIds]); // cascade: 문서·버전·청크·임베딩
        await pool.query(`DELETE FROM knowledge_embedding_indexes WHERE id = $1`, [index.id]);
        await unlock?.();
        await pool.end();
    });

    it('A 의 lease 만료 뒤 B 가 집으면 A 는 heartbeat 0행·검사 거절, B 는 통과', async () => {
        const jobId = await insertJob();
        const A = new KnowledgeWorker();
        const B = new KnowledgeWorker();
        const [rowA] = await internals(A).claim(1, 60_000);
        expect(rowA.id).toBe(jobId);
        const leaseA = createJobLease({ jobId, token: rowA.fencing_token, owner: internals(A).owner });

        await pool.query(`UPDATE knowledge_ingestion_jobs SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1`, [jobId]);
        const [rowB] = await internals(B).claim(1, 60_000);
        expect(rowB.id).toBe(jobId);
        expect(BigInt(rowB.fencing_token)).toBe(BigInt(rowA.fencing_token) + 1n); // BIGINT 는 문자열로 받는다 — Number 로 비교하지 않는다
        const leaseB = createJobLease({ jobId, token: rowB.fencing_token, owner: internals(B).owner });

        await internals(A).renew(leaseA, 60_000);
        expect(leaseA.signal.aborted).toBe(true);

        const c = await pool.connect();
        try {
            await c.query('BEGIN');
            await expect(assertLeaseHeld(c, leaseB)).resolves.toBeUndefined();
            await c.query('COMMIT');
            await c.query('BEGIN');
            const freshA = createJobLease({ jobId, token: rowA.fencing_token, owner: internals(A).owner });
            await expect(assertLeaseHeld(c, freshA)).rejects.toThrow(LeaseLostError);
            await c.query('ROLLBACK');
        } finally { c.release(); }
    });

    it('게시 트랜잭션이 FOR SHARE 로 잡은 동안 만료된 lease 라도 다른 claim 이 그 행을 건너뛴다', async () => {
        const jobId = await insertJob();
        const A = new KnowledgeWorker();
        const [rowA] = await internals(A).claim(1, 60_000);
        const leaseA = createJobLease({ jobId, token: rowA.fencing_token, owner: internals(A).owner });
        await pool.query(`UPDATE knowledge_ingestion_jobs SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1`, [jobId]);

        const c = await pool.connect();
        try {
            await c.query('BEGIN');
            await assertLeaseHeld(c, leaseA); // 행 잠금 유지 중
            const B = new KnowledgeWorker();
            const got = await internals(B).claim(5, 60_000);
            expect(got.map((r) => r.id)).not.toContain(jobId);
            await c.query('COMMIT');
        } finally { c.release(); }

        const B2 = new KnowledgeWorker();
        const after = await internals(B2).claim(5, 60_000);
        expect(after.map((r) => r.id)).toContain(jobId);
    });

    it('실제 worker 둘: A 가 readFile 에서 기다리는 동안 B 가 다시 집어 완료하면 A 의 늦은 청크·ready 쓰기는 거절되고 B 결과가 남는다', async () => {
        const f = await ingestFixture();
        const entered = deferred();
        const release = deferred();
        const A = new KnowledgeWorker(deps(async () => { entered.resolve(); await release.promise; return Buffer.from('STALE_A'); }));
        const pendingA = A.tick();
        await entered.promise; // A 는 validating 단계를 지나 readFile 에서 멈춰 있다(token 1)
        await pool.query(`UPDATE knowledge_ingestion_jobs SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1`, [f.job]);
        const B = new KnowledgeWorker(deps(async () => Buffer.from('CURRENT_B')));
        expect(await B.tick()).toBe(1);
        const before = await state(f);
        expect(before).toMatchObject({ state: 'done', fencing_token: '2', version_status: 'ready', document_status: 'ready' });
        expect(before.content).toContain('CURRENT_B');
        release.resolve();
        await pendingA; // A 는 extracting 단계 상태 쓰기의 lease 검사에서 LeaseLostError — worker 는 로그만 남기고 끝난다(던지지 않는다)
        const after = await state(f);
        expect(after).toMatchObject({ state: 'done', fencing_token: '2', version_status: 'ready', document_status: 'ready' });
        expect(after.content).toContain('CURRENT_B');
        expect(after.content).not.toContain('STALE_A');
    });

    it('재선점 뒤 A 의 readFile 오류는 failed 를 쓰지 않는다(B 의 ready 유지)', async () => {
        const f = await ingestFixture();
        const entered = deferred();
        const release = deferred();
        const A = new KnowledgeWorker(deps(async () => { entered.resolve(); await release.promise; throw new Error('옛 실행자의 읽기 오류'); }));
        const pendingA = A.tick();
        await entered.promise;
        await pool.query(`UPDATE knowledge_ingestion_jobs SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1`, [f.job]);
        const B = new KnowledgeWorker(deps(async () => Buffer.from('CURRENT_B')));
        expect(await B.tick()).toBe(1);
        release.resolve();
        await pendingA; // A 의 markFailed 는 lease 검사(0행)에서 거절된다
        const after = await state(f);
        expect(after).toMatchObject({ state: 'done', fencing_token: '2', version_status: 'ready', document_status: 'ready' });
        expect(after.content).toContain('CURRENT_B');
    });

    /** 이 버전의 청크 수·색인 임베딩 수·(청크, 색인) 중복 수 */
    async function writeCounts(f: IngestFixture) {
        return (await pool.query<{ chunks: number; embeddings: number; dup: number; seqs: number }>(
            `SELECT (SELECT COUNT(*)::int FROM knowledge_chunks WHERE document_version_id = $1) AS chunks,
                    (SELECT COUNT(DISTINCT sequence)::int FROM knowledge_chunks WHERE document_version_id = $1) AS seqs,
                    (SELECT COUNT(*)::int FROM knowledge_chunk_embeddings e JOIN knowledge_chunks c ON c.id = e.chunk_id
                      WHERE c.document_version_id = $1 AND e.embedding_index_id = $2) AS embeddings,
                    (SELECT COUNT(*)::int FROM (
                       SELECT e.chunk_id FROM knowledge_chunk_embeddings e JOIN knowledge_chunks c ON c.id = e.chunk_id
                        WHERE c.document_version_id = $1 GROUP BY e.chunk_id, e.embedding_index_id HAVING COUNT(*) > 1) d) AS dup`,
            [f.version, index.id],
        )).rows[0];
    }
    const longText = () => Buffer.from(Array.from({ length: 6000 }, (_, i) => `w${i}`).join(' '));

    it('다중 행 쓰기: 배치 경계(2행)를 넘는 청크·임베딩이 한 번씩만 저장된다(중복 0)', async () => {
        const f = await ingestFixture();
        const W = new KnowledgeWorker(deps(async () => longText()));
        expect(await W.tick()).toBe(1);
        expect(await state(f)).toMatchObject({ state: 'done', version_status: 'ready', document_status: 'ready' });
        const n = await writeCounts(f);
        expect(n.chunks).toBeGreaterThan(2); // 분할이 실제로 일어날 만큼
        expect(n.seqs).toBe(n.chunks);
        expect(n.embeddings).toBe(n.chunks);
        expect(n.dup).toBe(0);
    });

    it('같은 청크에 insertEmbeddings 를 다시 하면 ON CONFLICT 로 벡터만 갱신된다(행 수 불변·중복 0)', async () => {
        const f = await ingestFixture();
        expect(await new KnowledgeWorker(deps(async () => longText())).tick()).toBe(1);
        const before = await writeCounts(f);
        const chunkIds = (await pool.query<{ id: string }>(
            `SELECT id FROM knowledge_chunks WHERE document_version_id = $1 ORDER BY sequence`, [f.version],
        )).rows.map((r) => r.id);
        const vec = [0, 1, 0, 0, 0, 0, 0, 0];
        await dbMock.inTransaction((c) => insertEmbeddings(c, index.id, chunkIds.map((chunkId) => ({ chunkId, vector: vec }))));
        const after = await writeCounts(f);
        expect(after).toEqual(before);
        const vectors = (await pool.query<{ v: string }>(
            `SELECT DISTINCT e.embedding::text AS v FROM knowledge_chunk_embeddings e JOIN knowledge_chunks c ON c.id = e.chunk_id
              WHERE c.document_version_id = $1 AND e.embedding_index_id = $2`,
            [f.version, index.id],
        )).rows.map((r) => r.v);
        expect(vectors).toEqual(['[0,1,0,0,0,0,0,0]']);
    });
});
