/**
 * Migration 027 — mcp_servers status + manifest_meta.
 *
 * 사용자 결정: 메인 DB 직접 적용 (멱등). TEST_DATABASE_URL 미설정 시 DATABASE_URL fallback.
 */
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const CONN = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

const describeOrSkip = CONN ? describe : describe.skip;

describeOrSkip('Migration 027 — mcp_server_draft', () => {
    let pool: Pool;

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN });
        const sql = fs.readFileSync(
            path.resolve(__dirname, '../../../../../../db/migrations/027_mcp_server_draft.sql'),
            'utf8'
        );
        await pool.query(sql);
        // 멱등 — 2회 실행 시 에러 없음
        await pool.query(sql);
    });

    afterAll(async () => {
        await pool.end();
    });

    test('mcp_servers 에 status 컬럼 + 기본값 active', async () => {
        const r = await pool.query<{ column_default: string | null; data_type: string }>(
            `SELECT column_default, data_type
               FROM information_schema.columns
              WHERE table_name='mcp_servers' AND column_name='status'`
        );
        expect(r.rows).toHaveLength(1);
        expect(r.rows[0].data_type).toBe('text');
        expect(r.rows[0].column_default).toMatch(/'active'/);
    });

    test('status CHECK 제약이 draft/active/archived 만 허용', async () => {
        await expect(
            pool.query(
                `INSERT INTO mcp_servers (id, name, transport_type, status)
                 VALUES ('mcp-test-invalid-027', 'invalid-status-test-027', 'stdio', 'pending')`
            )
        ).rejects.toThrow(/check constraint/);
    });

    test('manifest_meta 가 JSONB nullable', async () => {
        const r = await pool.query<{ data_type: string; is_nullable: string }>(
            `SELECT data_type, is_nullable
               FROM information_schema.columns
              WHERE table_name='mcp_servers' AND column_name='manifest_meta'`
        );
        expect(r.rows).toHaveLength(1);
        expect(r.rows[0].data_type).toBe('jsonb');
        expect(r.rows[0].is_nullable).toBe('YES');
    });

    test('idx_mcp_servers_draft_user partial index 가 생성됨', async () => {
        const r = await pool.query<{ indexdef: string }>(
            `SELECT indexdef FROM pg_indexes
              WHERE tablename='mcp_servers' AND indexname='idx_mcp_servers_draft_user'`
        );
        expect(r.rows).toHaveLength(1);
        expect(r.rows[0].indexdef).toMatch(/WHERE.*status.*=.*'draft'/);
    });

    test('idx_mcp_servers_git_source_hash partial index 가 생성됨', async () => {
        const r = await pool.query<{ indexdef: string }>(
            `SELECT indexdef FROM pg_indexes
              WHERE tablename='mcp_servers' AND indexname='idx_mcp_servers_git_source_hash'`
        );
        expect(r.rows).toHaveLength(1);
        expect(r.rows[0].indexdef).toMatch(/promptHash/);
    });

    test('기존 row 가 status=active 로 자동 분류됨 (DEFAULT)', async () => {
        const id = 'mcp-test-pre-existing-027-' + Date.now().toString(36);
        await pool.query(
            `INSERT INTO mcp_servers (id, name, transport_type, command)
             VALUES ($1, $2, 'stdio', '/bin/true')
             ON CONFLICT (id) DO NOTHING`,
            [id, id]
        );
        try {
            const r = await pool.query<{ status: string }>(
                `SELECT status FROM mcp_servers WHERE id=$1`,
                [id]
            );
            expect(r.rows[0].status).toBe('active');
        } finally {
            await pool.query(`DELETE FROM mcp_servers WHERE id=$1`, [id]);
        }
    });
});
