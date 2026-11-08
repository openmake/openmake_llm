/**
 * 마지막 활성 관리자 삭제 차단 — 실제 Postgres 동시성 검증.
 * TEST_DATABASE_URL 이 없으면 skip 한다(로컬 본 DB·운영에 붙지 않는다 — 일회용 컨테이너 전용).
 * 연결 여러 개가 같은 표를 봐야 하므로 TEMP 표 대신 일회용 스키마를 만들고 search_path 로 가린 뒤 끝나면 지운다.
 *  ① 활성 관리자 2명이 서로를 동시에 삭제 → 정확히 하나만 성공, 다른 하나 409 LAST_ADMIN, 활성 관리자 1명 남음
 *  ② 남은 마지막 활성 관리자 삭제 → 409, 행 유지
 */
jest.mock('../models/unified-database', () => ({ getPool: jest.fn() }));
jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../addon-host/addon-data', () => ({ getAddonDataModules: () => [] }));
jest.mock('../../services/local-bridge/registry', () => ({ getLocalBridgeRegistry: () => ({ disconnectByUser: jest.fn() }) }));

import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { getPool } from '../models/unified-database';
import { getUserManager } from '../user-manager';
import { LAST_ADMIN_ERROR_CODE } from '../last-admin-guard';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;
const SCHEMA = `t_last_admin_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

/** deleteUser 가 정리하는 표 — 조건 열만 둔다 */
const CLEANUP_TABLES: Array<[string, string]> = [
    ['custom_agents', 'created_by'], ['user_memories', 'user_id'], ['model_assignments', 'scope'],
    ['orchestrator_runs', 'user_id'], ['orchestrator_jobs', 'user_id'], ['external_connections', 'user_id'],
    ['user_api_keys', 'user_id'], ['message_feedback', 'user_id'], ['research_sessions', 'user_id'],
    ['conversation_sessions', 'user_id'],
];

describeOrSkip('UserManager.deleteUser — 마지막 활성 관리자 동시 삭제 차단 (일회용 스키마)', () => {
    let admin: Pool;
    let pool: Pool;

    const activeAdmins = async () =>
        (await pool.query(`SELECT id FROM users WHERE role = 'admin' AND is_active = TRUE ORDER BY id`)).rows.map((r) => r.id);

    beforeAll(async () => {
        // 생성자 초기화(관리자·시스템 계정 보장)는 빈 모의 풀에서 끝낸다 — 시험 표에 고정 데이터만 남게.
        (getPool as jest.Mock).mockReturnValue({ query: jest.fn(async () => ({ rowCount: 0, rows: [] })) });
        await getUserManager().ensureReady().catch(() => undefined);

        admin = new Pool({ connectionString: CONN, max: 2 }); // 잠금 보유 1 + 대기 관측 1
        await admin.query(`CREATE SCHEMA ${SCHEMA}`);
        await admin.query(`CREATE TABLE ${SCHEMA}.users (
            id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, email TEXT,
            role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user', 'guest')),
            created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
            last_login TIMESTAMPTZ, is_active BOOLEAN DEFAULT TRUE, tokens_valid_after TIMESTAMPTZ)`);
        for (const [table, col] of CLEANUP_TABLES) await admin.query(`CREATE TABLE ${SCHEMA}.${table} (${col} TEXT)`);

        pool = new Pool({ connectionString: CONN, max: 4, options: `-c search_path=${SCHEMA}` });
        (getPool as jest.Mock).mockReturnValue(pool);
    });

    beforeEach(async () => {
        await pool.query('DELETE FROM users');
        for (const id of ['a', 'b']) {
            await pool.query(`INSERT INTO users (id, username, password_hash, role) VALUES ($1, $1, 'x', 'admin')`, [id]);
        }
        await pool.query(`INSERT INTO users (id, username, password_hash, role) VALUES ('u', 'u', 'x', 'user')`);
    });

    afterAll(async () => {
        await pool?.end();
        await admin?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
        await admin?.end();
    });

    it('① 활성 관리자 2명이 서로를 동시에 삭제 → 하나만 성공, 다른 하나 409, 활성 관리자 1명 남음', async () => {
        // 두 삭제가 같은 시점에 경쟁하도록 관리자 행을 잠가 둔 채 둘 다 출발시키고, 둘 다 잠금 대기에 들어간 뒤 푼다.
        const blocker = await admin.connect();
        try {
            await blocker.query('BEGIN');
            await blocker.query(`SELECT id FROM ${SCHEMA}.users WHERE id IN ('a', 'b') FOR UPDATE`);
            const results = Promise.allSettled([getUserManager().deleteUser('a'), getUserManager().deleteUser('b')]);
            for (let i = 0; i < 100; i++) {
                const { rows } = await admin.query(
                    `SELECT COUNT(*)::int AS n FROM pg_stat_activity
                      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%'`,
                );
                if (rows[0].n >= 2) break;
                await new Promise((r) => setTimeout(r, 50));
            }
            await blocker.query('COMMIT');

            const settled = await results;
            const fulfilled = settled.filter((r) => r.status === 'fulfilled');
            const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
            expect(fulfilled).toHaveLength(1);
            expect((fulfilled[0] as PromiseFulfilledResult<boolean>).value).toBe(true);
            expect(rejected).toHaveLength(1);
            expect(rejected[0].reason).toMatchObject({ statusCode: 409, code: LAST_ADMIN_ERROR_CODE });
            expect(await activeAdmins()).toHaveLength(1);
        } finally {
            blocker.release();
        }
    });

    it('② 남은 마지막 활성 관리자 삭제 → 409, 행 유지 / 일반 사용자 삭제는 그대로 성공', async () => {
        await expect(getUserManager().deleteUser('b')).resolves.toBe(true);
        await expect(getUserManager().deleteUser('a')).rejects.toMatchObject({ statusCode: 409, code: LAST_ADMIN_ERROR_CODE });
        expect(await activeAdmins()).toEqual(['a']);
        await expect(getUserManager().deleteUser('u')).resolves.toBe(true);
    });
});
