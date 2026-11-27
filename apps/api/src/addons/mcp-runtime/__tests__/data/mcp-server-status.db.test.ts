/**
 * McpCatalogRepository.getServerStatus — 승인 전 연결 차단(원격 관리 등록 opt-in)이 읽는 상태. 실제 Postgres(TEMP 표).
 * TEST_DATABASE_URL 이 없으면 skip. getServerById 의 응답 모양은 바꾸지 않는다(status 를 싣지 않는다).
 */
import { Pool, type PoolClient } from 'pg';
import { McpCatalogRepository } from '../../data/mcp-catalog-repository';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;

describeOrSkip('McpCatalogRepository.getServerStatus (TEMP 표)', () => {
    let pool: Pool;
    let client: PoolClient;
    let repo: McpCatalogRepository;

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN, max: 1 });
        client = await pool.connect();
        await client.query(`CREATE TEMP TABLE mcp_servers (
            id TEXT PRIMARY KEY, user_id TEXT, name TEXT NOT NULL, transport_type TEXT NOT NULL, command TEXT, args JSONB, env JSONB,
            url TEXT, visibility TEXT NOT NULL DEFAULT 'user_private', catalog_template_id TEXT, auto_spawn BOOLEAN NOT NULL DEFAULT FALSE,
            enabled BOOLEAN NOT NULL DEFAULT FALSE, sandbox_network TEXT, sandbox_bridge_allowed BOOLEAN, status TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await client.query(`INSERT INTO mcp_servers (id, user_id, name, transport_type, url, status) VALUES
            ('s-draft', 'u1', 'a', 'streamable-http', 'https://mcp.example.com/mcp', 'draft'),
            ('s-active', 'u1', 'b', 'streamable-http', 'https://mcp.example.com/mcp', 'active'),
            ('s-legacy', 'u1', 'c', 'stdio', NULL, NULL)`);
        repo = new McpCatalogRepository(client as unknown as Pool);
    });
    afterAll(async () => { client?.release(true); await pool?.end(); });

    it('상태를 그대로 읽고, NULL(상태 컬럼 이전 행)은 active, 없으면 null', async () => {
        expect(await repo.getServerStatus('s-draft')).toBe('draft');
        expect(await repo.getServerStatus('s-active')).toBe('active');
        expect(await repo.getServerStatus('s-legacy')).toBe('active');
        expect(await repo.getServerStatus('nope')).toBeNull();
    });

    it('getServerById 응답에는 status 가 없다(종전 모양)', async () => {
        const row = await repo.getServerById('s-draft');
        expect(row).not.toBeNull();
        expect(row).not.toHaveProperty('status');
    });
});
