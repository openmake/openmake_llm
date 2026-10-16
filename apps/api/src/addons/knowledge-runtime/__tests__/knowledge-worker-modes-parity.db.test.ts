/**
 * 두 모드 결과 비교 — 같은 문서를 inprocess(이 테스트 프로세스 안 worker)와 external(별도 프로세스)로 각각 수집해
 * 청크 순서·내용·임베딩 벡터·상태가 같은지 본다. TEST_DATABASE_URL 없으면 skip. 작업 큐 직렬화 lock 아래에서 돈다.
 * inprocess 쪽은 같은 가짜 벡터 함수를 deps.embed 로, external 쪽은 가짜 게이트웨이(HTTP)로 받는다.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { applyKnowledgeSchema, lockKnowledgeQueueTests, resetWorkerMode } from './helpers/db-serial';
import {
    activateFakeIndex, assertFullTestSchema, fakeVector, insertIngestFixture, jobSnapshot, spawnWorker, startFakeGateway,
    stopWorker, waitFor, workerEnv, type FakeGateway, type WorkerChild,
} from './helpers/worker-process-harness';

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
jest.mock('../../../runtime-ports/addon-admission', () => ({
    readAddonRunVerdict: async () => ({ run: true }),
    checkUserEntitlement: async () => 'ok',
    readAddonStateRevision: async () => 1,
    warmAddonStates: async () => undefined,
}));

import { KnowledgeWorker } from '../jobs/worker';

const pool = (jest.requireMock('../db') as { __pool: Pool }).__pool;
const TEXT = `두 모드 비교 문서입니다. ${'같은 내용을 두 번 수집해 결과를 비교한다. '.repeat(40)}`;

async function chunksOf(versionId: string): Promise<Array<{ sequence: number; content: string; embedding: string }>> {
    return (await pool.query<{ sequence: number; content: string; embedding: string }>(
        `SELECT c.sequence, c.content, e.embedding::text AS embedding
           FROM knowledge_chunks c JOIN knowledge_chunk_embeddings e ON e.chunk_id = c.id
          WHERE c.document_version_id = $1 ORDER BY c.sequence`,
        [versionId],
    )).rows;
}

describeOrSkip('knowledge 두 모드 결과 비교 (실 DB)', () => {
    const jobIds: string[] = [];
    const spaceIds: string[] = [];
    let child: WorkerChild | null = null;
    let unlock: () => Promise<void>;
    let gateway: FakeGateway;
    let storageDir: string;
    const prevStorageDir = process.env.KNOWLEDGE_STORAGE_DIR;

    beforeAll(async () => {
        unlock = await lockKnowledgeQueueTests(pool);
        await assertFullTestSchema(pool);
        await applyKnowledgeSchema(pool);
        await resetWorkerMode(pool);
        await activateFakeIndex(pool);
        gateway = await startFakeGateway(fakeVector);
        storageDir = await mkdtemp(join(tmpdir(), 'knowledge-parity-'));
        // inprocess 쪽(이 프로세스 안 worker)도 fixture 원본을 같은 곳에서 읽는다 — STORAGE_DIR 은 env 를 매번 읽는 getter
        process.env.KNOWLEDGE_STORAGE_DIR = storageDir;
    });
    afterAll(async () => {
        if (child) await stopWorker(child, 'SIGKILL', 5_000);
        await gateway.close();
        if (jobIds.length) await pool.query('DELETE FROM knowledge_ingestion_jobs WHERE id = ANY($1::text[])', [jobIds]);
        if (spaceIds.length) await pool.query('DELETE FROM knowledge_spaces WHERE id = ANY($1::text[])', [spaceIds]);
        await resetWorkerMode(pool);
        await rm(storageDir, { recursive: true, force: true });
        if (prevStorageDir === undefined) delete process.env.KNOWLEDGE_STORAGE_DIR;
        else process.env.KNOWLEDGE_STORAGE_DIR = prevStorageDir;
        await unlock();
        await pool.end();
    });

    it('같은 문서 → inprocess 와 external 의 청크·임베딩·상태가 같다', async () => {
        // inprocess — 테스트 프로세스 안 worker 가 집는다
        const a = await insertIngestFixture(pool, storageDir, TEXT);
        jobIds.push(a.job);
        spaceIds.push(a.space);
        const local = new KnowledgeWorker({ consumerKind: 'inprocess', embed: async (texts: string[]) => texts.map(fakeVector) });
        expect(await local.tick()).toBeGreaterThanOrEqual(1);
        expect(await jobSnapshot(pool, a.job)).toMatchObject({ state: 'done', version_status: 'ready' });

        // external — 모드를 바꾸고 별도 프로세스가 집는다
        await pool.query(`UPDATE knowledge_worker_mode SET mode = 'external', generation = generation + 1, updated_at = NOW() WHERE id = 1`);
        const b = await insertIngestFixture(pool, storageDir, TEXT);
        jobIds.push(b.job);
        spaceIds.push(b.space);
        child = spawnWorker(workerEnv({ databaseUrl: CONN ?? '', gatewayUrl: gateway.url, storageDir }));
        await waitFor(() => jobSnapshot(pool, b.job), (s) => s.state === 'done', 90_000, 'external 완료', child);
        expect(await jobSnapshot(pool, b.job)).toMatchObject({ state: 'done', version_status: 'ready' });

        const [chunksA, chunksB] = await Promise.all([chunksOf(a.version), chunksOf(b.version)]);
        expect(chunksA.length).toBeGreaterThan(0);
        expect(chunksB).toEqual(chunksA);
        expect(await stopWorker(child, 'SIGTERM', 30_000)).toBe(0);
        child = null;
    }, 150_000);
});
