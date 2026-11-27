/**
 * McpNegotiationRepository(MCP-1) — 실제 Postgres. 팩 마이그레이션 SQL 을 직접 적용(멱등)한 뒤 검사한다.
 * upsert 누적·DB 에 없는 서버 건너뜀·서버 삭제 CASCADE·필터·소유자 조인.
 */
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { McpNegotiationRepository } from '../../data/mcp-negotiation-repository';
import type { McpNegotiationObservation } from '../../negotiation-observer';

const CONN = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const SUFFIX = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const UID = `test-negot-${SUFFIX}`;
const SID_USER = `mcp-negot-${SUFFIX}-u`;
const SID_GLOBAL = `mcp-negot-${SUFFIX}-g`;
const MIGRATION = path.resolve(__dirname, '../../../../../addons/builtin/mcp-runtime/migrations/001_mcp_negotiation_observations.sql');

const describeOrSkip = CONN ? describe : describe.skip;

function obs(serverId: string, over: Partial<McpNegotiationObservation> = {}): McpNegotiationObservation {
    return {
        serverId, transport: 'stdio', authMethod: 'none', protocolEra: 'legacy', protocolVersion: '2025-06-18',
        sdkGeneration: 'v1-compatible', capabilities: ['tools'], extensions: [{ id: 'io.modelcontextprotocol/apps', version: '0.3' }],
        serverName: 'demo', serverVersion: '1.0.0', ...over,
    };
}

describeOrSkip('McpNegotiationRepository', () => {
    let pool: Pool;
    let repo: McpNegotiationRepository;

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN });
        await pool.query(fs.readFileSync(MIGRATION, 'utf8'));
        await pool.query(fs.readFileSync(MIGRATION, 'utf8')); // 멱등
        repo = new McpNegotiationRepository(pool);
        await pool.query(`INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, 'h', 'user') ON CONFLICT DO NOTHING`, [UID, UID]);
        await pool.query(
            `INSERT INTO mcp_servers (id, name, transport_type, command, user_id, visibility, enabled)
             VALUES ($1, $2, 'stdio', '/bin/true', $3, 'user_private', FALSE) ON CONFLICT (id) DO NOTHING`,
            [SID_USER, `negot-${SUFFIX}-u`, UID],
        );
        await pool.query(
            `INSERT INTO mcp_servers (id, name, transport_type, url, enabled)
             VALUES ($1, $2, 'sse', 'https://example.invalid/sse', FALSE) ON CONFLICT (id) DO NOTHING`,
            [SID_GLOBAL, `negot-${SUFFIX}-g`],
        );
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM mcp_servers WHERE id = ANY($1)`, [[SID_USER, SID_GLOBAL]]);
        await pool.query(`DELETE FROM users WHERE id=$1`, [UID]);
        await pool.end();
    });

    test('upsert 는 서버당 1행 — 다시 기록하면 값 갱신·횟수 누적, first_observed_at 유지', async () => {
        await repo.upsert(obs(SID_USER));
        const [first] = (await repo.list()).filter(r => r.serverId === SID_USER);
        await repo.upsert(obs(SID_USER, { serverVersion: '2.0.0', capabilities: ['prompts', 'tools'] }));
        const rows = (await repo.list()).filter(r => r.serverId === SID_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            serverVersion: '2.0.0', capabilities: ['prompts', 'tools'], observationCount: 2,
            configuredName: `negot-${SUFFIX}-u`, userId: UID, extensions: [{ id: 'io.modelcontextprotocol/apps', version: '0.3' }],
        });
        expect(rows[0].firstObservedAt).toBe(first.firstObservedAt);
    });

    test('DB 에 없는 서버는 조용히 건너뛴다(FK 오류 없음)', async () => {
        await expect(repo.upsert(obs(`missing-${SUFFIX}`))).resolves.toBeUndefined();
        expect((await repo.list()).some(r => r.serverId === `missing-${SUFFIX}`)).toBe(false);
    });

    test('전송·세대 필터, 전역 서버는 userId null', async () => {
        await repo.upsert(obs(SID_GLOBAL, { transport: 'sse', protocolEra: 'modern', sdkGeneration: 'v2' }));
        const sse = await repo.list({ transport: 'sse', limit: 500 });
        const g = sse.find(r => r.serverId === SID_GLOBAL);
        expect(g?.userId).toBeNull();
        expect(sse.every(r => r.transport === 'sse')).toBe(true);
        const modern = await repo.list({ protocolEra: 'modern', limit: 500 });
        expect(modern.some(r => r.serverId === SID_USER)).toBe(false);
    });

    test('서버 행 삭제 시 관측도 지워진다(CASCADE)', async () => {
        await pool.query(`DELETE FROM mcp_servers WHERE id=$1`, [SID_USER]);
        const r = await pool.query(`SELECT 1 FROM mcp_negotiation_observations WHERE server_id=$1`, [SID_USER]);
        expect(r.rowCount).toBe(0);
    });
});
