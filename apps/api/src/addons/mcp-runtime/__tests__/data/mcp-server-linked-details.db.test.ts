/**
 * MCP 구성요소 저장 연산 listLinkedDetails(M3) — 실제 Postgres(TEMP 표, TEST_DATABASE_URL 없으면 skip).
 */
import { Pool, type PoolClient } from 'pg';
import { mcpServerComponentStore } from '../../data/mcp-server-component-store';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;

describeOrSkip('listLinkedDetails — 실제 Postgres(TEMP 표)', () => {
    let pool: Pool;
    let client: PoolClient;
    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN, max: 1 });
        client = await pool.connect();
        await client.query(`CREATE TEMP TABLE mcp_servers (
            id TEXT PRIMARY KEY, extension_id TEXT, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
            enabled BOOLEAN NOT NULL DEFAULT FALSE, transport_type TEXT NOT NULL)`);
        await client.query(`CREATE TEMP TABLE mcp_negotiation_observations (
            server_id TEXT PRIMARY KEY, auth_method TEXT NOT NULL, protocol_era TEXT, protocol_version TEXT,
            sdk_generation TEXT NOT NULL, observed_at TIMESTAMPTZ NOT NULL)`);
        await client.query(`INSERT INTO mcp_servers VALUES ('m1', 'e1', 'srv-1', 'active', TRUE, 'sse'), ('m2', 'e1', 'srv-2', 'draft', FALSE, 'stdio'), ('m3', 'e9', 'other', 'active', TRUE, 'stdio')`);
        await client.query(`INSERT INTO mcp_negotiation_observations VALUES ('m1', 'oauth-dynamic', 'legacy', '2025-11-25', 'v1-compatible', '2026-11-27T04:00:00Z')`);
    });
    afterAll(async () => { client?.release(true); await pool?.end(); });

    it('확장별 서버 + 관측(LEFT JOIN — 관측 없는 서버는 null), 다른 확장은 빠진다', async () => {
        const d = await mcpServerComponentStore(client).listLinkedDetails!(['e1']);
        expect(d).toEqual([
            { id: 'm1', extensionId: 'e1', name: 'srv-1', status: 'active', enabled: true, transport: 'sse',
                negotiation: { authMethod: 'oauth-dynamic', protocolEra: 'legacy', protocolVersion: '2025-11-25', sdkGeneration: 'v1-compatible', observedAt: '2026-11-27T04:00:00.000Z' } },
            { id: 'm2', extensionId: 'e1', name: 'srv-2', status: 'draft', enabled: false, transport: 'stdio', negotiation: null },
        ]);
    });
});
