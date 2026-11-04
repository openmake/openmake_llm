/**
 * 마이그레이션 196 — orchestration_dispatch_decisions 의 add-on 도구 의도 중립 열, 실제 Postgres 의미 검증.
 * TEST_DATABASE_URL 이 없으면 skip 한다(로컬 본 DB·운영에 붙지 않는다).
 * 한 연결 안의 TEMP 표(086 열 구조)에 196 을 적용한다. TEMP 표는 검색 경로 맨 앞(pg_temp)이라
 * 같은 이름의 실제 표를 가린다 — 실제 표의 데이터는 건드리지 않는다.
 *  ① 열 생성 + backfill: 새 열 값이 구 열 값과 같다
 *  ② 멱등: 다시 적용해도 오류 없이 같은 결과
 *  ③ 롤백 SQL 은 열만 지우고, 196 재적용으로 복구된다
 */
import { Pool, type PoolClient } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;
const MIGRATIONS = path.resolve(__dirname, '../../../../../db/migrations');
const FORWARD = fs.readFileSync(path.join(MIGRATIONS, '196_orchestration_addon_tool_intent.sql'), 'utf8');
const ROLLBACK = fs.readFileSync(path.join(MIGRATIONS, 'rollbacks/196_orchestration_addon_tool_intent_rollback.sql'), 'utf8');

describeOrSkip('마이그레이션 196 — add-on 도구 의도 중립 열 (TEMP 표)', () => {
    let pool: Pool;
    let client: PoolClient;

    async function rows(): Promise<Array<{ request_id: string; legacy: boolean; neutral: boolean }>> {
        const r = await client.query(
            `SELECT request_id, discussion_intent AS legacy, addon_tool_intent AS neutral
               FROM orchestration_dispatch_decisions ORDER BY id`,
        );
        return r.rows;
    }

    async function hasColumn(): Promise<boolean> {
        const r = await client.query(
            `SELECT 1 FROM pg_attribute
              WHERE attrelid = 'orchestration_dispatch_decisions'::regclass AND attname = 'addon_tool_intent' AND NOT attisdropped`,
        );
        return (r.rowCount ?? 0) > 0;
    }

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN, max: 1 });
        client = await pool.connect();
        // 086 의 열 구조(196 이 쓰는 열 + NOT NULL 기본값이 있는 열)
        await client.query(`CREATE TEMP TABLE orchestration_dispatch_decisions (
            id BIGSERIAL PRIMARY KEY,
            request_id TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            discussion_intent BOOLEAN NOT NULL DEFAULT false,
            task_delegate_intent BOOLEAN NOT NULL DEFAULT false,
            user_mode TEXT NOT NULL DEFAULT 'none'
        )`);
        await client.query(
            `INSERT INTO orchestration_dispatch_decisions (request_id, discussion_intent) VALUES ('a', true), ('b', false), ('c', true)`,
        );
    });

    afterAll(async () => {
        client?.release();
        await pool?.end();
    });

    it('열을 만들고 구 열 값으로 backfill 하며, 다시 돌아도 같다', async () => {
        await client.query(FORWARD);
        expect(await rows()).toEqual([
            { request_id: 'a', legacy: true, neutral: true },
            { request_id: 'b', legacy: false, neutral: false },
            { request_id: 'c', legacy: true, neutral: true },
        ]);

        await client.query(FORWARD);
        expect((await rows()).every((r) => r.legacy === r.neutral)).toBe(true);

        // 새 행은 기본값 false 로 들어간다(롤백 창의 구 코드 INSERT 와 같은 모양)
        await client.query(`INSERT INTO orchestration_dispatch_decisions (request_id, discussion_intent) VALUES ('d', true)`);
        expect((await rows()).at(-1)).toEqual({ request_id: 'd', legacy: true, neutral: false });
        // 재적용(PR-H1-4 의 backfill 재실행)이 그 행도 맞춘다
        await client.query(FORWARD);
        expect((await rows()).at(-1)).toEqual({ request_id: 'd', legacy: true, neutral: true });
    });

    it('롤백 SQL 은 열만 지우고 196 재적용으로 복구된다', async () => {
        await client.query(ROLLBACK);
        expect(await hasColumn()).toBe(false);
        const left = await client.query(`SELECT count(*)::int AS n FROM orchestration_dispatch_decisions WHERE discussion_intent`);
        expect(left.rows[0].n).toBe(3);

        await client.query(ROLLBACK); // 멱등
        await client.query(FORWARD);
        expect(await hasColumn()).toBe(true);
        expect((await rows()).every((r) => r.legacy === r.neutral)).toBe(true);
    });
});
