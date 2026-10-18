/**
 * 사용자 삭제의 add-on 데이터 의무 — add-on 소유 테이블 정리는 그 add-on 의 모듈이 같은 트랜잭션 안에서 하고,
 * 모듈을 불러오지 못했거나 정리가 실패하면 삭제 전체를 되돌린다(fail-closed — FK SET NULL 로 남의 데이터가 system 소유로 바뀌는 것 방지).
 */
jest.mock('../data/models/unified-database', () => ({ getPool: jest.fn() }));
jest.mock('../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
const dataModules = jest.fn();
jest.mock('../addon-host/addon-data', () => ({ getAddonDataModules: () => dataModules() }));

import { getUserManager } from '../data/user-manager';
import { getPool } from '../data/models/unified-database';

let queries: string[];
let client: { query: jest.Mock; release: jest.Mock };

beforeEach(() => {
    queries = [];
    client = {
        query: jest.fn(async (sql: string) => {
            queries.push(sql);
            return { rowCount: sql.includes('DELETE FROM users') ? 1 : 0 };
        }),
        release: jest.fn(),
    };
    (getPool as jest.Mock).mockReturnValue({ connect: jest.fn().mockResolvedValue(client) });
});

describe('UserManager.deleteUser — add-on 데이터 의무', () => {
    it('각 add-on 의 정리를 같은 트랜잭션 클라이언트로, 사용자 행 삭제 전에 부른다', async () => {
        const onUserDelete = jest.fn(async (tx: { query: (sql: string, p: unknown[]) => Promise<unknown> }, uid: string) => {
            await tx.query('UPDATE addon_table SET owner = NULL WHERE owner = $1', [uid]);
        });
        dataModules.mockReturnValue([{ addonId: 'a', data: { onUserDelete }, error: null }, { addonId: 'b', data: {}, error: null }]);
        await expect(getUserManager().deleteUser('u-target')).resolves.toBe(true);
        expect(onUserDelete).toHaveBeenCalledWith(client, 'u-target');
        expect(queries.indexOf('UPDATE addon_table SET owner = NULL WHERE owner = $1')).toBeLessThan(queries.findIndex((q) => q.includes('DELETE FROM users')));
        expect(queries).toContain('COMMIT');
    });

    it('데이터 모듈을 불러오지 못했으면 사용자 행을 지우지 않고 되돌린다', async () => {
        dataModules.mockReturnValue([{ addonId: 'broken', data: null, error: 'Cannot find module' }]);
        await expect(getUserManager().deleteUser('u-target')).rejects.toThrow(/broken/);
        expect(queries.some((q) => q.includes('DELETE FROM users'))).toBe(false);
        expect(queries).toContain('ROLLBACK');
        expect(queries).not.toContain('COMMIT');
    });

    it('정리가 실패하면 되돌린다', async () => {
        dataModules.mockReturnValue([{ addonId: 'a', data: { onUserDelete: async () => { throw new Error('db down'); } }, error: null }]);
        await expect(getUserManager().deleteUser('u-target')).rejects.toThrow('db down');
        expect(queries.some((q) => q.includes('DELETE FROM users'))).toBe(false);
        expect(queries).toContain('ROLLBACK');
    });
});
