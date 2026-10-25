/**
 * 계정 권한·상태가 바뀌면 USER_AUTH_REVOKED 를 발행한다(보안 점검 A3 보조 방어) — ws 계층이 열린 채팅 소켓을 닫는다.
 * 실제로 행이 바뀐 성공 경로에서만 발행한다.
 */
jest.mock('../models/unified-database', () => ({
    getPool: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../services/local-bridge/registry', () => ({
    getLocalBridgeRegistry: () => ({ disconnectByUser: jest.fn().mockReturnValue(0) }),
}));

import { getPool } from '../models/unified-database';
import { getUserManager } from '../user-manager';
import { getEventBus, USER_AUTH_REVOKED, type UserAuthRevokedEvent } from '../../utils/event-bus';

const ROW = {
    id: 'u-1', username: 'a@b.c', password_hash: 'h', email: 'a@b.c', role: 'user', is_active: true,
    created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z', last_login: null,
};

function mockPool(updateRowCount: number, opts: { deleteRowCount?: number; currentRole?: string } = {}) {
    const query = jest.fn(async (sql: string) => {
        if (sql.startsWith('UPDATE users')) return { rowCount: updateRowCount, rows: [] };
        if (sql.startsWith('SELECT role FROM users')) {
            return updateRowCount > 0 ? { rowCount: 1, rows: [{ role: opts.currentRole ?? 'user' }] } : { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT * FROM users')) return { rowCount: 1, rows: [ROW] };
        return { rowCount: 0, rows: [] };
    });
    const client = {
        query: jest.fn(async (sql: string) => (sql.includes('DELETE FROM users') ? { rowCount: opts.deleteRowCount ?? 1 } : { rowCount: 0 })),
        release: jest.fn(),
    };
    (getPool as jest.Mock).mockReturnValue({ query, connect: jest.fn().mockResolvedValue(client) });
}

describe('UserManager — USER_AUTH_REVOKED 발행', () => {
    const manager = getUserManager();
    let events: UserAuthRevokedEvent[];
    const listener = (ev: UserAuthRevokedEvent) => { events.push(ev); };
    beforeEach(() => {
        events = [];
        getEventBus().on(USER_AUTH_REVOKED, listener);
    });
    afterEach(() => { getEventBus().off(USER_AUTH_REVOKED, listener); });

    test('changePassword 성공 → password_changed', async () => {
        mockPool(1);
        await manager.changePassword('u-1', 'New-secret-123!');
        expect(events).toEqual([{ userId: 'u-1', reason: 'password_changed' }]);
    });

    test('changePassword 대상 없음 → 발행 안 함', async () => {
        mockPool(0);
        await manager.changePassword('nope', 'New-secret-123!');
        expect(events).toEqual([]);
    });

    test('changeRole 성공 → role_changed, 대상 없음 → 발행 안 함', async () => {
        mockPool(1);
        await manager.changeRole('u-1', 'admin');
        expect(events).toEqual([{ userId: 'u-1', reason: 'role_changed' }]);
        events = [];
        mockPool(0);
        await manager.changeRole('nope', 'admin');
        expect(events).toEqual([]);
    });

    test('updateUser({is_active:false}) → account_disabled, 활성화는 발행 안 함', async () => {
        mockPool(1);
        await manager.updateUser('u-1', { is_active: false });
        expect(events).toEqual([{ userId: 'u-1', reason: 'account_disabled' }]);
        events = [];
        await manager.updateUser('u-1', { is_active: true });
        expect(events).toEqual([]);
    });

    test('updateUser role 이 실제로 바뀌면 role_changed, 같은 값이면 발행 안 함', async () => {
        mockPool(1, { currentRole: 'admin' });
        await manager.updateUser('u-1', { role: 'user' });
        expect(events).toEqual([{ userId: 'u-1', reason: 'role_changed' }]);
        events = [];
        mockPool(1, { currentRole: 'user' });
        await manager.updateUser('u-1', { role: 'user', is_active: true });
        expect(events).toEqual([]);
    });

    test('updateUser password → password_changed', async () => {
        mockPool(1);
        await manager.updateUser('u-1', { password: 'New-secret-123!' });
        expect(events).toEqual([{ userId: 'u-1', reason: 'password_changed' }]);
    });

    test('updateUser 대상 없음 → 발행 안 함', async () => {
        mockPool(0);
        await manager.updateUser('nope', { is_active: false, role: 'user', password: 'New-secret-123!' });
        expect(events).toEqual([]);
    });

    test('deleteUser 성공 → account_deleted, 지운 행 없음 → 발행 안 함', async () => {
        mockPool(1, { deleteRowCount: 1 });
        await manager.deleteUser('u-1');
        expect(events).toEqual([{ userId: 'u-1', reason: 'account_deleted' }]);
        events = [];
        mockPool(1, { deleteRowCount: 0 });
        await manager.deleteUser('u-1');
        expect(events).toEqual([]);
    });
});
