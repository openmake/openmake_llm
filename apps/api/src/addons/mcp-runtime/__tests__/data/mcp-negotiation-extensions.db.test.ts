/**
 * McpNegotiationRepository 선언 확장 조회(MCP-5) — 실제 Postgres.
 * 서버별 조회는 선언한 서버만, 카탈로그 조회는 같은 템플릿 설치 서버들의 합집합(id 중복 제거).
 */
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { McpNegotiationRepository } from '../../data/mcp-negotiation-repository';
import type { McpNegotiationObservation } from '../../negotiation-observer';

const CONN = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const SUFFIX = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const TPL = `tpl-ext-${SUFFIX}`;
const S_A = `mcp-ext-${SUFFIX}-a`;
const S_B = `mcp-ext-${SUFFIX}-b`;
const S_NONE = `mcp-ext-${SUFFIX}-n`;
const MIGRATION = path.resolve(__dirname, '../../../../../addons/builtin/mcp-runtime/migrations/001_mcp_negotiation_observations.sql');

const describeOrSkip = CONN ? describe : describe.skip;

function obs(serverId: string, extensions: McpNegotiationObservation['extensions']): McpNegotiationObservation {
    return {
        serverId, transport: 'streamable-http', authMethod: 'none', protocolEra: 'legacy', protocolVersion: '2025-11-25',
        sdkGeneration: 'v1-compatible', capabilities: ['tools'], extensions, serverName: 'x', serverVersion: '1',
    };
}

describeOrSkip('McpNegotiationRepository — 선언 확장 조회', () => {
    let pool: Pool;
    let repo: McpNegotiationRepository;

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN });
        await pool.query(fs.readFileSync(MIGRATION, 'utf8'));
        repo = new McpNegotiationRepository(pool);
        for (const id of [S_A, S_B, S_NONE]) {
            await pool.query(
                `INSERT INTO mcp_servers (id, name, transport_type, url, enabled, catalog_template_id)
                 VALUES ($1, $1, 'streamable-http', 'https://example.invalid/mcp', FALSE, $2) ON CONFLICT (id) DO NOTHING`,
                [id, TPL],
            );
        }
        await repo.upsert(obs(S_A, [{ id: 'io.modelcontextprotocol/ui', version: '1' }]));
        await repo.upsert(obs(S_B, [{ id: 'io.modelcontextprotocol/ui', version: '2' }, { id: 'io.modelcontextprotocol/skills' }]));
        await repo.upsert(obs(S_NONE, []));
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM mcp_servers WHERE id = ANY($1)`, [[S_A, S_B, S_NONE]]);
        await pool.end();
    });

    test('서버별 — 선언한 서버만 맵에 있고 미선언 서버는 없다', async () => {
        const m = await repo.extensionsByServerIds([S_A, S_NONE, `missing-${SUFFIX}`]);
        expect([...m.keys()]).toEqual([S_A]);
        expect(m.get(S_A)).toEqual([{ id: 'io.modelcontextprotocol/ui', version: '1' }]);
        expect((await repo.extensionsByServerIds([])).size).toBe(0);
    });

    test('카탈로그별 — 같은 템플릿 서버들의 합집합, 같은 id 는 최근 관측 하나', async () => {
        const m = await repo.extensionsByCatalogTemplateIds([TPL, `none-${SUFFIX}`]);
        expect([...m.keys()]).toEqual([TPL]);
        const ids = (m.get(TPL) ?? []).map(e => e.id).sort();
        expect(ids).toEqual(['io.modelcontextprotocol/skills', 'io.modelcontextprotocol/ui']);
        expect(m.get(TPL)?.find(e => e.id === 'io.modelcontextprotocol/ui')?.version).toBe('2'); // S_B 가 나중 관측
    });
});
