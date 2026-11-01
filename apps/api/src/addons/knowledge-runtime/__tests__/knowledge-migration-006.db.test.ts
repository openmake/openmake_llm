// apps/api/src/addons/knowledge-runtime/__tests__/knowledge-migration-006.db.test.ts
/**
 * 006 마이그레이션 실 DB 검증 — TEST_DATABASE_URL 없으면 skip. 운영·로컬 본 DB 에 붙지 않는다.
 *  ① 색인이 비어 있는 공간은 지금 활성 색인으로 백필된다
 *  ② 활성이 아닌데 ready 로 남은 색인(옛 reindex 잔재)은 retired 로 바뀌고 벡터 행은 남는다
 *  ③ 같은 (provider_ref, dimension, distance_metric) 의 ready 색인은 둘일 수 없다(유니크)
 *  ④ 두 번째 적용은 오류 없이 아무 공간 행도 바꾸지 않는다(멱등 — xmin 불변)
 *  ⑤ 두 번째 적용은 공간이 가리키는 ready·비활성 색인(006 이후 코드가 만든 모양)을 retired 로 바꾸지 않는다
 *  ⑥ 두 번째 적용은 진행 중(queued·running) 공간 재색인 작업의 대상 색인도 지킨다(다시 적용해도 같은 결과)
 * 만든 행은 id 로만 지운다.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { applyKnowledgeSchema, KNOWLEDGE_DB_LOCK_HOOK_TIMEOUT_MS, lockKnowledgeQueueTests } from './helpers/db-serial';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;
const MIGRATION_006 = resolve(__dirname, '../../../../addons/builtin/knowledge-runtime/migrations/006_space_embedding_index.sql');

describeOrSkip('knowledge 마이그레이션 006 (실 DB)', () => {
    const pool = new Pool({ connectionString: CONN, max: 3 });
    const spaceIds = [`test-space-${randomUUID()}`, `test-space-${randomUUID()}`];
    const pinnedSpaceId = `test-space-${randomUUID()}`;
    const leftoverIndexId = `test-idx-${randomUUID()}`;
    const createdIndexIds: string[] = [leftoverIndexId];
    let activeIndexId = '';
    let unlock: (() => Promise<void>) | undefined;

    const insertIndex = (id: string, providerRef: string, status: string, isActive: boolean) => pool.query(
        `INSERT INTO knowledge_embedding_indexes (id, provider_ref, model_id, dimension, distance_metric, status, is_active)
         VALUES ($1, $2, 'm', 2, 'cosine', $3, $4)`,
        [id, providerRef, status, isActive],
    );

    beforeAll(async () => {
        unlock = await lockKnowledgeQueueTests(pool);
        await applyKnowledgeSchema(pool); // 006 포함(멱등) — 아래에서 006 이전 상태를 행으로 다시 만든다
        const active = await pool.query<{ id: string }>(`SELECT id FROM knowledge_embedding_indexes WHERE is_active = TRUE LIMIT 1`);
        if (active.rows[0]) {
            activeIndexId = active.rows[0].id;
        } else {
            activeIndexId = `test-idx-${randomUUID()}`;
            createdIndexIds.push(activeIndexId);
            await insertIndex(activeIndexId, `test-006-active-${randomUUID()}`, 'ready', true);
        }
        await insertIndex(leftoverIndexId, `test-006-leftover-${randomUUID()}`, 'ready', false);
        for (const id of spaceIds) {
            await pool.query(
                `INSERT INTO knowledge_spaces (id, scope_type, scope_id, created_by, name) VALUES ($1, 'user', 'u-006', 'u-006', '006 검증')`,
                [id],
            );
        }
    }, KNOWLEDGE_DB_LOCK_HOOK_TIMEOUT_MS);

    afterAll(async () => {
        await pool.query('DELETE FROM knowledge_spaces WHERE id = ANY($1::text[])', [[...spaceIds, pinnedSpaceId]]);
        await pool.query('DELETE FROM knowledge_embedding_indexes WHERE id = ANY($1::text[])', [createdIndexIds]);
        await unlock?.();
        await pool.end();
    });

    it('빈 공간은 활성 색인으로 백필되고, ready·비활성 잔재는 retired 가 된다', async () => {
        const before = await pool.query<{ embedding_index_id: string | null }>(
            'SELECT embedding_index_id FROM knowledge_spaces WHERE id = ANY($1::text[])', [spaceIds]);
        expect(before.rows.every((r) => r.embedding_index_id === null)).toBe(true);

        await pool.query(readFileSync(MIGRATION_006, 'utf8'));

        const spaces = await pool.query<{ embedding_index_id: string | null }>(
            'SELECT embedding_index_id FROM knowledge_spaces WHERE id = ANY($1::text[])', [spaceIds]);
        expect(spaces.rows.map((r) => r.embedding_index_id)).toEqual([activeIndexId, activeIndexId]);
        const leftover = await pool.query<{ status: string; retired_at: Date | null; request_params: unknown }>(
            'SELECT status, retired_at, request_params FROM knowledge_embedding_indexes WHERE id = $1', [leftoverIndexId]);
        expect(leftover.rows[0]).toMatchObject({ status: 'retired', request_params: {} });
        expect(leftover.rows[0].retired_at).not.toBeNull();
    });

    it('같은 모델·차원·척도의 ready 색인 두 번째 행은 유니크 위반이다', async () => {
        const ref = `test-006-dup-${randomUUID()}`;
        const first = `test-idx-${randomUUID()}`;
        const second = `test-idx-${randomUUID()}`;
        createdIndexIds.push(first, second);
        await insertIndex(first, ref, 'ready', false);
        await expect(insertIndex(second, ref, 'ready', false)).rejects.toMatchObject({ code: '23505' });
        // retired 는 유니크 밖 — 같은 모델의 옛 색인은 몇 개든 남는다
        await expect(insertIndex(second, ref, 'retired', false)).resolves.toBeDefined();
    });

    it('두 번째 적용은 오류 없이 공간 행을 바꾸지 않는다(xmin 불변)', async () => {
        const read = () => pool.query<{ id: string; xmin: string }>(
            'SELECT id, xmin::text AS xmin FROM knowledge_spaces WHERE id = ANY($1::text[]) ORDER BY id', [spaceIds]);
        const before = await read();
        await pool.query(readFileSync(MIGRATION_006, 'utf8'));
        const after = await read();
        expect(after.rows).toEqual(before.rows);
    });

    it('두 번째 적용은 공간이 가리키는 ready·비활성 색인을 retired 로 바꾸지 않는다', async () => {
        const pinned = `test-idx-${randomUUID()}`;
        const orphan = `test-idx-${randomUUID()}`;
        createdIndexIds.push(pinned, orphan);
        // 006 이후 코드가 만드는 색인은 ready·is_active FALSE — 하나는 공간이 가리키고, 하나는 아무도 가리키지 않는다
        await insertIndex(pinned, `test-006-pinned-${randomUUID()}`, 'ready', false);
        await insertIndex(orphan, `test-006-orphan-${randomUUID()}`, 'ready', false);
        await pool.query(
            `INSERT INTO knowledge_spaces (id, scope_type, scope_id, created_by, name, embedding_index_id) VALUES ($1, 'user', 'u-006', 'u-006', '006 고정', $2)`,
            [pinnedSpaceId, pinned],
        );
        await pool.query(readFileSync(MIGRATION_006, 'utf8'));
        const rows = await pool.query<{ id: string; status: string }>(
            'SELECT id, status FROM knowledge_embedding_indexes WHERE id = ANY($1::text[])', [[pinned, orphan]]);
        const status = Object.fromEntries(rows.rows.map((r) => [r.id, r.status]));
        expect(status[pinned]).toBe('ready');
        expect(status[orphan]).toBe('retired');
        const space = await pool.query<{ embedding_index_id: string }>('SELECT embedding_index_id FROM knowledge_spaces WHERE id = $1', [pinnedSpaceId]);
        expect(space.rows[0].embedding_index_id).toBe(pinned);
    });

    it('두 번째 적용은 진행 중 공간 재색인 작업의 대상 색인을 지키고, 끝난 작업·옛 전역 작업의 대상은 retired 로 바꾼다', async () => {
        const ids = {
            queued: `test-idx-${randomUUID()}`, running: `test-idx-${randomUUID()}`,
            done: `test-idx-${randomUUID()}`, legacy: `test-idx-${randomUUID()}`,
        };
        createdIndexIds.push(...Object.values(ids));
        // 대상 색인은 아직 어느 공간도 가리키지 않는다(전환 전). 작업은 먼 미래 run_after — 다른 worker 가 집지 않게
        const job = (indexId: string, state: string, spaceId: string | null) => pool.query(
            `INSERT INTO knowledge_ingestion_jobs (id, kind, space_id, embedding_index_id, state, actor_kind, run_after)
             VALUES ($1, 'reindex', $2, $3, $4, 'system', NOW() + INTERVAL '1 day')`,
            [randomUUID(), spaceId, indexId, state],
        );
        for (const [key, id] of Object.entries(ids)) await insertIndex(id, `test-006-job-${key}-${randomUUID()}`, 'ready', false);
        await job(ids.queued, 'queued', pinnedSpaceId);
        await job(ids.running, 'running', pinnedSpaceId);
        await job(ids.done, 'done', pinnedSpaceId);
        await job(ids.legacy, 'queued', null);

        await pool.query(readFileSync(MIGRATION_006, 'utf8'));
        const rows = await pool.query<{ id: string; status: string }>(
            'SELECT id, status FROM knowledge_embedding_indexes WHERE id = ANY($1::text[])', [Object.values(ids)]);
        const status = Object.fromEntries(rows.rows.map((r) => [r.id, r.status]));
        expect(status).toEqual({ [ids.queued]: 'ready', [ids.running]: 'ready', [ids.done]: 'retired', [ids.legacy]: 'retired' });

        // 세 번째 적용도 같은 결과(멱등)
        await pool.query(readFileSync(MIGRATION_006, 'utf8'));
        const again = await pool.query<{ id: string; status: string }>(
            'SELECT id, status FROM knowledge_embedding_indexes WHERE id = ANY($1::text[])', [Object.values(ids)]);
        expect(Object.fromEntries(again.rows.map((r) => [r.id, r.status]))).toEqual(status);
    });
});
