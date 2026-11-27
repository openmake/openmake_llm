/**
 * 팩 마이그레이션 addon:extension-marketplace:001 + 판정 캐시 저장소 + Base 카탈로그 조회 — 실 DB(TEST_DATABASE_URL 없으면 skip).
 *  ① 001 은 멱등(두 번 적용) ② upsert·list·deleteMissing ③ 판정 CHECK 제약 ④ 카탈로그 원본 삭제 시 CASCADE
 *  ⑤ Base 조회: 원본별·이름별 최신 active 설치본만(removed 제외)
 * 만든 행은 id 로만 지운다.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;
const pool = CONN ? new Pool({ connectionString: CONN, max: 3 }) : (null as unknown as Pool);
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => pool }));

import { VerdictRepository } from '../verdict-repository';
import { getCatalogSourceRow, listInstalledExtensionsBySources } from '../../../data/extension-catalog-lookup';

const MIGRATION_001 = resolve(__dirname, '../../../../addons/builtin/extension-marketplace/migrations/001_market_verdicts.sql');

describeOrSkip('market_verdicts (실 DB)', () => {
    const catalogId = `ext-cat-test-${randomUUID()}`;
    const catalogUrl = `https://github.com/test-${randomUUID()}/market`;
    const userId = `test-user-${randomUUID()}`;
    const extIds: string[] = [];

    beforeAll(async () => {
        const sql = readFileSync(MIGRATION_001, 'utf8');
        await pool.query(sql);
        await pool.query(sql);   // 멱등
        await pool.query(
            `INSERT INTO extension_catalog_sources (id, url, name, plugins) VALUES ($1, $2, 'test', $3::jsonb)`,
            [catalogId, catalogUrl, JSON.stringify([{ name: 'alpha', installable: true }])],
        );
        await pool.query(`INSERT INTO users (id, username, password_hash) VALUES ($1, $1, 'x')`, [userId]);
        const ins = async (name: string, ref: string, status: string, updatedAt: string) => {
            const id = `user-ext-test-${randomUUID()}`;
            extIds.push(id);
            await pool.query(
                `INSERT INTO user_extensions (id, user_id, name, version, source_url, source_ref, source_path, source_hash, manifest, status, updated_at)
                 VALUES ($1, $2, $3, '1.0.0', $4, $5, '', $6, '{}'::jsonb, $7, $8)`,
                [id, userId, name, catalogUrl, ref, randomUUID(), status, updatedAt],
            );
        };
        await ins('alpha', 'old-sha', 'removed', '2026-11-01T00:00:00Z');
        await ins('alpha', 'new-sha', 'active', '2026-11-20T00:00:00Z');
    });
    afterAll(async () => {
        await pool.query('DELETE FROM user_extensions WHERE id = ANY($1::text[])', [extIds]);
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        await pool.query('DELETE FROM extension_catalog_sources WHERE id = $1', [catalogId]);
        await pool.end();
    });

    it('Base 조회 — 원본 스냅샷, 이름별 최신 active 설치본(removed 제외)', async () => {
        expect(await getCatalogSourceRow(catalogId)).toMatchObject({ id: catalogId, url: catalogUrl, enabled: true });
        const rows = await listInstalledExtensionsBySources([catalogUrl]);
        expect(rows.map(r => [r.name, r.source_ref])).toEqual([['alpha', 'new-sha']]);
        expect(Object.keys(rows[0])).not.toContain('user_id');
    });

    it('upsert·list·deleteMissing', async () => {
        const repo = new VerdictRepository(pool);
        const v = (plugin: string, verdict: 'supported' | 'partial') => ({
            plugin, verdict, evaluated: 'snapshot' as const,
            reasons: [{ code: 'CONTENT_NOT_EVALUATED' as const, severity: 'info' as const, count: 0 }],
            provenance: { publisher: 'test', commit: null, license: null, sourceUrl: catalogUrl },
        });
        const meta = { verdictVersion: 1, catalogSyncedAt: '2026-11-27T00:00:00.000Z', expiresAt: new Date('2026-11-28T00:00:00Z') };
        await repo.upsertMany(catalogId, [v('alpha', 'supported'), v('gone', 'partial')], meta);
        await repo.upsertMany(catalogId, [v('alpha', 'partial')], { ...meta, verdictVersion: 2 });
        let list = await repo.listByCatalog(catalogId);
        expect(list.map(c => [c.plugin, c.verdict, c.verdictVersion]).sort()).toEqual([['alpha', 'partial', 2], ['gone', 'partial', 1]]);
        expect(list[0].reasons[0].code).toBe('CONTENT_NOT_EVALUATED');
        await repo.deleteMissing(catalogId, ['alpha']);
        list = await repo.listByCatalog(catalogId);
        expect(list.map(c => c.plugin)).toEqual(['alpha']);
        expect(Date.parse(list[0].catalogSyncedAt!)).toBe(Date.parse(meta.catalogSyncedAt));
    });

    it('판정 값은 세 가지뿐(CHECK)', async () => {
        await expect(pool.query(
            `INSERT INTO market_verdicts (catalog_id, plugin_name, source_url, verdict, evaluated, verdict_version, expires_at)
             VALUES ($1, 'bad', 'u', 'great', 'snapshot', 1, NOW())`, [catalogId],
        )).rejects.toThrow();
    });

    it('카탈로그 원본을 지우면 판정도 지워진다(CASCADE)', async () => {
        const tmp = `ext-cat-test-${randomUUID()}`;
        await pool.query(`INSERT INTO extension_catalog_sources (id, url, name, plugins) VALUES ($1, $2, 'tmp', '[]'::jsonb)`, [tmp, `https://github.com/tmp/${tmp}`]);
        await new VerdictRepository(pool).upsertMany(tmp, [{
            plugin: 'x', verdict: 'supported', evaluated: 'snapshot', reasons: [],
            provenance: { publisher: null, commit: null, license: null, sourceUrl: 'u' },
        }], { verdictVersion: 1, catalogSyncedAt: null, expiresAt: new Date() });
        await pool.query('DELETE FROM extension_catalog_sources WHERE id = $1', [tmp]);
        const r = await pool.query('SELECT 1 FROM market_verdicts WHERE catalog_id = $1', [tmp]);
        expect(r.rowCount).toBe(0);
    });
});
