/**
 * 관리자 사용자 목록(getAllUsers) — 실제 Postgres 정렬 의미 검증.
 * TEST_DATABASE_URL 이 없으면 skip 한다(로컬 본 DB·운영에 붙지 않는다 — 일회용 컨테이너 전용).
 * 한 연결 안의 TEMP 표 users(pg_temp 가 검색 경로 맨 앞이라 실제 표를 가린다)에 가상 사용자를 오래된 순으로 넣는다 —
 * 정렬이 없으면 삽입 순서(오래된 사용자)가 먼저 나와 실패한다.
 *  ① limit 보다 사용자가 많아도 첫 페이지는 최근 가입자
 *  ② 같은 created_at 은 id DESC
 *  ③ 페이지를 이어 붙이면 겹침·누락 없이 전체 순서, created_at NULL 은 마지막
 *  ④ 역할·검색 필터와 개수는 그대로, 필터 결과도 같은 순서
 */
jest.mock('../models/unified-database', () => ({
    getPool: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { Pool, type PoolClient } from 'pg';
import { getPool } from '../models/unified-database';
import { getUserManager } from '../user-manager';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;

/** 삽입 순서(오래된 것 먼저) — [id, role, created_at] */
const FIXTURES: Array<[string, string, string | null]> = [
    ['u-null', 'user', null],
    ['u-01', 'user', '2026-10-01T00:00:00Z'],
    ['u-02', 'user', '2026-10-02T00:00:00Z'],
    ['u-03', 'user', '2026-10-03T00:00:00Z'],
    ['u-04', 'user', '2026-10-04T00:00:00Z'],
    ['u-05', 'user', '2026-10-05T00:00:00Z'],
    ['u-admin', 'admin', '2026-10-05T12:00:00Z'],
    ['u-06', 'user', '2026-10-06T00:00:00Z'],
    ['u-tie-a', 'user', '2026-10-07T00:00:00Z'],
    ['u-tie-b', 'user', '2026-10-07T00:00:00Z'],
];
const NEWEST_FIRST = ['u-tie-b', 'u-tie-a', 'u-06', 'u-admin', 'u-05', 'u-04', 'u-03', 'u-02', 'u-01', 'u-null'];

describeOrSkip('UserManager.getAllUsers — 최근 가입순 정렬 (TEMP 표)', () => {
    let pool: Pool;
    let client: PoolClient;

    async function ids(options: Parameters<ReturnType<typeof getUserManager>['getAllUsers']>[0]) {
        const r = await getUserManager().getAllUsers(options);
        return { ids: r.users.map(u => u.id), total: r.total };
    }

    beforeAll(async () => {
        // 생성자 초기화(관리자·시스템 계정 보장)는 빈 모의 풀에서 끝낸다 — TEMP 표에 고정 데이터만 남게.
        (getPool as jest.Mock).mockReturnValue({ query: jest.fn(async () => ({ rowCount: 0, rows: [] })) });
        await getUserManager().ensureReady().catch(() => undefined);

        pool = new Pool({ connectionString: CONN, max: 1 });
        client = await pool.connect();
        // db/init/002-schema.sql users + 194 tokens_valid_after
        await client.query(`CREATE TEMP TABLE users (
            id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, email TEXT,
            role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user', 'guest')),
            created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
            last_login TIMESTAMPTZ, is_active BOOLEAN DEFAULT TRUE, tokens_valid_after TIMESTAMPTZ)`);
        for (const [id, role, createdAt] of FIXTURES) {
            await client.query(
                `INSERT INTO users (id, username, password_hash, email, role, created_at) VALUES ($1, $1, 'x', $2, $3, $4)`,
                [id, `${id}@example.test`, role, createdAt],
            );
        }
        (getPool as jest.Mock).mockReturnValue(client);
    });

    afterAll(async () => {
        client?.release(true);
        await pool?.end();
    });

    it('① limit 보다 사용자가 많아도 첫 페이지는 최근 가입자', async () => {
        expect(await ids({ limit: 3 })).toEqual({ ids: ['u-tie-b', 'u-tie-a', 'u-06'], total: 10 });
    });

    it('② 같은 created_at 은 id DESC', async () => {
        expect((await ids({ limit: 2 })).ids).toEqual(['u-tie-b', 'u-tie-a']);
    });

    it('③ 페이지를 이어 붙이면 겹침·누락 없이 전체 순서, created_at NULL 은 마지막', async () => {
        const all: string[] = [];
        for (let page = 1; page <= 4; page++) all.push(...(await ids({ page, limit: 3 })).ids);
        expect(all).toEqual(NEWEST_FIRST);
    });

    it('④ 역할·검색 필터와 개수는 그대로, 필터 결과도 같은 순서', async () => {
        expect(await ids({ role: 'admin' })).toEqual({ ids: ['u-admin'], total: 1 });
        expect(await ids({ search: 'U-0', page: 2, limit: 3 })).toEqual({ ids: ['u-03', 'u-02', 'u-01'], total: 6 });
        expect(await ids({ role: 'user', search: 'tie' })).toEqual({ ids: ['u-tie-b', 'u-tie-a'], total: 2 });
    });
});
