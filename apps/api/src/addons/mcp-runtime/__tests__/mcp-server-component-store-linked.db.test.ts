/**
 * mcpServerComponentStore.listLinkedConnections (§8-3 미리보기) — 확장에 묶인 MCP 서버의 연결 설정 조회.
 * 보관(archived) 행은 빼고, 요청한 확장 id 의 행만, 인자 JSON 은 배열 그대로.
 */
import { Pool } from 'pg';
import { mcpServerComponentStore } from '../data/mcp-server-component-store';

const CONN = process.env.TEST_DATABASE_URL;
const SUFFIX = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const USER = `mcp-linked-${SUFFIX}`;
const EXT_A = `ext-a-${SUFFIX}`;
const EXT_B = `ext-b-${SUFFIX}`;
const EXT_C = `ext-c-${SUFFIX}`;

(CONN ? describe : describe.skip)('listLinkedConnections (DB)', () => {
    let pool: Pool;

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN });
        await pool.query(`INSERT INTO users (id, username, password_hash) VALUES ($1, $1, 'x')`, [USER]);
        for (const ext of [EXT_A, EXT_B, EXT_C]) {
            await pool.query(
                `INSERT INTO user_extensions (id, user_id, name, version, source_url, source_ref, source_path, source_hash, manifest)
                 VALUES ($1, $2, $1, '1.0.0', 'https://github.com/o/r', 'main', '', 'h', '{}'::jsonb)`,
                [ext, USER],
            );
        }
        const rows: Array<[string, string, string, string, string | null, string | null, string | null, string]> = [
            [`s1-${SUFFIX}`, EXT_A, 'b-stdio', 'stdio', 'npx', JSON.stringify(['-y', '@scope/pkg@1.0.0']), null, 'active'],
            [`s2-${SUFFIX}`, EXT_A, 'a-remote', 'streamable-http', null, null, 'https://mcp.example.com/v1', 'draft'],
            [`s3-${SUFFIX}`, EXT_A, 'c-archived', 'stdio', 'uvx', JSON.stringify(['x']), null, 'archived'],
            [`s4-${SUFFIX}`, EXT_B, 'other', 'stdio', 'npx', JSON.stringify(['y']), null, 'active'],
            [`s5-${SUFFIX}`, EXT_C, 'not-requested', 'stdio', 'npx', JSON.stringify(['z']), null, 'active'],
        ];
        for (const [id, ext, name, transport, command, args, url, status] of rows) {
            await pool.query(
                `INSERT INTO mcp_servers (id, name, transport_type, command, args, url, status, user_id, extension_id, visibility)
                 VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, 'user_private')`,
                [id, name, transport, command, args, url, status, USER, ext],
            );
        }
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM mcp_servers WHERE user_id = $1`, [USER]);
        await pool.query(`DELETE FROM user_extensions WHERE user_id = $1`, [USER]);
        await pool.query(`DELETE FROM users WHERE id = $1`, [USER]);
        await pool.end();
    });

    it('요청한 확장의 보관되지 않은 서버만, 확장·이름 순으로', async () => {
        const store = mcpServerComponentStore(pool);
        const got = await store.listLinkedConnections!([EXT_A, EXT_B]);
        expect(got).toEqual([
            { id: `s2-${SUFFIX}`, extensionId: EXT_A, name: 'a-remote', transport: 'streamable-http', command: null, args: null, url: 'https://mcp.example.com/v1' },
            { id: `s1-${SUFFIX}`, extensionId: EXT_A, name: 'b-stdio', transport: 'stdio', command: 'npx', args: ['-y', '@scope/pkg@1.0.0'], url: null },
            { id: `s4-${SUFFIX}`, extensionId: EXT_B, name: 'other', transport: 'stdio', command: 'npx', args: ['y'], url: null },
        ]);
    });

    it('빈 목록은 조회하지 않고 빈 결과', async () => {
        const store = mcpServerComponentStore(pool);
        expect(await store.listLinkedConnections!([])).toEqual([]);
    });
});
