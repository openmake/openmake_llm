/**
 * W3 S7 — 계정 잠금(authenticateDetailed): 계정 단위 실패 카운터·잠금 시각(DB 시계 판정), 만료 뒤 재계수, 192 미적용(42703) 폴백.
 *
 * AUTH_LOCKOUT 은 모듈 로드 시 env 를 읽으므로 테스트마다 env 를 정하고 모듈을 새로 불러온다.
 */

const mockWarn = jest.fn();
jest.mock('../models/unified-database', () => ({
    getPool: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: mockWarn, error: jest.fn(), debug: jest.fn() }),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import type * as UserManagerModule from '../user-manager';
import type * as UnifiedDatabaseModule from '../models/unified-database';

interface QueryRecord { sql: string; params?: unknown[] }

const BASE_ROW = {
    id: '42',
    username: 'lockme',
    password_hash: 'hash',
    email: 'lockme@example.com',
    role: 'user',
    is_active: true,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    last_login: null,
    failed_login_count: 0,
    locked_until: null as Date | null,
    /** SELECT 의 (locked_until > NOW()) — 모의 DB 이므로 테스트가 DB 판정값을 직접 정한다. */
    locked_now: false,
};

const ENV_KEYS = ['NODE_ENV', 'AUTH_LOCKOUT_ENABLED', 'AUTH_LOCKOUT_THRESHOLD', 'AUTH_LOCKOUT_MS'] as const;

describe('UserManager.authenticateDetailed — 계정 잠금', () => {
    const saved: Record<string, string | undefined> = {};
    let queries: QueryRecord[];
    let compareSpy: jest.SpyInstance;

    function load(env: Partial<Record<(typeof ENV_KEYS)[number], string>>, row: typeof BASE_ROW, opts: { missingColumns?: boolean } = {}) {
        for (const k of ENV_KEYS) delete process.env[k];
        process.env.NODE_ENV = 'test';
        Object.assign(process.env, env);
        jest.resetModules();
        mockWarn.mockClear();
        queries = [];
        const bcrypt = require('bcryptjs') as typeof import('bcryptjs');
        compareSpy = jest.spyOn(bcrypt, 'compare');
        const db = require('../models/unified-database') as typeof UnifiedDatabaseModule;
        (db.getPool as jest.Mock).mockReturnValue({
            query: jest.fn(async (sql: string, params?: unknown[]) => {
                queries.push({ sql, params });
                if (opts.missingColumns && /failed_login_count|locked_until/.test(sql)) {
                    throw Object.assign(new Error('column "failed_login_count" does not exist'), { code: '42703' });
                }
                if (/^SELECT \*.* FROM users/.test(sql)) return { rowCount: 1, rows: [{ ...row }] };
                return { rowCount: 1, rows: [] };
            }),
        });
        return (require('../user-manager') as typeof UserManagerModule).getUserManager();
    }

    const EXPIRED_RESET_CASE = 'CASE WHEN locked_until IS NOT NULL AND locked_until <= NOW() THEN 1 ELSE failed_login_count + 1 END';
    const updates = () => queries.filter(q => q.sql.trimStart().startsWith('UPDATE users'));

    beforeAll(() => { for (const k of ENV_KEYS) saved[k] = process.env[k]; });
    afterEach(() => { compareSpy?.mockRestore(); });
    afterAll(() => {
        for (const k of ENV_KEYS) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
    });

    test('(a) THRESHOLD-1 회째 실패 — 카운터 UPDATE 1건, 파라미터 [id, 10, 900000], 잠금 아님', async () => {
        const manager = load({ NODE_ENV: 'production' }, { ...BASE_ROW, failed_login_count: 8 });
        compareSpy.mockResolvedValue(false);
        const result = await manager.authenticateDetailed('lockme@example.com', 'wrong');
        expect(result).toEqual({ user: null, locked: false });
        const ups = updates();
        expect(ups).toHaveLength(1);
        expect(ups[0].sql).toContain(`failed_login_count = ${EXPIRED_RESET_CASE}`);
        expect(ups[0].sql).toContain(`locked_until = CASE WHEN (${EXPIRED_RESET_CASE}) >= $2 THEN`);
        expect(ups[0].sql).toContain('ELSE NULL END');
        expect(ups[0].params).toEqual(['42', 10, 900000]);
    });

    test('(b) THRESHOLD 회째 실패 — 같은 UPDATE 1건이 make_interval 로 잠금 시각을 정한다', async () => {
        const manager = load({ AUTH_LOCKOUT_ENABLED: 'true', AUTH_LOCKOUT_THRESHOLD: '3', AUTH_LOCKOUT_MS: '60000' }, { ...BASE_ROW, failed_login_count: 2 });
        compareSpy.mockResolvedValue(false);
        await manager.authenticateDetailed('lockme@example.com', 'wrong');
        const ups = updates();
        expect(ups).toHaveLength(1);
        expect(ups[0].sql).toContain('make_interval(secs => $3 / 1000.0)');
        expect(ups[0].params).toEqual(['42', 3, 60000]);
    });

    test('(c) 잠금 진행 중(locked_now) — bcrypt 비교 없이 locked:true, UPDATE 없음', async () => {
        const manager = load({ NODE_ENV: 'production' }, { ...BASE_ROW, failed_login_count: 10, locked_until: new Date(Date.now() + 60_000), locked_now: true });
        const result = await manager.authenticateDetailed('lockme@example.com', 'correct');
        expect(result).toEqual({ user: null, locked: true });
        expect(compareSpy).not.toHaveBeenCalled();
        expect(updates()).toHaveLength(0);
    });

    test('(c-2) 잠금이 지났으면(locked_now=false) 다시 비밀번호를 비교한다', async () => {
        const manager = load({ NODE_ENV: 'production' }, { ...BASE_ROW, failed_login_count: 10, locked_until: new Date(Date.now() - 1000) });
        compareSpy.mockResolvedValue(true);
        const result = await manager.authenticateDetailed('lockme@example.com', 'correct');
        expect(result.locked).toBe(false);
        expect(result.user?.id).toBe('42');
    });

    test('(d) 성공 — last_login 과 함께 카운터·잠금을 초기화한다', async () => {
        const manager = load({ NODE_ENV: 'production' }, { ...BASE_ROW, failed_login_count: 4 });
        compareSpy.mockResolvedValue(true);
        const result = await manager.authenticateDetailed('lockme@example.com', 'correct');
        expect(result.locked).toBe(false);
        expect(result.user?.id).toBe('42');
        const ups = updates();
        expect(ups).toHaveLength(1);
        expect(ups[0].sql).toContain('failed_login_count = 0');
        expect(ups[0].sql).toContain('locked_until = NULL');
        expect(ups[0].params?.[1]).toBe('42');
    });

    test('(e) 42703(192 미적용) — 잠금 없이 종전 동작, 경고는 한 번만', async () => {
        const manager = load({ NODE_ENV: 'production' }, BASE_ROW, { missingColumns: true });
        compareSpy.mockResolvedValue(true);
        const first = await manager.authenticateDetailed('lockme@example.com', 'correct');
        expect(first).toEqual({ user: expect.objectContaining({ id: '42' }), locked: false });
        // 종전 last_login 갱신으로 폴백
        expect(updates().some(q => q.sql === 'UPDATE users SET last_login = $1 WHERE id = $2')).toBe(true);

        compareSpy.mockResolvedValue(false);
        const second = await manager.authenticateDetailed('lockme@example.com', 'wrong');
        expect(second).toEqual({ user: null, locked: false });
        expect(mockWarn).toHaveBeenCalledTimes(1);
    });

    test('(f) ENABLED=false(NODE_ENV=test 기본) — 카운터 SQL 이 나가지 않는다', async () => {
        const manager = load({}, { ...BASE_ROW, locked_until: new Date(Date.now() + 60_000) });
        compareSpy.mockResolvedValue(false);
        const fail = await manager.authenticateDetailed('lockme@example.com', 'wrong');
        expect(fail).toEqual({ user: null, locked: false });
        expect(queries.some(q => /failed_login_count|locked_until/.test(q.sql))).toBe(false);

        compareSpy.mockResolvedValue(true);
        const ok = await manager.authenticateDetailed('lockme@example.com', 'correct');
        expect(ok.user?.id).toBe('42');
        expect(updates().map(q => q.sql)).toEqual(['UPDATE users SET last_login = $1 WHERE id = $2']);
    });

    test('(g) 만료된 잠금(count≥THRESHOLD, locked_now=false)에서 1회 실패 — 1부터 다시 세는 UPDATE, 잠기지 않음', async () => {
        const manager = load({ NODE_ENV: 'production' }, { ...BASE_ROW, failed_login_count: 10, locked_until: new Date(Date.now() - 1000), locked_now: false });
        compareSpy.mockResolvedValue(false);
        const result = await manager.authenticateDetailed('lockme@example.com', 'wrong');
        expect(result).toEqual({ user: null, locked: false });
        expect(compareSpy).toHaveBeenCalledTimes(1);
        const ups = updates();
        expect(ups).toHaveLength(1);
        // 만료 분기: 카운트를 1 로 되돌리고, 새 카운트(1)가 THRESHOLD 미만이면 locked_until 을 NULL 로 정리한다.
        expect(ups[0].sql).toContain('WHEN locked_until IS NOT NULL AND locked_until <= NOW() THEN 1');
        expect(ups[0].sql).toContain(`locked_until = CASE WHEN (${EXPIRED_RESET_CASE}) >= $2 THEN NOW() + make_interval(secs => $3 / 1000.0) ELSE NULL END`);
        expect(ups[0].sql).not.toContain('ELSE locked_until END');
        expect(ups[0].params).toEqual(['42', 10, 900000]);
    });

    test('(h) locked_now=true 면 앱 시계로 지난 locked_until 이어도 bcrypt 없이 locked:true(DB 시계가 판정)', async () => {
        const manager = load({ NODE_ENV: 'production' }, { ...BASE_ROW, failed_login_count: 10, locked_until: new Date(Date.now() - 60_000), locked_now: true });
        const result = await manager.authenticateDetailed('lockme@example.com', 'correct');
        expect(result).toEqual({ user: null, locked: true });
        expect(compareSpy).not.toHaveBeenCalled();
        expect(updates()).toHaveLength(0);
        const select = queries.find(q => /^SELECT \*/.test(q.sql));
        expect(select?.sql).toContain('(locked_until IS NOT NULL AND locked_until > NOW()) AS locked_now');
        expect(select?.params).toEqual(['lockme@example.com']);
    });

    test('authenticate() 는 authenticateDetailed().user 를 돌려주는 래퍼다', async () => {
        const manager = load({ NODE_ENV: 'production' }, { ...BASE_ROW, locked_until: new Date(Date.now() + 60_000), locked_now: true });
        await expect(manager.authenticate('lockme@example.com', 'correct')).resolves.toBeNull();
    });
});
