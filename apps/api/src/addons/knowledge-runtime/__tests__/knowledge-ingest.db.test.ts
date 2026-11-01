/**
 * 수집·검색 실 DB 검증(K01 복제본 전용) — 운영(5432)에 절대 붙지 않는다. TEST_DATABASE_URL 없으면 skip.
 *
 * 임베딩은 결정적 가짜 함수를 주입한다(네트워크·모델 없음). 공간은 색인에 고정해 만든다(006). 검증:
 *  - 인가 우선 검색: 다른 사용자의 Space 는 결코 반환되지 않는다(0)
 *  - 삭제 문서는 검색되지 않는다
 *  - 부분 임베딩(ready 아님)은 검색되지 않는다
 *  - 재수집은 청크 중복 0
 *  - 게시 직전 공간 색인이 바뀌면 새 색인으로 다시 임베딩해 게시한다
 *  - 서로 다른 차원의 색인에 고정된 두 공간은 수집·검색이 섞이지 않는다
 * 공간 재색인(색인 전환)은 knowledge-space-reindex.db.test.ts.
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
import { retrieve } from '../retrieval/service';
import { getSpaceIndex, type KnowledgeIndex } from '../embedding/index-catalog';
import { actorFor } from '../config/scope-policy';

const dbMock = jest.requireMock('../db') as { __pool: Pool };
const pool = dbMock.__pool;

const DIM = 8;
/** 결정적 가짜 임베딩 — 방향이 같아 코사인 유사도 1(존재/부재 검증용) */
const embedOf = (dim: number) => async (texts: string[]): Promise<number[][]> => texts.map(() => Array.from({ length: dim }, (_v, i) => (i === 0 ? 1 : 0)));
const fakeEmbed = embedOf(DIM);

const userA = `kitest-${randomUUID()}`;
const userB = `kitest-${randomUUID()}`;
/** 이 파일이 만든 색인의 provider_ref 접두어 — 정리는 이 접두어로만 */
const REF_PREFIX = `fake-${randomUUID().slice(0, 8)}`;

async function insertUser(id: string): Promise<void> {
    await pool.query(
        `INSERT INTO users (id, username, password_hash, email, role, is_active) VALUES ($1, $1, 'x', $2, 'user', TRUE) ON CONFLICT (id) DO NOTHING`,
        [id, `${id}@test.local`],
    );
}

/** ready·비활성 색인 1행 — provider_ref 를 매번 달리해 ready 유니크와 겹치지 않게 한다 */
async function insertIndex(dim: number = DIM): Promise<KnowledgeIndex> {
    const id = randomUUID();
    const providerRef = `${REF_PREFIX}:embed-${id.slice(0, 8)}`;
    await pool.query(
        `INSERT INTO knowledge_embedding_indexes (id, provider_ref, model_id, dimension, distance_metric, status, is_active, activated_at)
         VALUES ($1, $2, 'fake', $3, 'cosine', 'ready', FALSE, NOW())`,
        [id, providerRef, dim],
    );
    return { id, providerRef, modelId: 'fake', dimension: dim, metric: 'cosine', status: 'ready', requestParams: {} };
}

async function makeSpace(owner: string, indexId: string): Promise<string> {
    const id = randomUUID();
    await pool.query(
        `INSERT INTO knowledge_spaces (id, scope_type, scope_id, created_by, name, status, embedding_index_id) VALUES ($1, 'user', $2, $2, 'S', 'active', $3)`,
        [id, owner, indexId],
    );
    return id;
}

/** uploaded 상태 문서+버전 삽입 — storage_ref 는 안 쓰인다(readFile 주입) */
async function makeVersion(spaceId: string, owner: string): Promise<{ docId: string; verId: string }> {
    const docId = randomUUID();
    const verId = randomUUID();
    await pool.query(
        `INSERT INTO knowledge_documents (id, space_id, logical_name, status, created_by) VALUES ($1, $2, 'f.txt', 'processing', $3)`,
        [docId, spaceId, owner],
    );
    await pool.query(
        `INSERT INTO knowledge_document_versions (id, document_id, content_hash, mime_type, original_filename, storage_ref, source_size, status)
         VALUES ($1, $2, $3, 'text/plain', 'f.txt', $1, 100, 'uploaded')`,
        [verId, docId, 'h'.repeat(64)],
    );
    return { docId, verId };
}

const text = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa';
/** 기본 ensureIndex(ensureSpaceIndex) 그대로 — 고정된 공간 색인을 읽는다 */
const ingestDeps = (body: string, embed = fakeEmbed) => ({ embed, actorUserId: userA, readFile: async () => Buffer.from(body) });

