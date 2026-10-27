/**
 * 토큰 무효화 기준 시각(마이그레이션 194, 보안 점검 A2) — 갱신 SQL 과 PublicUser 매핑.
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
import { invalidateTokensBefore } from '../user-manager-token-invalidation';

const BASE_ROW = {
    id: '42',
    username: 'u',
    password_hash: 'hash',
    email: 'u@example.com',
    role: 'user',
    is_active: true,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    last_login: null,
};

let row: Record<string, unknown>;
const mockQuery = jest.fn(async (sql: string) => {
    if (sql.startsWith('SELECT * FROM users WHERE id')) return { rowCount: 1, rows: [row] };
    return { rowCount: 0, rows: [] };
});

beforeEach(() => {
    mockQuery.mockClear();
    row = { ...BASE_ROW };
    (getPool as jest.Mock).mockReturnValue({ query: mockQuery });
});

describe('invalidateTokensBefore', () => {
    it('users.tokens_valid_after 를 주어진 시각으로 갱신한다(parameterized)', async () => {
        const at = new Date('2026-10-25T06:00:00.000Z');
        await invalidateTokensBefore('42', at);
        expect(mockQuery).toHaveBeenCalledWith('UPDATE users SET tokens_valid_after = $1 WHERE id = $2', [at, '42']);
    });

    it('시각을 생략하면 지금', async () => {
        const before = Date.now();
        await invalidateTokensBefore('42');
        const [, params] = mockQuery.mock.calls[0] as unknown as [string, [Date, string]];
        expect(params[0]).toBeInstanceOf(Date);
        expect(params[0].getTime()).toBeGreaterThanOrEqual(before);
        expect(params[1]).toBe('42');
    });
});

describe('PublicUser.tokens_valid_after 매핑', () => {
    it('pg Date 는 ISO 문자열로', async () => {
        row.tokens_valid_after = new Date('2026-10-25T06:00:00.123Z');
        const user = await getUserManager().getUserById('42');
        expect(user?.tokens_valid_after).toBe('2026-10-25T06:00:00.123Z');
    });

    it('NULL 이면 null', async () => {
        row.tokens_valid_after = null;
        const user = await getUserManager().getUserById('42');
        expect(user?.tokens_valid_after).toBeNull();
    });

    it('194 미적용(열 없음)이면 null', async () => {
        const user = await getUserManager().getUserById('42');
        expect(user?.tokens_valid_after).toBeNull();
    });
});
