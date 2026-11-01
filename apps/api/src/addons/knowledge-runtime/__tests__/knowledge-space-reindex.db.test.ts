/**
 * 공간 재색인 실 DB 검증(K01 복제본 전용) — TEST_DATABASE_URL 없으면 skip. 임베딩은 결정적 가짜 함수(네트워크 없음).
 *  - 공간 A 를 색인 X(8차원)→Y(4차원)로 옮기면 포인터가 Y 로 바뀌고, X 의 벡터는 그대로 남는다(보존)
 *  - 같은 색인 X 를 쓰는 공간 B 는 영향이 없다(포인터·벡터)
 *  - 전환 뒤 A 는 Y 로 검색되고, 다시 돌려도(이미 Y) 아무것도 바꾸지 않는다
 * 만든 행은 사용자·색인 접두어로만 지운다.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { applyKnowledgeSchema, KNOWLEDGE_DB_LOCK_HOOK_TIMEOUT_MS, lockKnowledgeQueueTests } from './helpers/db-serial';

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
jest.mock('../../../services/org/membership-cache', () => ({ activeOrgFor: jest.fn(async () => null) }));

import { ingestVersion } from '../ingestion/pipeline';
import { searchChunks } from '../retrieval/search';
import { runSpaceReindexJob } from '../embedding/space-reindex';
import { getSpaceIndex, type KnowledgeIndex } from '../embedding/index-catalog';
import { actorFor } from '../config/scope-policy';

const dbMock = jest.requireMock('../db') as { __pool: Pool };
const pool = dbMock.__pool;

const embedOf = (dim: number) => async (texts: string[]): Promise<number[][]> => texts.map(() => Array.from({ length: dim }, (_v, i) => (i === 0 ? 1 : 0)));
const user = `krtest-${randomUUID()}`;
const REF_PREFIX = `fake-rx-${randomUUID().slice(0, 8)}`;
const text = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa';

async function insertIndex(dim: number): Promise<KnowledgeIndex> {
    const id = randomUUID();
    const providerRef = `${REF_PREFIX}:embed-${dim}`;
    await pool.query(
        `INSERT INTO knowledge_embedding_indexes (id, provider_ref, model_id, dimension, distance_metric, status, is_active, activated_at)
         VALUES ($1, $2, 'fake', $3, 'cosine', 'ready', FALSE, NOW())`,
        [id, providerRef, dim],
    );
    return { id, providerRef, modelId: 'fake', dimension: dim, metric: 'cosine', status: 'ready', requestParams: {} };
}

async function spaceWithDoc(indexId: string, dim: number): Promise<{ spaceId: string; verId: string }> {
    const spaceId = randomUUID();
    const docId = randomUUID();
    const verId = randomUUID();
    await pool.query(
        `INSERT INTO knowledge_spaces (id, scope_type, scope_id, created_by, name, status, embedding_index_id) VALUES ($1, 'user', $2, $2, 'R', 'active', $3)`,
        [spaceId, user, indexId],
    );
    await pool.query(
        `INSERT INTO knowledge_documents (id, space_id, logical_name, status, created_by) VALUES ($1, $2, 'r.txt', 'processing', $3)`,
        [docId, spaceId, user],
    );
    await pool.query(
        `INSERT INTO knowledge_document_versions (id, document_id, content_hash, mime_type, original_filename, storage_ref, source_size, status)
         VALUES ($1, $2, $3, 'text/plain', 'r.txt', $1, 100, 'uploaded')`,
        [verId, docId, 'r'.repeat(64)],
    );
    const res = await ingestVersion(verId, { embed: embedOf(dim), actorUserId: user, readFile: async () => Buffer.from(text) });
    expect(res.status).toBe('ready');
    return { spaceId, verId };
}

const embeddingsIn = async (indexId: string, verId: string): Promise<number> => Number((await pool.query(
    `SELECT COUNT(*)::text AS n FROM knowledge_chunk_embeddings e JOIN knowledge_chunks c ON c.id = e.chunk_id
      WHERE c.document_version_id = $1 AND e.embedding_index_id = $2`, [verId, indexId])).rows[0].n);
const chunksOf = async (verId: string): Promise<number> => Number((await pool.query(
    `SELECT COUNT(*)::text AS n FROM knowledge_chunks WHERE document_version_id = $1`, [verId])).rows[0].n);

describeOrSkip('공간 재색인 실 DB (K01)', () => {
    let unlock: () => Promise<void>;

    beforeAll(async () => {
        unlock = await lockKnowledgeQueueTests(pool);
        await applyKnowledgeSchema(pool);
        await pool.query(
            `INSERT INTO users (id, username, password_hash, email, role, is_active) VALUES ($1, $1, 'x', $2, 'user', TRUE) ON CONFLICT (id) DO NOTHING`,
            [user, `${user}@test.local`],
        );
    }, KNOWLEDGE_DB_LOCK_HOOK_TIMEOUT_MS);

    afterAll(async () => {
        await pool.query(`DELETE FROM knowledge_spaces WHERE created_by = $1`, [user]);
        await pool.query(`DELETE FROM knowledge_embedding_indexes WHERE provider_ref LIKE $1`, [`${REF_PREFIX}:%`]);
        await pool.query(`DELETE FROM users WHERE id = $1`, [user]);
        await unlock();
        await pool.end();
    });

    it('A 를 X→Y 로 옮기면 포인터 전환·X 벡터 보존, 같은 X 의 공간 B 는 그대로', async () => {
        const X = await insertIndex(8);
        const Y = await insertIndex(4);
        const a = await spaceWithDoc(X.id, 8);
        const b = await spaceWithDoc(X.id, 8);
        const chunksA = await chunksOf(a.verId);
        expect(await embeddingsIn(X.id, a.verId)).toBe(chunksA);

        await runSpaceReindexJob({ spaceId: a.spaceId, indexId: Y.id, actorUserId: user }, { embed: embedOf(4) });

        expect((await getSpaceIndex(a.spaceId))?.id).toBe(Y.id);
        expect(await embeddingsIn(Y.id, a.verId)).toBe(chunksA);
        expect(await embeddingsIn(X.id, a.verId)).toBe(chunksA); // 옛 벡터 보존(정리는 후속 GC)
        expect((await getSpaceIndex(b.spaceId))?.id).toBe(X.id);
        expect(await embeddingsIn(Y.id, b.verId)).toBe(0);

        const actor = await actorFor(user);
        const [q4] = await embedOf(4)(['alpha']);
        expect((await searchChunks({ actor, spaceIds: [a.spaceId], queryVector: q4, candidateCount: 10, index: Y })).length).toBeGreaterThan(0);

        // 다시 돌려도(이미 Y) 바뀌는 것 없음
        await runSpaceReindexJob({ spaceId: a.spaceId, indexId: Y.id, actorUserId: user }, { embed: async () => { throw new Error('호출되면 안 된다'); } });
        expect((await getSpaceIndex(a.spaceId))?.id).toBe(Y.id);
    });
});