describeOrSkip('Knowledge 수집·검색 실 DB (K01)', () => {
    let index: KnowledgeIndex;
    let unlock: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        // 스키마 적용(006 포함)은 다른 실 DB 파일과 겹치지 않게 같은 lock 아래에서
        unlock = await lockKnowledgeQueueTests(pool);
        await applyKnowledgeSchema(pool);
        await insertUser(userA);
        await insertUser(userB);
        index = await insertIndex();
    }, KNOWLEDGE_DB_LOCK_HOOK_TIMEOUT_MS);

    afterAll(async () => {
        await pool.query(`DELETE FROM knowledge_spaces WHERE created_by = ANY($1::text[])`, [[userA, userB]]);
        await pool.query(`DELETE FROM knowledge_embedding_indexes WHERE provider_ref LIKE $1`, [`${REF_PREFIX}:%`]);
        await pool.query(`DELETE FROM users WHERE id = ANY($1::text[])`, [[userA, userB]]);
        await unlock?.();
        await pool.end();
    });

    it('수집 후 소유자는 검색되고, 다른 사용자는 그 Space 를 검색해도 0(인가 우선)', async () => {
        const spaceId = await makeSpace(userA, index.id);
        const { verId } = await makeVersion(spaceId, userA);
        const res = await ingestVersion(verId, ingestDeps(text));
        expect(res.status).toBe('ready');
        expect(res.chunkCount).toBeGreaterThan(0);

        const [qv] = await fakeEmbed(['alpha']);
        const hitsA = await searchChunks({ actor: await actorFor(userA), spaceIds: [spaceId], queryVector: qv, candidateCount: 10, index });
        expect(hitsA.length).toBeGreaterThan(0);

        // B 가 A 의 spaceId 를 그대로 넣어 검색해도 accessPredicate 가 SQL 에서 제외 → 0
        const hitsB = await searchChunks({ actor: await actorFor(userB), spaceIds: [spaceId], queryVector: qv, candidateCount: 10, index });
        expect(hitsB).toHaveLength(0);

        // retrieve 경로도 동일(공간 색인 조회는 실 DB)
        const rB = await retrieve({ actor: await actorFor(userB), spaceIds: [spaceId], query: 'alpha', sourceOffset: 0, userLang: 'en' }, { embed: fakeEmbed });
        expect(rB.hadEvidence).toBe(false);
        const rA = await retrieve({ actor: await actorFor(userA), spaceIds: [spaceId], query: 'alpha', sourceOffset: 0, userLang: 'en' }, { embed: fakeEmbed });
        expect(rA.hadEvidence).toBe(true);
    });

    it('삭제된 문서는 검색되지 않는다', async () => {
        const spaceId = await makeSpace(userA, index.id);
        const { docId, verId } = await makeVersion(spaceId, userA);
        await ingestVersion(verId, ingestDeps(text));
        const [qv] = await fakeEmbed(['alpha']);
        expect((await searchChunks({ actor: await actorFor(userA), spaceIds: [spaceId], queryVector: qv, candidateCount: 10, index })).length).toBeGreaterThan(0);

        await pool.query(`UPDATE knowledge_documents SET deleted_at = NOW() WHERE id = $1`, [docId]);
        expect(await searchChunks({ actor: await actorFor(userA), spaceIds: [spaceId], queryVector: qv, candidateCount: 10, index })).toHaveLength(0);
    });

    it('부분 임베딩(버전 ready 아님)은 검색되지 않는다', async () => {
        const spaceId = await makeSpace(userA, index.id);
        const { docId, verId } = await makeVersion(spaceId, userA);
        // 청크 1개 + 임베딩 1개를 넣되 버전은 embedding 단계(ready 아님)로 둔다
        const chunkId = randomUUID();
        await pool.query(
            `INSERT INTO knowledge_chunks (id, document_version_id, sequence, content, content_hash, token_count, char_start, char_end)
             VALUES ($1, $2, 0, 'partial', $3, 1, 0, 7)`, [chunkId, verId, 'c'.repeat(64)]);
        await pool.query(
            `INSERT INTO knowledge_chunk_embeddings (id, chunk_id, embedding_index_id, embedding) VALUES ($1, $2, $3, $4::vector)`,
            [randomUUID(), chunkId, index.id, `[${[1, 0, 0, 0, 0, 0, 0, 0].join(',')}]`]);
        await pool.query(`UPDATE knowledge_document_versions SET status = 'embedding' WHERE id = $1`, [verId]);
        await pool.query(`UPDATE knowledge_documents SET current_version_id = $2 WHERE id = $1`, [docId, verId]);

        const [qv] = await fakeEmbed(['partial']);
        expect(await searchChunks({ actor: await actorFor(userA), spaceIds: [spaceId], queryVector: qv, candidateCount: 10, index })).toHaveLength(0);
    });

    it('재수집은 청크 중복 0(UNIQUE(version, sequence))', async () => {
        const spaceId = await makeSpace(userA, index.id);
        const { verId } = await makeVersion(spaceId, userA);
        await ingestVersion(verId, ingestDeps(text));
        const first = Number((await pool.query(`SELECT COUNT(*)::text n FROM knowledge_chunks WHERE document_version_id = $1`, [verId])).rows[0].n);
        // 같은 버전 재수집 — 기존 청크를 지우고 다시 넣으므로 개수 동일, UNIQUE 위반 없음
        await ingestVersion(verId, ingestDeps(text));
        const second = Number((await pool.query(`SELECT COUNT(*)::text n FROM knowledge_chunks WHERE document_version_id = $1`, [verId])).rows[0].n);
        expect(second).toBe(first);
    });

    it('임베딩 직후 공간 색인이 바뀌면 옛 색인으로 게시하지 않고 새 색인으로 다시 임베딩해 게시한다', async () => {
        const oldIdx = await insertIndex();
        const newIdx = await insertIndex();
        const spaceId = await makeSpace(userA, oldIdx.id);
        const { verId } = await makeVersion(spaceId, userA);
        let calls = 0;
        // 첫 호출: 옛 색인을 돌려준 직후 공간 포인터가 새 색인으로 바뀐다(동시 공간 재색인 전환을 흉내). 두 번째부터는 실 조회
        const ensureIndex = async (sid: string): Promise<KnowledgeIndex> => {
            calls++;
            if (calls === 1) {
                await pool.query('UPDATE knowledge_spaces SET embedding_index_id = $2 WHERE id = $1', [sid, newIdx.id]);
                return oldIdx;
            }
            return (await getSpaceIndex(sid))!;
        };
        const res = await ingestVersion(verId, { embed: fakeEmbed, ensureIndex, actorUserId: userA, readFile: async () => Buffer.from(text) });
        expect(res.status).toBe('ready');
        expect(calls).toBe(2);
        const chunks = Number((await pool.query('SELECT COUNT(*) FROM knowledge_chunks WHERE document_version_id = $1', [verId])).rows[0].count);
        const inNew = Number((await pool.query(
            `SELECT COUNT(*) FROM knowledge_chunk_embeddings e JOIN knowledge_chunks c ON c.id = e.chunk_id
              WHERE c.document_version_id = $1 AND e.embedding_index_id = $2`, [verId, newIdx.id])).rows[0].count);
        expect(inNew).toBe(chunks);
    });

    it('서로 다른 차원의 색인에 고정된 두 공간은 수집·검색이 섞이지 않는다', async () => {
        const idx8 = await insertIndex(8);
        const idx4 = await insertIndex(4);
        const space8 = await makeSpace(userA, idx8.id);
        const space4 = await makeSpace(userA, idx4.id);
        const v8 = await makeVersion(space8, userA);
        const v4 = await makeVersion(space4, userA);
        const [r8, r4] = await Promise.all([
            ingestVersion(v8.verId, ingestDeps(text, embedOf(8))),
            ingestVersion(v4.verId, ingestDeps(text, embedOf(4))),
        ]);
        expect([r8.status, r4.status]).toEqual(['ready', 'ready']);

        const indexOfVersion = async (verId: string) => (await pool.query<{ embedding_index_id: string }>(
            `SELECT DISTINCT e.embedding_index_id FROM knowledge_chunk_embeddings e JOIN knowledge_chunks c ON c.id = e.chunk_id
              WHERE c.document_version_id = $1`, [verId])).rows.map((r) => r.embedding_index_id);
        expect(await indexOfVersion(v8.verId)).toEqual([idx8.id]);
        expect(await indexOfVersion(v4.verId)).toEqual([idx4.id]);

        const actor = await actorFor(userA);
        const [q8] = await embedOf(8)(['alpha']);
        const [q4] = await embedOf(4)(['alpha']);
        const hits8 = await searchChunks({ actor, spaceIds: [space8], queryVector: q8, candidateCount: 10, index: idx8 });
        const hits4 = await searchChunks({ actor, spaceIds: [space4], queryVector: q4, candidateCount: 10, index: idx4 });
        expect(hits8.length).toBeGreaterThan(0);
        expect(hits4.length).toBeGreaterThan(0);
        expect(hits8.every((h) => h.documentId === v8.docId)).toBe(true);
        expect(hits4.every((h) => h.documentId === v4.docId)).toBe(true);
        // 다른 색인으로 상대 공간을 검색하면 0(색인 조건)
        expect(await searchChunks({ actor, spaceIds: [space4], queryVector: q8, candidateCount: 10, index: idx8 })).toHaveLength(0);
    });
});
