/**
 * 수집·검색 실 DB 검증(K01 복제본 전용) — 운영(5432)에 절대 붙지 않는다. TEST_DATABASE_URL 없으면 skip.
 *
 * 임베딩은 결정적 가짜 함수를 주입한다(네트워크·모델 없음). 검증:
 *  - 인가 우선 검색: 다른 사용자의 Space 는 결코 반환되지 않는다(0)
 *  - 삭제 문서는 검색되지 않는다
 *  - 부분 임베딩(ready 아님)은 검색되지 않는다
 *  - 재수집은 청크 중복 0
 *  - reindex 는 원자적으로 활성 index 를 교체한다
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

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
import { getActiveIndex, runReindexJob, type KnowledgeIndex } from '../embedding/index-manager';
import { actorFor } from '../config/scope-policy';

const dbMock = jest.requireMock('../db') as { __pool: Pool };
const pool = dbMock.__pool;

const DIM = 8;
/** 결정적 가짜 임베딩 — 방향이 같아 코사인 유사도 1(존재/부재 검증용) */
const fakeEmbed = async (texts: string[]): Promise<number[][]> => texts.map(() => [1, 0, 0, 0, 0, 0, 0, 0]);

const userA = `kitest-${randomUUID()}`;
const userB = `kitest-${randomUUID()}`;
let indexId: string;
let indexObj: KnowledgeIndex;

async function insertUser(id: string): Promise<void> {
    await pool.query(
        `INSERT INTO users (id, username, password_hash, email, role, is_active) VALUES ($1, $1, 'x', $2, 'user', TRUE) ON CONFLICT (id) DO NOTHING`,
        [id, `${id}@test.local`],
    );
}

/** 이미 활성인 index(평가 하네스·실사용이 만든 것)가 있으면 잠시 비활성화했다가 끝나면 되돌린다 — 활성은 하나뿐(유니크) */
let displacedActiveIndexId: string | null = null;

async function insertActiveIndex(): Promise<void> {
    const prev = await pool.query<{ id: string }>('SELECT id FROM knowledge_embedding_indexes WHERE is_active');
    displacedActiveIndexId = prev.rows[0]?.id ?? null;
    if (displacedActiveIndexId) await pool.query('UPDATE knowledge_embedding_indexes SET is_active = FALSE WHERE id = $1', [displacedActiveIndexId]);
    indexId = randomUUID();
    await pool.query(
        `INSERT INTO knowledge_embedding_indexes (id, provider_ref, model_id, dimension, distance_metric, status, is_active, activated_at)
         VALUES ($1, 'fake:embed', 'fake', $2, 'cosine', 'ready', TRUE, NOW())`,
        [indexId, DIM],
    );
    indexObj = { id: indexId, providerRef: 'fake:embed', modelId: 'fake', dimension: DIM, metric: 'cosine', status: 'ready', isActive: true };
}

