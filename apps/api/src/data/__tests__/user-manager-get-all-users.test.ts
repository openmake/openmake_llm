/**
 * 관리자 사용자 목록(getAllUsers) — 목록 SQL 이 LIMIT 앞에서 최근 가입순(created_at DESC NULLS LAST, id DESC)으로 정렬하고
 * 검색·역할 필터·개수·페이지 파라미터는 그대로 둔다. 실제 Postgres 정렬 의미는 user-manager-get-all-users.db.test.ts 가 검증한다.
 */
jest.mock('../models/unified-database', () => ({
    getPool: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { getPool } from '../models/unified-database';
import { getUserManager } from '../user-manager';

const mockQuery = jest.fn(async (sql: string) => {
    if (sql.startsWith('SELECT COUNT(*)')) return { rowCount: 1, rows: [{ total: '0' }] };
    return { rowCount: 0, rows: [] };
});

beforeEach(async () => {
    (getPool as jest.Mock).mockReturnValue({ query: mockQuery });
    await getUserManager().ensureReady().catch(() => undefined);
    mockQuery.mockClear();
});

describe('UserManager.getAllUsers — 목록 정렬', () => {
    it('LIMIT/OFFSET 앞에서 created_at DESC NULLS LAST, id DESC 로 정렬하고 필터·페이지 파라미터는 유지한다', async () => {
        await getUserManager().getAllUsers({ role: 'user', search: 'Kim', page: 2, limit: 8 });

        const [sql, params] = mockQuery.mock.calls[1] as unknown as [string, unknown[]];
        expect(sql).toMatch(
            /^SELECT \* FROM users WHERE role = \$1 AND \(.+\) ORDER BY created_at DESC NULLS LAST, id DESC LIMIT \$3 OFFSET \$4$/,
        );
        expect(params).toEqual(['user', '%kim%', 8, 8]);
    });
});
