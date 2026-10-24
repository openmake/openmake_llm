// apps/api/src/addons/knowledge-runtime/__tests__/knowledge-migration-005.db.test.ts
/**
 * 005 마이그레이션 실 DB 검증 — TEST_DATABASE_URL 없으면 skip. 운영·로컬 본 DB 에 붙지 않는다.
 *  ① latin1 로 깨져 저장된 한글 이름(logical_name·original_filename)은 UTF-8 로 복원된다
 *  ② 정상 한글·ASCII·정상 latin1(café) 이름은 그대로다
 *  ③ 두 번째 적용은 아무 행도 고치지 않는다(멱등 — 행 xmin 불변)
 * 만든 행은 id 로만 지운다.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { applyKnowledgeSchema, KNOWLEDGE_DB_LOCK_HOOK_TIMEOUT_MS, lockKnowledgeQueueTests } from './helpers/db-serial';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;
const MIGRATION_005 = resolve(__dirname, '../../../../addons/builtin/knowledge-runtime/migrations/005_document_name_utf8_repair.sql');

/** busboy 가 UTF-8 파일명을 latin1 로 읽어 저장한 모양 */
const garble = (name: string): string => Buffer.from(name, 'utf8').toString('latin1');

const SEEDS = {
    broken: { stored: garble('벤처 보고서.pdf'), expected: '벤처 보고서.pdf' },
    korean: { stored: '정상 한글.pdf', expected: '정상 한글.pdf' },
    ascii: { stored: 'report-2026.txt', expected: 'report-2026.txt' },
    latin1: { stored: 'café.pdf', expected: 'café.pdf' },
} as const;
type SeedKey = keyof typeof SEEDS;

describeOrSkip('knowledge 마이그레이션 005 (실 DB)', () => {
    const pool = new Pool({ connectionString: CONN, max: 3 });
    const spaceId = `test-space-${randomUUID()}`;
    const docIds = {} as Record<SeedKey, string>;
    const versionIds = {} as Record<SeedKey, string>;
    let unlock: () => Promise<void>;

    const readRows = async () => {
        const docs = await pool.query<{ id: string; logical_name: string; xmin: string }>(
            'SELECT id, logical_name, xmin::text AS xmin FROM knowledge_documents WHERE id = ANY($1::text[])', [Object.values(docIds)]);
        const vers = await pool.query<{ id: string; original_filename: string; xmin: string }>(
            'SELECT id, original_filename, xmin::text AS xmin FROM knowledge_document_versions WHERE id = ANY($1::text[])', [Object.values(versionIds)]);
        return { docs: new Map(docs.rows.map(r => [r.id, r])), vers: new Map(vers.rows.map(r => [r.id, r])) };
    };

    beforeAll(async () => {
        unlock = await lockKnowledgeQueueTests(pool);
        await applyKnowledgeSchema(pool);
        await pool.query(
            `INSERT INTO knowledge_spaces (id, scope_type, scope_id, created_by, name) VALUES ($1, 'user', 'u-005', 'u-005', '005 검증')`,
            [spaceId],
        );
        for (const key of Object.keys(SEEDS) as SeedKey[]) {
            docIds[key] = `test-doc-${randomUUID()}`;
            versionIds[key] = `test-ver-${randomUUID()}`;
            await pool.query(
                `INSERT INTO knowledge_documents (id, space_id, logical_name, created_by) VALUES ($1, $2, $3, 'u-005')`,
                [docIds[key], spaceId, SEEDS[key].stored],
            );
            await pool.query(
                `INSERT INTO knowledge_document_versions (id, document_id, content_hash, mime_type, original_filename, storage_ref, source_size)
                 VALUES ($1, $2, $3, 'application/pdf', $4, 'test://005', 1)`,
                [versionIds[key], docIds[key], 'a'.repeat(64), SEEDS[key].stored],
            );
        }
    }, KNOWLEDGE_DB_LOCK_HOOK_TIMEOUT_MS);
    afterAll(async () => {
        await pool.query('DELETE FROM knowledge_document_versions WHERE id = ANY($1::text[])', [Object.values(versionIds)]);
        await pool.query('DELETE FROM knowledge_documents WHERE id = ANY($1::text[])', [Object.values(docIds)]);
        await pool.query('DELETE FROM knowledge_spaces WHERE id = $1', [spaceId]);
        await unlock();
        await pool.end();
    });

    it('깨진 한글 이름만 복원하고 정상 한글·ASCII·정상 latin1 이름은 그대로 둔다', async () => {
        expect(SEEDS.broken.stored).not.toBe(SEEDS.broken.expected); // 시드가 실제로 깨져 있다
        await pool.query(readFileSync(MIGRATION_005, 'utf8'));
        const { docs, vers } = await readRows();
        for (const key of Object.keys(SEEDS) as SeedKey[]) {
            expect({ key, name: docs.get(docIds[key])?.logical_name }).toEqual({ key, name: SEEDS[key].expected });
            expect({ key, name: vers.get(versionIds[key])?.original_filename }).toEqual({ key, name: SEEDS[key].expected });
        }
    });

    it('두 번째 적용은 변경 0건이다(행 xmin 불변)', async () => {
        const before = await readRows();
        await pool.query(readFileSync(MIGRATION_005, 'utf8'));
        const after = await readRows();
        for (const key of Object.keys(SEEDS) as SeedKey[]) {
            expect({ key, xmin: after.docs.get(docIds[key])?.xmin }).toEqual({ key, xmin: before.docs.get(docIds[key])?.xmin });
            expect({ key, xmin: after.vers.get(versionIds[key])?.xmin }).toEqual({ key, xmin: before.vers.get(versionIds[key])?.xmin });
            expect(after.docs.get(docIds[key])?.logical_name).toBe(SEEDS[key].expected);
        }
    });
});
