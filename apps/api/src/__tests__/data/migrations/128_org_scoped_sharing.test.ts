/**
 * Migration 128 — 조직 공유 범위 (user_agents.visibility 'organization' + org_id, agent_task_templates.org_id).
 * TEST_DATABASE_URL 미설정 시 DATABASE_URL fallback, 둘 다 없으면 skip. 멱등 2회 적용.
 */
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const CONN = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;

describeOrSkip('Migration 128 — org_scoped_sharing', () => {
    let pool: Pool;

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN });
        const sql = fs.readFileSync(path.resolve(__dirname, '../../../../../../db/migrations/128_org_scoped_sharing.sql'), 'utf8');
        await pool.query(sql);
        await pool.query(sql);
    });

    afterAll(async () => { await pool.end(); });

    test('user_agents·agent_task_templates 에 org_id 컬럼', async () => {
        const r = await pool.query<{ table_name: string }>(
            `SELECT table_name FROM information_schema.columns
              WHERE column_name = 'org_id' AND table_name IN ('user_agents', 'agent_task_templates') ORDER BY 1`);
        expect(r.rows.map((x) => x.table_name)).toEqual(['agent_task_templates', 'user_agents']);
    });

    test('visibility CHECK 가 organization 을 허용하고 그 외는 거부', async () => {
        const chk = await pool.query<{ def: string }>(
            `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'user_agents_visibility_chk'`);
        expect(chk.rows[0].def).toMatch(/organization/);
        expect(chk.rows[0].def).not.toMatch(/'team'/);
    });
});
