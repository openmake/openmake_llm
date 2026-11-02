// apps/api/src/addons/knowledge-runtime/__tests__/knowledge-admin-jobcounts.db.test.ts
/**
 * 관리자 상태 jobCounts 실 DB 검증 — TEST_DATABASE_URL 없으면 skip. 작업 큐 직렬화 lock 아래에서 돈다.
 * 미삭제 공간 작업·공간 없는 작업은 세고, 소프트 삭제(deleted_at)된 공간의 작업은 세지 않는다(다른 데이터 영향 없게 전후 차이로 본다).
 * 문서 수집(ingest) 작업은 실제 흐름처럼 space_id 없이 문서 버전만 가리키며, 그 문서의 공간으로 판정한다.
 * 만든 job·space 는 id 로만 지운다(문서·버전은 공간 FK CASCADE 로 함께 지워진다).
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { applyKnowledgeSchema, KNOWLEDGE_DB_LOCK_HOOK_TIMEOUT_MS, lockKnowledgeQueueTests } from './helpers/db-serial';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;

jest.mock('../db', () => {
    const { Pool: PgPool } = require('pg');
    const pool = new PgPool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
    return { __esModule: true, __pool: pool, kdb: () => pool };
});
// capabilities 는 이 검증 대상이 아니다 — 임베딩 배정·공급자 조회를 하지 않게 고정
jest.mock('../capabilities', () => ({
    getCapabilities: async () => ({ ready: true, blockedReasons: [] }),
    pgvectorVersion: async () => null,
}));

import { getAdminStatus } from '../admin/service';

const pool = (jest.requireMock('../db') as { __pool: Pool }).__pool;
const jobIds: string[] = [];
const spaceIds: string[] = [];
const OWNER = 'jobcounts-owner';

async function insertSpace(deleted: boolean): Promise<string> {
    const id = randomUUID();
    await pool.query(
        `INSERT INTO knowledge_spaces (id, scope_type, scope_id, created_by, name, deleted_at)
         VALUES ($1, 'user', $2, $2, 'jobcounts', CASE WHEN $3::boolean THEN NOW() ELSE NULL END)`,
        [id, OWNER, deleted],
    );
    spaceIds.push(id);
    return id;
}

/** 대기 작업 — run_after 를 먼 미래로 두어 다른 실 DB 파일의 claim 이 집지 않게 한다 */
async function insertQueuedJob(spaceId: string | null): Promise<void> {
    const id = randomUUID();
    await pool.query(
        `INSERT INTO knowledge_ingestion_jobs (id, kind, space_id, state, actor_kind, run_after)
         VALUES ($1, 'cleanup', $2, 'queued', 'system', NOW() + INTERVAL '1 day')`,
        [id, spaceId],
    );
    jobIds.push(id);
}

/** 실제 업로드 흐름의 수집 작업 — 문서+버전을 만들고 space_id 없이 document_version_id 만 둔다 */
async function insertQueuedIngestJob(spaceId: string): Promise<void> {
    const docId = randomUUID();
    const verId = randomUUID();
    await pool.query(
        `INSERT INTO knowledge_documents (id, space_id, logical_name, created_by) VALUES ($1, $2, 'jobcounts.txt', $3)`,
        [docId, spaceId, OWNER],
    );
    await pool.query(
        `INSERT INTO knowledge_document_versions (id, document_id, content_hash, mime_type, original_filename, storage_ref, source_size)
         VALUES ($1, $2, $3, 'text/plain', 'jobcounts.txt', 'unused', 100)`,
        [verId, docId, 'j'.repeat(64)],
    );
    const id = randomUUID();
    await pool.query(
        `INSERT INTO knowledge_ingestion_jobs (id, kind, document_version_id, state, actor_kind, run_after)
         VALUES ($1, 'ingest', $2, 'queued', 'system', NOW() + INTERVAL '1 day')`,
        [id, verId],
    );
    jobIds.push(id);
}

describeOrSkip('knowledge 관리자 상태 jobCounts (실 DB)', () => {
    let unlock: (() => Promise<void>) | undefined;
    beforeAll(async () => {
        unlock = await lockKnowledgeQueueTests(pool);
        await applyKnowledgeSchema(pool);
    }, KNOWLEDGE_DB_LOCK_HOOK_TIMEOUT_MS);
    afterAll(async () => {
        if (jobIds.length) await pool.query('DELETE FROM knowledge_ingestion_jobs WHERE id = ANY($1::text[])', [jobIds]);
        if (spaceIds.length) await pool.query('DELETE FROM knowledge_spaces WHERE id = ANY($1::text[])', [spaceIds]);
        await unlock?.();
        await pool.end();
    });

    it('미삭제 공간 작업·공간 없는 작업만 세고 삭제된 공간의 작업은 세지 않는다', async () => {
        const before = (await getAdminStatus(OWNER)).jobCounts.queued ?? 0;
        await insertQueuedJob(await insertSpace(false));
        await insertQueuedJob(await insertSpace(true));
        await insertQueuedJob(null);
        const after = (await getAdminStatus(OWNER)).jobCounts.queued ?? 0;
        expect(after - before).toBe(2);
    });

    it('space_id 없는 수집 작업은 문서의 공간으로 판정해 삭제된 공간이면 세지 않는다', async () => {
        const before = (await getAdminStatus(OWNER)).jobCounts.queued ?? 0;
        await insertQueuedIngestJob(await insertSpace(false));
        await insertQueuedIngestJob(await insertSpace(true));
        const after = (await getAdminStatus(OWNER)).jobCounts.queued ?? 0;
        expect(after - before).toBe(1);
    });
});
