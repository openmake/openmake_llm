/**
 * knowledge-runtime/db 실 DB 검증 — TEST_DATABASE_URL 없으면 skip.
 *
 * db.ts 와 포트(runtime-ports/db-access)는 실제로 로드하고, Base 풀 제공자(unified-database 의 getPool)만
 * TEST_DATABASE_URL 풀로 대체한다. 이 테스트가 만든 고유 이름 테이블로 commit 반영·실패 시 원복·연결 재사용을 확인한다.
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;

// jest.mock 팩토리는 호이스팅돼 바깥 상수를 못 쓴다 — 팩토리의 max 와 같은 값으로 둔다
const POOL_MAX = 2;
jest.mock('../../../data/models/unified-database', () => {
    const { Pool: PgPool } = require('pg');
    const pool = process.env.TEST_DATABASE_URL
        ? new PgPool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 })
        : null;
    return { __esModule: true, __pool: pool, getPool: () => pool };
});

import { inTransaction, kdb } from '../db';

const testPool = (): Pool => (jest.requireMock('../../../data/models/unified-database') as { __pool: Pool }).__pool;
const TABLE = `knowledge_db_port_test_${randomUUID().replace(/-/g, '')}`;

describeOrSkip('knowledge-runtime/db — 포트 경유 실 DB 트랜잭션', () => {
    beforeAll(async () => {
        await testPool().query(`CREATE TABLE ${TABLE} (id serial PRIMARY KEY, label text NOT NULL)`);
    });

    afterAll(async () => {
        await testPool().query(`DROP TABLE IF EXISTS ${TABLE}`);
        await testPool().end();
    });

    const labels = async (): Promise<string[]> =>
        (await kdb().query<{ label: string }>(`SELECT label FROM ${TABLE} ORDER BY id`)).rows.map((r) => r.label);

    it('kdb() 는 Base 풀 제공자의 풀을 그대로 반환한다', () => {
        expect(kdb()).toBe(testPool());
    });

    it('성공한 트랜잭션은 commit 되어 다른 연결에서 보인다', async () => {
        const out = await inTransaction(async (c) => {
            await c.query(`INSERT INTO ${TABLE} (label) VALUES ($1)`, ['committed']);
            return 'done';
        });
        expect(out).toBe('done');
        expect(await labels()).toContain('committed');
    });

    it('callback 이 실패하면 원복되고 원래 오류를 던진다', async () => {
        const boom = new Error('fail after insert');
        await expect(inTransaction(async (c) => {
            await c.query(`INSERT INTO ${TABLE} (label) VALUES ($1)`, ['rolled-back']);
            throw boom;
        })).rejects.toBe(boom);
        expect(await labels()).not.toContain('rolled-back');
    });

    it('SQL 오류도 원복되고, 반복 실행해도 연결을 반환해 풀이 고갈되지 않는다', async () => {
        for (let i = 0; i < POOL_MAX * 5; i++) {
            if (i % 2 === 0) {
                await inTransaction(async (c) => c.query(`INSERT INTO ${TABLE} (label) VALUES ($1)`, [`loop-${i}`]));
            } else {
                await expect(inTransaction(async (c) => {
                    await c.query(`INSERT INTO ${TABLE} (label) VALUES ($1)`, [`bad-${i}`]);
                    await c.query(`INSERT INTO ${TABLE} (label) VALUES (NULL)`);
                })).rejects.toMatchObject({ code: '23502' });
            }
        }
        const rows = await labels();
        expect(rows.filter((l) => l.startsWith('loop-'))).toHaveLength(POOL_MAX * 5 / 2);
        expect(rows.some((l) => l.startsWith('bad-'))).toBe(false);

        const pool = testPool();
        expect(pool.totalCount).toBeLessThanOrEqual(POOL_MAX);
        expect(pool.idleCount).toBe(pool.totalCount);
        expect(pool.waitingCount).toBe(0);
    });
});
