/**
 * 마이그레이션 193 — 제거된 외부 provider(#1481 되돌림) 행 정리, 실제 Postgres 의미 검증.
 * TEST_DATABASE_URL 이 없으면 skip 한다(로컬 본 DB·운영에 붙지 않는다).
 * 한 연결 안의 TEMP 표(provider_id 열을 가진 코어 표 9개)에 193 을 적용한다. TEMP 표는 검색 경로 맨 앞(pg_temp)이라
 * 같은 이름의 실제 표를 가린다 — 실제 표의 데이터는 건드리지 않는다.
 *  ① 제거된 provider_id 행만 지운다(다른 provider 행은 그대로)
 *  ② 멱등: 다시 적용해도 오류 없이 0건
 *  ③ 건수는 NOTICE 로 남는다(MigrationRunner 가 서버 로그로 옮긴다)
 */
import { Pool, type PoolClient } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;
const MIGRATION = fs.readFileSync(
    path.resolve(__dirname, '../../../../../db/migrations/193_remove_retired_external_provider.sql'),
    'utf8',
);
/** 마이그레이션과 같은 방식으로 나눠 적은 제거 대상 provider id */
const RETIRED = ['demon', 'route'].join('');
const TABLES = [
    'external_provider_usage', 'server_external_key_usage', 'external_model_availability',
    'external_provider_models_cache', 'chat_requests', 'llm_request_metrics', 'orchestrator_jobs',
    'user_external_api_keys', 'server_external_api_keys',
];

describeOrSkip('마이그레이션 193 — 제거된 provider 행 정리 (TEMP 표)', () => {
    let pool: Pool;
    let client: PoolClient;
    const notices: string[] = [];

    async function count(table: string, providerId: string): Promise<number> {
        const r = await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE provider_id = $1`, [providerId]);
        return r.rows[0].n;
    }

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN, max: 1 });
        client = await pool.connect();
        client.on('notice', (m) => notices.push(m.message ?? ''));
        for (const t of TABLES) {
            // 193 이 쓰는 열(provider_id)만 — 실제 표의 다른 열·제약은 이 판정과 무관하다
            await client.query(`CREATE TEMP TABLE ${t} (id SERIAL PRIMARY KEY, provider_id TEXT)`);
            await client.query(`INSERT INTO ${t} (provider_id) VALUES ($1), ($1), ('openrouter')`, [RETIRED]);
        }
    });

    afterAll(async () => {
        client?.release();
        await pool?.end();
    });

    it('제거된 provider 행만 지우고, 다시 돌아도 오류 없이 0건이다', async () => {
        for (const t of TABLES) expect(await count(t, RETIRED)).toBe(2);

        await client.query(MIGRATION);
        for (const t of TABLES) {
            expect(await count(t, RETIRED)).toBe(0);
            expect(await count(t, 'openrouter')).toBe(1);
        }
        expect(notices.at(-1)).toBe(
            '[193] retired provider rows removed: usage=2 server_usage=2 availability=2 models_cache=2 '
            + 'chat_requests=2 llm_metrics=2 orchestrator_jobs=2 user_keys=2 server_keys=2',
        );

        await client.query(MIGRATION);
        expect(notices.at(-1)).toMatch(/usage=0 server_usage=0 .* user_keys=0 server_keys=0$/);
        for (const t of TABLES) expect(await count(t, 'openrouter')).toBe(1);
    });
});
