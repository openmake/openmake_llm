/**
 * 계정 조회·비밀번호 변경 결함 회귀 테스트 (2026-08-13)
 *
 * 1. getUserByEmail 이 username 으로만 조회해 username≠email 계정의
 *    OAuth 로그인이 "사용자 생성 실패"로 막히던 결함 — email OR username 조회 검증.
 * 2. 관리자 updateUser 가 password 를 조용히 무시해 비밀번호 변경이
 *    no-op 이던 결함 — password_hash bcrypt 갱신 검증.
 */

jest.mock('../data/models/unified-database', () => ({
    getPool: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// bcryptjs 의 export 는 재정의 불가라 spyOn 대신 실제 구현을 감싼 jest.fn 으로 호출 횟수를 센다.
jest.mock('bcryptjs', () => {
    const actual = jest.requireActual('bcryptjs');
    return { ...actual, compare: jest.fn((plain: string, hash: string) => actual.compare(plain, hash)) };
});

import * as bcrypt from 'bcryptjs';
import { getUserManager } from '../data/user-manager';
import { getPool } from '../data/models/unified-database';

interface QueryRecord {
    sql: string;
    params?: unknown[];
}

const USER_ROW = {
    id: '92',
    username: 'Rocky',
    password_hash: 'hash-placeholder',
    email: 'rockyhan@openmake.cc',
    role: 'user',
    is_active: true,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    last_login: null,
};

describe('UserManager 계정 조회·비밀번호 변경', () => {
    let manager: ReturnType<typeof getUserManager>;
    let queries: QueryRecord[];
    let mockQuery: jest.Mock;

    beforeEach(() => {
        queries = [];
        mockQuery = jest.fn(async (sql: string, params?: unknown[]) => {
            queries.push({ sql, params });
            if (sql.startsWith('UPDATE users')) return { rowCount: 1, rows: [] };
            if (sql.startsWith('SELECT * FROM users')) return { rowCount: 1, rows: [USER_ROW] };
            return { rowCount: 0, rows: [] };
        });
        (getPool as jest.Mock).mockReturnValue({ query: mockQuery });
        manager = getUserManager();
    });

    describe('getUserByEmail', () => {
        test('email 일치 + username 폴백으로 조회해야 한다 (username 변경 계정의 OAuth 로그인 차단 방지)', async () => {
            await manager.getUserByEmail('rockyhan@openmake.cc');
            const lookup = queries.find(q => q.sql.trimStart().startsWith('SELECT * FROM users'));
            expect(lookup).toBeDefined();
            expect(lookup!.sql).toContain('email = $1');
            expect(lookup!.sql).toContain('username = $1');
            expect(lookup!.params).toEqual(['rockyhan@openmake.cc']);
        });

        test('username 폴백은 email 이 빈 행만 인정하고 결정적으로 1행을 선택해야 한다 (계정 탈취 차단)', async () => {
            // email 은 UNIQUE 가 아님 — 타인 계정이 username 만 이 email 로 등록돼 있어도
            // (email 컬럼에 다른 주소 보유) OAuth 로그인이 그 계정에 바인딩되면 안 된다.
            await manager.getUserByEmail('victim@example.com');
            const lookup = queries.find(q => q.sql.trimStart().startsWith('SELECT * FROM users'));
            expect(lookup!.sql).toMatch(/username = \$1 AND \(email IS NULL OR email = ''\)/);
            expect(lookup!.sql).toContain('ORDER BY');
            expect(lookup!.sql).toContain('LIMIT 1');
        });

        test('username≠email 계정도 email 컬럼 값으로 반환해야 한다', async () => {
            const user = await manager.getUserByEmail('rockyhan@openmake.cc');
            expect(user).not.toBeNull();
            expect(user!.id).toBe('92');
            expect(user!.email).toBe('rockyhan@openmake.cc');
        });

        test('email 컬럼이 NULL 인 레거시 행은 username 으로 폴백한다', async () => {
            mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
                queries.push({ sql, params });
                return { rowCount: 1, rows: [{ ...USER_ROW, email: null, username: 'legacy@example.com' }] };
            });
            const user = await manager.getUserByEmail('legacy@example.com');
            expect(user!.email).toBe('legacy@example.com');
        });
    });

    describe('updateUser — password', () => {
        test('password 전달 시 password_hash 를 bcrypt 해시로 갱신해야 한다', async () => {
            await manager.updateUser('92', { password: 'new-secret-1' });
            const update = queries.find(q => q.sql.startsWith('UPDATE users'));
            expect(update).toBeDefined();
            expect(update!.sql).toContain('password_hash');
            // SET 절 파라미터 중 bcrypt 해시(평문 아님)가 실려야 한다
            const hashed = (update!.params as string[]).find(p => typeof p === 'string' && p.startsWith('$2'));
            expect(hashed).toBeDefined();
            expect(hashed).not.toBe('new-secret-1');
            expect(await bcrypt.compare('new-secret-1', hashed!)).toBe(true);
        });

        test('password 미전달 시 password_hash 를 건드리지 않아야 한다', async () => {
            await manager.updateUser('92', { email: 'x@example.com' });
            const update = queries.find(q => q.sql.startsWith('UPDATE users'));
            expect(update!.sql).not.toContain('password_hash');
            expect(update!.sql).not.toContain('tokens_valid_after');
        });

        // 보안 점검 A2 — 비밀번호와 토큰 무효화 기준 시각을 한 UPDATE 로 쓴다(둘 중 하나만 반영되는 상태 없음).
        test('password 전달 시 같은 UPDATE 에 tokens_valid_after(지금)를 함께 쓴다', async () => {
            const before = Date.now();
            await manager.updateUser('92', { password: 'new-secret-1' });
            const updates = queries.filter(q => q.sql.startsWith('UPDATE users'));
            expect(updates).toHaveLength(1);
            expect(updates[0].sql).toContain('password_hash');
            const m = updates[0].sql.match(/tokens_valid_after = \$(\d+)/);
            expect(m).not.toBeNull();
            const at = (updates[0].params as unknown[])[Number(m![1]) - 1];
            expect(at).toBeInstanceOf(Date);
            expect((at as Date).getTime()).toBeGreaterThanOrEqual(before);
        });
    });

    // 보안 점검 A9 — 미존재 계정도 bcrypt.compare 를 1회 수행해 응답 시간으로 계정 존재를 구분하지 못하게 한다.
    describe('authenticate — 미존재 계정 타이밍 균일화', () => {
        const compareMock = bcrypt.compare as unknown as jest.Mock;
        beforeEach(() => compareMock.mockClear());

        test('조회 행이 없어도 bcrypt.compare 를 같은 rounds 의 더미 해시로 1회 수행하고 null 을 돌려준다', async () => {
            mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
                queries.push({ sql, params });
                return { rowCount: 0, rows: [] };
            });
            const compareSpy = compareMock;
            await expect(manager.authenticate('nobody@example.com', 'some-password-1')).resolves.toBeNull();
            expect(compareSpy).toHaveBeenCalledTimes(1);
            const [plain, hash] = compareSpy.mock.calls[0] as [string, string];
            expect(plain).toBe('some-password-1');
            expect(bcrypt.getRounds(hash)).toBe(12);
        });

        test('존재하는 계정의 비밀번호 비교도 1회(회귀)', async () => {
            const compareSpy = compareMock;
            await expect(manager.authenticate('rockyhan@openmake.cc', 'wrong-password')).resolves.toBeNull();
            expect(compareSpy).toHaveBeenCalledTimes(1);
            expect(compareSpy.mock.calls[0][1]).toBe('hash-placeholder');
        });
    });

    describe('changePassword — 토큰 무효화 원자성', () => {
        test('한 UPDATE 에 password_hash 와 tokens_valid_after 를 함께 쓴다', async () => {
            const before = Date.now();
            await expect(manager.changePassword('92', 'new-secret-1')).resolves.toBe(true);
            const updates = queries.filter(q => q.sql.startsWith('UPDATE users'));
            expect(updates).toHaveLength(1);
            expect(updates[0].sql).toBe('UPDATE users SET password_hash = $1, updated_at = $2, tokens_valid_after = $3 WHERE id = $4');
            const [hash, , at, id] = updates[0].params as [string, string, Date, string];
            expect(await bcrypt.compare('new-secret-1', hash)).toBe(true);
            expect(at).toBeInstanceOf(Date);
            expect(at.getTime()).toBeGreaterThanOrEqual(before);
            expect(id).toBe('92');
        });

        test('UPDATE 가 실패하면(예: 194 미적용) 던지고 다른 UPDATE 로 비밀번호만 바꾸지 않는다', async () => {
            mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
                queries.push({ sql, params });
                if (sql.startsWith('UPDATE users')) throw Object.assign(new Error('column "tokens_valid_after" does not exist'), { code: '42703' });
                return { rowCount: 0, rows: [] };
            });
            await expect(manager.changePassword('92', 'new-secret-1')).rejects.toThrow('tokens_valid_after');
            expect(queries.filter(q => q.sql.startsWith('UPDATE users'))).toHaveLength(1);
        });
    });
});
