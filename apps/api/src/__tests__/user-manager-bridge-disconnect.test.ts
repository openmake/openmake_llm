/**
 * 계정 비활성화·삭제 → 그 사용자의 로컬 브리지 연결 끊기 (2026-10-05).
 * 브리지 연결은 연결할 때만 계정을 검증하므로, 상태를 바꾸는 지점에서 닫는다.
 */

jest.mock('../data/models/unified-database', () => ({
    getPool: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
const mockDisconnectByUser = jest.fn().mockReturnValue(0);
jest.mock('../services/local-bridge/registry', () => ({
    getLocalBridgeRegistry: () => ({ disconnectByUser: (...a: unknown[]) => mockDisconnectByUser(...a) }),
}));

import { getUserManager } from '../data/user-manager';
import { getPool } from '../data/models/unified-database';

const USER_ROW = {
    id: 'u-1', username: 'a@b.c', password_hash: 'h', email: 'a@b.c', role: 'user', is_active: false,
    created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z', last_login: null,
};

function mockPool(updateRowCount: number, deleteRowCount = 1) {
    const query = jest.fn(async (sql: string) => {
        if (sql.startsWith('UPDATE users')) return { rowCount: updateRowCount, rows: [] };
        if (sql.startsWith('SELECT * FROM users')) return { rowCount: 1, rows: [USER_ROW] };
        return { rowCount: 0, rows: [] };
    });
    const client = {
        query: jest.fn(async (sql: string) => (sql.includes('DELETE FROM users') ? { rowCount: deleteRowCount } : { rowCount: 0 })),
        release: jest.fn(),
    };
    (getPool as jest.Mock).mockReturnValue({ query, connect: jest.fn().mockResolvedValue(client) });
    return { query, client };
}

describe('UserManager — 계정 상태 변경 시 브리지 연결 끊기', () => {
    const manager = getUserManager();
    beforeEach(() => mockDisconnectByUser.mockClear());

    test('updateUser 로 비활성화하면 그 사용자의 연결을 닫는다(account_disabled)', async () => {
        mockPool(1);
        await manager.updateUser('u-1', { is_active: false });
        expect(mockDisconnectByUser).toHaveBeenCalledWith('u-1', 'account_disabled');
    });

    test('활성화·다른 필드 변경은 닫지 않는다', async () => {
        mockPool(1);
        await manager.updateUser('u-1', { is_active: true });
        await manager.updateUser('u-1', { role: 'admin' });
        expect(mockDisconnectByUser).not.toHaveBeenCalled();
    });

    test('없는 사용자면 닫지 않는다', async () => {
        mockPool(0);
        await manager.updateUser('nope', { is_active: false });
        expect(mockDisconnectByUser).not.toHaveBeenCalled();
    });

    test('deleteUser 성공이면 그 사용자의 연결을 닫는다(account_deleted)', async () => {
        mockPool(1, 1);
        await manager.deleteUser('u-1');
        expect(mockDisconnectByUser).toHaveBeenCalledWith('u-1', 'account_deleted');
    });

    test('deleteUser 가 지운 행이 없으면 닫지 않는다', async () => {
        mockPool(1, 0);
        await manager.deleteUser('u-1');
        expect(mockDisconnectByUser).not.toHaveBeenCalled();
    });
});
