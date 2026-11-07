/**
 * 마지막 활성 관리자 보호(2026-11-07 점검) — 활성 관리자가 0명이 되는 역할 변경·비활성화를 막는다.
 */
jest.mock('../models/unified-database', () => ({ getPool: jest.fn() }));
jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
const mockDisconnectByUser = jest.fn();
jest.mock('../../services/local-bridge/registry', () => ({
    getLocalBridgeRegistry: () => ({ disconnectByUser: (...a: unknown[]) => mockDisconnectByUser(...a) }),
}));

import { assertNotLastActiveAdmin, LAST_ADMIN_ERROR_CODE } from '../last-admin-guard';
import { AppError } from '../../utils/error-handler';
import { getPool } from '../models/unified-database';
import { getUserManager } from '../user-manager';
import { getEventBus, USER_AUTH_REVOKED, type UserAuthRevokedEvent } from '../../utils/event-bus';

type Row = { id: string; role: string; is_active: boolean };

function mockClient(rows: Row[]) {
    return {
        query: jest.fn(async () => ({ rows, rowCount: rows.length })),
        release: jest.fn(),
    };
}

const ADMIN_A: Row = { id: 'a', role: 'admin', is_active: true };
const ADMIN_B: Row = { id: 'b', role: 'admin', is_active: true };
const USER_U: Row = { id: 'u', role: 'user', is_active: true };

describe('assertNotLastActiveAdmin', () => {
    test('마지막 활성 관리자 강등 → AppError 409', async () => {
        const client = mockClient([ADMIN_A]);
        const err = await assertNotLastActiveAdmin(client, 'a', { role: 'user' }).catch((e) => e);
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(409);
        expect(err.code).toBe(LAST_ADMIN_ERROR_CODE);
    });

    test('마지막 활성 관리자 비활성화 → AppError 409', async () => {
        const client = mockClient([ADMIN_A]);
        await expect(assertNotLastActiveAdmin(client, 'a', { is_active: false })).rejects.toMatchObject({ statusCode: 409 });
    });

    test('다른 활성 관리자가 남아 있으면 통과', async () => {
        const client = mockClient([ADMIN_A, ADMIN_B]);
        await expect(assertNotLastActiveAdmin(client, 'a', { role: 'user', is_active: false })).resolves.toBeUndefined();
    });

    test('비관리자 대상은 통과', async () => {
        const client = mockClient([ADMIN_A, USER_U]);
        await expect(assertNotLastActiveAdmin(client, 'u', { role: 'guest', is_active: false })).resolves.toBeUndefined();
    });

    test('이미 비활성인 관리자 대상은 통과(활성 관리자 수가 줄지 않음)', async () => {
        const client = mockClient([ADMIN_A, { id: 'x', role: 'admin', is_active: false }]);
        await expect(assertNotLastActiveAdmin(client, 'x', { role: 'user' })).resolves.toBeUndefined();
    });

    test('대상이 없으면 통과(갱신이 0행 → 호출부가 null 처리)', async () => {
        const client = mockClient([ADMIN_A]);
        await expect(assertNotLastActiveAdmin(client, 'nope', { role: 'user' })).resolves.toBeUndefined();
    });

    test('관리자 자격을 없애지 않는 요청은 쿼리 없이 통과', async () => {
        const client = mockClient([ADMIN_A]);
        await assertNotLastActiveAdmin(client, 'a', {});
        await assertNotLastActiveAdmin(client, 'a', { role: 'admin' });
        await assertNotLastActiveAdmin(client, 'a', { role: 'admin', is_active: true });
        expect(client.query).not.toHaveBeenCalled();
    });

    test('대상 행과 활성 관리자 행을 한 쿼리로 id 순서대로 잠근다', async () => {
        const client = mockClient([ADMIN_A, ADMIN_B]);
        await assertNotLastActiveAdmin(client, 'a', { role: 'user' });
        expect(client.query).toHaveBeenCalledTimes(1);
        const [sql, params] = (client.query.mock.calls[0] as unknown) as [string, unknown[]];
        expect(sql).toContain('FOR UPDATE');
        expect(sql).toContain('ORDER BY id');
        expect(params).toEqual(['a', 'admin']);
    });
});

describe('UserManager — 마지막 활성 관리자 보호 연결', () => {
    const manager = getUserManager();
    let events: UserAuthRevokedEvent[];
    const listener = (ev: UserAuthRevokedEvent) => { events.push(ev); };

    function mockPoolWith(lockedRows: Row[]) {
        const poolQuery = jest.fn(async (sql: string) => {
            if (sql.startsWith('SELECT role FROM users')) return { rowCount: 1, rows: [{ role: 'admin' }] };
            if (sql.startsWith('SELECT * FROM users')) return { rowCount: 1, rows: [{ ...ADMIN_A, email: 'a@b.c', username: 'a@b.c' }] };
            return { rowCount: 0, rows: [] };
        });
        const clientQuery = jest.fn(async (sql: string) => {
            if (sql.includes('FOR UPDATE')) return { rowCount: lockedRows.length, rows: lockedRows };
            if (sql.startsWith('UPDATE users')) return { rowCount: 1, rows: [] };
            return { rowCount: 0, rows: [] };
        });
        (getPool as jest.Mock).mockReturnValue({
            query: poolQuery,
            connect: jest.fn().mockResolvedValue({ query: clientQuery, release: jest.fn() }),
        });
        return { clientQuery };
    }
    const sqls = (q: jest.Mock) => q.mock.calls.map((c) => String(c[0]));

    beforeEach(() => {
        events = [];
        mockDisconnectByUser.mockClear();
        getEventBus().on(USER_AUTH_REVOKED, listener);
    });
    afterEach(() => { getEventBus().off(USER_AUTH_REVOKED, listener); });

    test('changeRole 로 마지막 활성 관리자 강등 → 409, UPDATE 없이 ROLLBACK, 발행 없음', async () => {
        const { clientQuery } = mockPoolWith([ADMIN_A]);
        await expect(manager.changeRole('a', 'user')).rejects.toMatchObject({ statusCode: 409, code: LAST_ADMIN_ERROR_CODE });
        expect(sqls(clientQuery).some((s) => s.startsWith('UPDATE users'))).toBe(false);
        expect(sqls(clientQuery)).toContain('ROLLBACK');
        expect(events).toEqual([]);
    });

    test('updateUser 로 마지막 활성 관리자 비활성화 → 409, 브리지 끊기·발행 없음', async () => {
        const { clientQuery } = mockPoolWith([ADMIN_A]);
        await expect(manager.updateUser('a', { is_active: false })).rejects.toMatchObject({ statusCode: 409 });
        expect(sqls(clientQuery).some((s) => s.startsWith('UPDATE users'))).toBe(false);
        expect(mockDisconnectByUser).not.toHaveBeenCalled();
        expect(events).toEqual([]);
    });

    test('다른 활성 관리자가 있으면 강등이 COMMIT 되고 발행은 그 뒤', async () => {
        const { clientQuery } = mockPoolWith([ADMIN_A, ADMIN_B]);
        await manager.changeRole('a', 'user');
        const seq = sqls(clientQuery);
        expect(seq.findIndex((s) => s.includes('FOR UPDATE'))).toBeLessThan(seq.findIndex((s) => s.startsWith('UPDATE users')));
        expect(seq[seq.length - 1]).toBe('COMMIT');
        expect(events).toEqual([{ userId: 'a', reason: 'role_changed' }]);
    });
});