async function makeSpace(owner: string): Promise<string> {
    const id = randomUUID();
    await pool.query(
        `INSERT INTO knowledge_spaces (id, scope_type, scope_id, created_by, name, status) VALUES ($1, 'user', $2, $2, 'S', 'active')`,
        [id, owner],
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
const ingestDeps = (text: string) => ({ embed: fakeEmbed, ensureIndex: async () => indexObj, readFile: async () => Buffer.from(text) });

describeOrSkip('Knowledge 수집·검색 실 DB (K01)', () => {
    beforeAll(async () => {
        await insertUser(userA);
        await insertUser(userB);
        await insertActiveIndex();
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM knowledge_spaces WHERE created_by = ANY($1::text[])`, [[userA, userB]]);
        await pool.query(`DELETE FROM knowledge_embedding_indexes WHERE provider_ref = 'fake:embed'`);
        if (displacedActiveIndexId) await pool.query('UPDATE knowledge_embedding_indexes SET is_active = TRUE WHERE id = $1', [displacedActiveIndexId]);
        await pool.query(`DELETE FROM users WHERE id = ANY($1::text[])`, [[userA, userB]]);
        await pool.end();
    });

    it('수집 후 소유자는 검색되고, 다른 사용자는 그 Space 를 검색해도 0(인가 우선)', async () => {
        const spaceId = await makeSpace(userA);
        const { verId } = await makeVersion(spaceId, userA);
        const res = await ingestVersion(verId, ingestDeps(text));
        expect(res.status).toBe('ready');
        expect(res.chunkCount).toBeGreaterThan(0);

        const [qv] = await fakeEmbed(['alpha']);
        const hitsA = await searchChunks({ actor: await actorFor(userA), spaceIds: [spaceId], queryVector: qv, candidateCount: 10, index: indexObj });
        expect(hitsA.length).toBeGreaterThan(0);

        // B 가 A 의 spaceId 를 그대로 넣어 검색해도 accessPredicate 가 SQL 에서 제외 → 0
        const hitsB = await searchChunks({ actor: await actorFor(userB), spaceIds: [spaceId], queryVector: qv, candidateCount: 10, index: indexObj });
        expect(hitsB).toHaveLength(0);

        // retrieve 경로도 동일
        const rB = await retrieve({ actor: await actorFor(userB), spaceIds: [spaceId], query: 'alpha', sourceOffset: 0, userLang: 'en' },
            { embed: fakeEmbed, getActiveIndex: async () => indexObj });
        expect(rB.hadEvidence).toBe(false);
    });

    it('삭제된 문서는 검색되지 않는다', async () => {
        const spaceId = await makeSpace(userA);
        const { docId, verId } = await makeVersion(spaceId, userA);
        await ingestVersion(verId, ingestDeps(text));
        const [qv] = await fakeEmbed(['alpha']);
        expect((await searchChunks({ actor: await actorFor(userA), spaceIds: [spaceId], queryVector: qv, candidateCount: 10, index: indexObj })).length).toBeGreaterThan(0);

        await pool.query(`UPDATE knowledge_documents SET deleted_at = NOW() WHERE id = $1`, [docId]);
        expect(await searchChunks({ actor: await actorFor(userA), spaceIds: [spaceId], queryVector: qv, candidateCount: 10, index: indexObj })).toHaveLength(0);
    });

    it('부분 임베딩(버전 ready 아님)은 검색되지 않는다', async () => {
        const spaceId = await makeSpace(userA);
        const { docId, verId } = await makeVersion(spaceId, userA);
        // 청크 1개 + 임베딩 1개를 넣되 버전은 embedding 단계(ready 아님)로 둔다
        const chunkId = randomUUID();
        await pool.query(
            `INSERT INTO knowledge_chunks (id, document_version_id, sequence, content, content_hash, token_count, char_start, char_end)
             VALUES ($1, $2, 0, 'partial', $3, 1, 0, 7)`, [chunkId, verId, 'c'.repeat(64)]);
        await pool.query(
            `INSERT INTO knowledge_chunk_embeddings (id, chunk_id, embedding_index_id, embedding) VALUES ($1, $2, $3, $4::vector)`,
            [randomUUID(), chunkId, indexId, `[${[1, 0, 0, 0, 0, 0, 0, 0].join(',')}]`]);
        await pool.query(`UPDATE knowledge_document_versions SET status = 'embedding' WHERE id = $1`, [verId]);
        await pool.query(`UPDATE knowledge_documents SET current_version_id = $2 WHERE id = $1`, [docId, verId]);

        const [qv] = await fakeEmbed(['partial']);
        expect(await searchChunks({ actor: await actorFor(userA), spaceIds: [spaceId], queryVector: qv, candidateCount: 10, index: indexObj })).toHaveLength(0);
    });

    it('재수집은 청크 중복 0(UNIQUE(version, sequence))', async () => {
        const spaceId = await makeSpace(userA);
        const { verId } = await makeVersion(spaceId, userA);
        await ingestVersion(verId, ingestDeps(text));
        const first = Number((await pool.query(`SELECT COUNT(*)::text n FROM knowledge_chunks WHERE document_version_id = $1`, [verId])).rows[0].n);
        // 같은 버전 재수집 — 기존 청크를 지우고 다시 넣으므로 개수 동일, UNIQUE 위반 없음
        await ingestVersion(verId, ingestDeps(text));
        const second = Number((await pool.query(`SELECT COUNT(*)::text n FROM knowledge_chunks WHERE document_version_id = $1`, [verId])).rows[0].n);
        expect(second).toBe(first);
    });

    it('reindex 는 활성 index 를 원자적으로 교체한다', async () => {
        const spaceId = await makeSpace(userA);
        const { verId } = await makeVersion(spaceId, userA);
        await ingestVersion(verId, ingestDeps(text));

        // building index 를 직접 만들고 reindex 실행(가짜 embed)
        const newIndexId = randomUUID();
        await pool.query(
            `INSERT INTO knowledge_embedding_indexes (id, provider_ref, model_id, dimension, distance_metric, status, is_active)
             VALUES ($1, 'fake:embed', 'fake', $2, 'cosine', 'building', FALSE)`, [newIndexId, DIM]);
        await runReindexJob(newIndexId, { embed: fakeEmbed });

        const active = await getActiveIndex();
        expect(active?.id).toBe(newIndexId);
        const old = (await pool.query(`SELECT status, is_active FROM knowledge_embedding_indexes WHERE id = $1`, [indexId])).rows[0];
        expect(old.is_active).toBe(false);
        expect(old.status).toBe('retired');

        // 새 index 로도 검색된다
        const [qv] = await fakeEmbed(['alpha']);
        const hits = await searchChunks({ actor: await actorFor(userA), spaceIds: [spaceId], queryVector: qv, candidateCount: 10, index: active! });
        expect(hits.length).toBeGreaterThan(0);
    });
});
