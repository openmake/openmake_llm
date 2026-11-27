/**
 * 207 마이그레이션 + ExtensionCatalogRepository 동기화·자격증명 연산 실 DB 검증. 운영(5432)에 붙지 않는다 — TEST_DATABASE_URL 없으면 skip.
 *  - 새 컬럼은 NULL 기본(종전 행 무영향)
 *  - setCredential / setSubpath / recordSyncResult 라운드트립, 성공 기록은 사유를 지운다
 *  - alias UNIQUE · sync_status CHECK
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { ExtensionCatalogRepository, toPublicCatalogSource } from '../extension-catalog-repository';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN && !CONN.includes(':5432') ? describe : describe.skip;

describeOrSkip('extension_catalog_sources 동기화 컬럼 (실 DB)', () => {
    let pool: Pool;
    const tag = randomUUID().slice(0, 8);
    const urls = [`https://github.com/test-${tag}/a`, `https://github.com/test-${tag}/b`];

    beforeAll(() => { pool = new Pool({ connectionString: CONN, max: 2 }); });
    afterAll(async () => {
        await pool.query('DELETE FROM extension_catalog_sources WHERE url = ANY($1)', [urls]);
        await pool.end();
    });

    it('새 행은 새 컬럼이 전부 NULL(종전 동작)', async () => {
        const repo = new ExtensionCatalogRepository(pool);
        const row = await repo.insert({ url: urls[0], name: 'a', plugins: [], addedBy: null as unknown as string });
        expect(row).toMatchObject({ alias: null, credential_encrypted: null, source_subpath: null, index_url: null, sync_status: null, last_sync_error: null, last_sync_attempt_at: null });
        expect(toPublicCatalogSource(row).has_credential).toBe(false);
    });

    it('자격증명·하위 경로·동기화 결과 라운드트립', async () => {
        const repo = new ExtensionCatalogRepository(pool);
        const { id } = (await repo.findByUrl(urls[0]))!;
        expect(await repo.setCredential(id, 'v1:enc')).toBe(true);
        expect((await repo.setSubpath(id, 'plugins/x'))?.source_subpath).toBe('plugins/x');
        await repo.recordSyncResult(id, 'rate_limited', 'GITHUB_RATE_LIMITED');
        let row = (await repo.getById(id))!;
        expect(row).toMatchObject({ credential_encrypted: 'v1:enc', sync_status: 'rate_limited', last_sync_error: 'GITHUB_RATE_LIMITED' });
        expect(row.last_sync_attempt_at).toBeInstanceOf(Date);
        expect(toPublicCatalogSource(row)).not.toHaveProperty('credential_encrypted');
        await repo.recordSyncResult(id, 'ok', 'ignored');
        row = (await repo.getById(id))!;
        expect(row).toMatchObject({ sync_status: 'ok', last_sync_error: null });
        expect(await repo.setCredential(id, null)).toBe(true);
        expect((await repo.getById(id))!.credential_encrypted).toBeNull();
    });

    it('alias UNIQUE · sync_status CHECK', async () => {
        const repo = new ExtensionCatalogRepository(pool);
        const a = (await repo.findByUrl(urls[0]))!;
        const b = await repo.insert({ url: urls[1], name: 'b', plugins: [], addedBy: null as unknown as string });
        const alias = `al-${tag}`;
        await pool.query('UPDATE extension_catalog_sources SET alias=$1 WHERE id=$2', [alias, a.id]);
        await expect(pool.query('UPDATE extension_catalog_sources SET alias=$1 WHERE id=$2', [alias, b.id])).rejects.toThrow();
        await expect(pool.query("UPDATE extension_catalog_sources SET sync_status='bogus' WHERE id=$1", [b.id])).rejects.toThrow();
    });
});
