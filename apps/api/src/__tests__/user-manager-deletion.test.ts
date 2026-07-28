/**
 * GDPR Phase A Fix 1 단위 테스트 (gitignored — PR description inline).
 *
 * deleteUser() 가 사용자 삭제 직전 skill_manifests.is_public=FALSE
 * UPDATE 를 호출하는지 검증. SET NULL FK 자동 발동 직전에 실행되어야
 * 다른 사용자에게 공유되는 GDPR 위반 차단.
 */

jest.mock('../data/models/unified-database', () => ({
    getPool: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { getUserManager } from '../data/user-manager';
import { getPool } from '../data/models/unified-database';

interface QueryRecord {
    sql: string;
    params?: unknown[];
}

describe('UserManager.deleteUser — GDPR Phase A Fix 1', () => {
    let manager: ReturnType<typeof getUserManager>;
    let queries: QueryRecord[];
    let mockClient: { query: jest.Mock; release: jest.Mock };

    beforeEach(() => {
        queries = [];
        mockClient = {
            query: jest.fn(async (sql: string, params?: unknown[]) => {
                queries.push({ sql, params });
                if (typeof sql === 'string' && sql.includes('DELETE FROM users')) {
                    return { rowCount: 1 };
                }
                return { rowCount: 0 };
            }),
            release: jest.fn(),
        };
        (getPool as jest.Mock).mockReturnValue({
            connect: jest.fn().mockResolvedValue(mockClient),
        });
        manager = getUserManager();
    });

    test('UPDATE skill_manifests SET is_public=FALSE 가 호출되어야 한다', async () => {
        await manager.deleteUser('user-target');
        const updateCall = queries.find(q => q.sql.includes('UPDATE skill_manifests'));
        expect(updateCall).toBeDefined();
        expect(updateCall!.sql).toContain('is_public = FALSE');
        expect(updateCall!.sql).toContain('WHERE created_by = $1');
        expect(updateCall!.sql).toContain('AND is_public = TRUE');
        expect(updateCall!.params).toEqual(['user-target']);
    });

    test('UPDATE 가 DELETE FROM users 보다 먼저 실행되어야 한다 (SET NULL FK 자동 발동 직전)', async () => {
        await manager.deleteUser('user-order');
        const updateIdx = queries.findIndex(q => q.sql.includes('UPDATE skill_manifests'));
        const deleteUserIdx = queries.findIndex(q => q.sql.includes('DELETE FROM users'));
        expect(updateIdx).toBeGreaterThanOrEqual(0);
        expect(deleteUserIdx).toBeGreaterThan(updateIdx);
    });

    test('BEGIN/COMMIT 트랜잭션 안에서 실행되어야 한다 (실패 시 ROLLBACK)', async () => {
        await manager.deleteUser('user-tx');
        const beginIdx = queries.findIndex(q => q.sql === 'BEGIN');
        const updateIdx = queries.findIndex(q => q.sql.includes('UPDATE skill_manifests'));
        const commitIdx = queries.findIndex(q => q.sql === 'COMMIT');
        expect(beginIdx).toBe(0);
        expect(updateIdx).toBeGreaterThan(beginIdx);
        expect(commitIdx).toBeGreaterThan(updateIdx);
    });

    test('UPDATE 가 실패하면 ROLLBACK 호출 + throw', async () => {
        mockClient.query.mockImplementation(async (sql: string) => {
            queries.push({ sql });
            if (sql.includes('UPDATE skill_manifests')) {
                throw new Error('simulated DB failure');
            }
            return { rowCount: 0 };
        });
        await expect(manager.deleteUser('user-fail')).rejects.toThrow('simulated DB failure');
        const rollbackIdx = queries.findIndex(q => q.sql === 'ROLLBACK');
        const commitIdx = queries.findIndex(q => q.sql === 'COMMIT');
        expect(rollbackIdx).toBeGreaterThan(-1);
        expect(commitIdx).toBe(-1);  // COMMIT 절대 도달 안 함
    });
});
