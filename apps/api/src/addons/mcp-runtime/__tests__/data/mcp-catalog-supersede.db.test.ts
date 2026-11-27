/**
 * 카탈로그 이전 판 이관 (MCP-3) — 연결 필드가 이전 판 그대로인 행만 바꾸고, 관리자가 고친 행은 덮지 않는다(실제 Postgres).
 */
import { Pool } from 'pg';
import { mcpServerComponentStore } from '../../data/mcp-server-component-store';
import type { CatalogTemplateInstall } from '../../../../runtime-ports/component-stores';

const CONN = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const SUFFIX = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const describeOrSkip = CONN ? describe : describe.skip;

const V1 = 'https://example.test/v1/mcp';
const V2 = 'https://example.test/v2/mcp';

describeOrSkip('upgradeSupersededCatalogTemplate', () => {
    let pool: Pool;
    const ids = { untouched: `test-supersede-a-${SUFFIX}`, edited: `test-supersede-b-${SUFFIX}` };
    const template = (id: string): CatalogTemplateInstall => ({
        id, displayName: '정본 이름', description: '정본 설명', transportType: 'streamable-http', urlTemplate: V2,
        argsSchema: {}, envSchema: {}, defaultEnabled: false,
        supersedes: [{ transportType: 'streamable-http', urlTemplate: V1 }],
    });

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN });
        for (const [id, url] of [[ids.untouched, V1], [ids.edited, 'https://admin-proxy.test/mcp']]) {
            await pool.query(
                `INSERT INTO mcp_server_catalog (id, display_name, description, transport_type, url_template, is_enabled)
                 VALUES ($1, '관리자가 고친 이름', '관리자 설명', 'streamable-http', $2, TRUE)`, [id, url]);
        }
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM mcp_server_catalog WHERE id = ANY($1::text[])`, [Object.values(ids)]);
        await pool.end();
    });

    it('이전 판 그대로인 행은 연결 필드만 지금 판으로 — 이름·설명·켜짐은 관리자 값 유지', async () => {
        await expect(mcpServerComponentStore(pool).upgradeSupersededCatalogTemplate!(template(ids.untouched))).resolves.toBe(true);
        const r = await pool.query(`SELECT url_template, display_name, description, is_enabled FROM mcp_server_catalog WHERE id = $1`, [ids.untouched]);
        expect(r.rows[0]).toEqual({ url_template: V2, display_name: '관리자가 고친 이름', description: '관리자 설명', is_enabled: true });
    });

    it('관리자가 주소를 고친 행은 그대로 두고 false', async () => {
        await expect(mcpServerComponentStore(pool).upgradeSupersededCatalogTemplate!(template(ids.edited))).resolves.toBe(false);
        const r = await pool.query(`SELECT url_template FROM mcp_server_catalog WHERE id = $1`, [ids.edited]);
        expect(r.rows[0].url_template).toBe('https://admin-proxy.test/mcp');
    });

    it('이미 이관된 행에 다시 돌려도 바뀌지 않는다(멱등)', async () => {
        await expect(mcpServerComponentStore(pool).upgradeSupersededCatalogTemplate!(template(ids.untouched))).resolves.toBe(false);
    });

    it('없는 행(관리자가 지운 템플릿)은 되살리지 않는다', async () => {
        const gone = `test-supersede-gone-${SUFFIX}`;
        await expect(mcpServerComponentStore(pool).upgradeSupersededCatalogTemplate!(template(gone))).resolves.toBe(false);
        const r = await pool.query(`SELECT 1 FROM mcp_server_catalog WHERE id = $1`, [gone]);
        expect(r.rowCount).toBe(0);
    });
});
