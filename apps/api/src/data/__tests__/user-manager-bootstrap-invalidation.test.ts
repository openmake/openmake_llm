/**
 * 부팅 관리자 승격(ensureAdminUser) 시 기존 토큰 무효화(보안 점검 A11).
 *
 * DEFAULT_ADMIN_EMAIL·ADMIN_PASSWORD 로 기존 계정을 관리자로 올리거나 비밀번호를 덮어쓰면, 그 계정의 이전 토큰은
 * 같은 UPDATE 에서 tokens_valid_after = NOW() 로 끊는다. 부팅 순서상 이 단계는 마이그레이션 자동 적용보다 먼저라
 * 194 가 아직 없을 수 있다 — 그때(42703 undefined_column)는 열 없이 승격만 하고 부팅을 막지 않는다.
 */
const mockQuery = jest.fn();
jest.mock('../models/unified-database', () => ({
    getPool: () => ({ query: (...a: unknown[]) => mockQuery(...a) }),
}));
const mockConfig = { defaultAdminEmail: 'boss@example.com', adminPassword: 'Boot-Admin-Pw1!' };
jest.mock('../../config/env', () => {
    const actual = jest.requireActual('../../config/env');
    return { ...actual, getConfig: () => ({ ...actual.getConfig(), ...mockConfig }) };
});
jest.mock('bcryptjs', () => ({ hash: async () => 'hashed', compare: async () => false }));
const mockWarn = jest.fn();
jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: (...a: unknown[]) => mockWarn(...a), error: jest.fn(), debug: jest.fn() }),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

type Rows = { legacy: unknown[]; existing: unknown[] };

function route(rows: Rows, failInvalidation?: Error) {
    mockQuery.mockImplementation(async (sql: string) => {
        if (sql === 'SELECT id FROM users WHERE username = $1 AND role = $2') return { rows: rows.legacy, rowCount: rows.legacy.length };
        if (sql === 'SELECT id, role FROM users WHERE username = $1') return { rows: rows.existing, rowCount: rows.existing.length };
        if (failInvalidation && sql.includes('tokens_valid_after')) throw failInvalidation;
        return { rows: [], rowCount: 1 };
    });
}

async function boot(): Promise<void> {
    let mgr: { ensureReady(): Promise<void> } | undefined;
    jest.isolateModules(() => {
        mgr = (require('../user-manager') as typeof import('../user-manager')).getUserManager();
    });
    await mgr!.ensureReady();
}

const updates = (): string[] => mockQuery.mock.calls.map(([sql]) => sql as string).filter((sql) => sql.startsWith('UPDATE users SET'));

beforeEach(() => {
    mockQuery.mockReset();
    mockWarn.mockReset();
});

describe('ensureAdminUser — 승격·비밀번호 덮어쓰기 UPDATE 에 tokens_valid_after = NOW()', () => {
    it('이메일 계정만 있고 관리자가 아니면 관리자 승격 UPDATE 가 토큰도 끊는다', async () => {
        route({ legacy: [], existing: [{ id: 'u-1', role: 'user' }] });
        await boot();
        expect(updates()).toEqual([
            'UPDATE users SET role = $1, password_hash = $2, updated_at = $3, tokens_valid_after = NOW() WHERE username = $4',
        ]);
    });

    it('레거시 admin 과 이메일 계정이 함께 있으면(권한 이전) 이메일 계정 UPDATE 가 토큰도 끊는다', async () => {
        route({ legacy: [{ id: 'legacy' }], existing: [{ id: 'u-1', role: 'user' }] });
        await boot();
        expect(updates()).toEqual([
            'UPDATE users SET role = $1, password_hash = $2, updated_at = $3, tokens_valid_after = NOW() WHERE username = $4',
        ]);
    });

    it('레거시 admin 만 있으면(이메일로 이름 변경 + 비밀번호 덮어쓰기) 토큰도 끊는다', async () => {
        route({ legacy: [{ id: 'legacy' }], existing: [] });
        await boot();
        expect(updates()).toEqual([
            'UPDATE users SET username = $1, email = $2, password_hash = $3, updated_at = $4, tokens_valid_after = NOW() WHERE username = $5 AND role = $6',
        ]);
    });

    it('이미 관리자면 UPDATE 하지 않는다(매 부팅 무효화 없음)', async () => {
        route({ legacy: [], existing: [{ id: 'u-1', role: 'admin' }] });
        await boot();
        expect(updates()).toEqual([]);
    });
});

describe('ensureAdminUser — 194 미적용(부팅 순서상 마이그레이션 전)', () => {
    it('42703 이면 열 없이 같은 승격을 다시 실행하고 경고를 남긴다 — 부팅은 계속', async () => {
        route({ legacy: [], existing: [{ id: 'u-1', role: 'user' }] }, Object.assign(new Error('column "tokens_valid_after" does not exist'), { code: '42703' }));
        await expect(boot()).resolves.toBeUndefined();
        expect(updates()).toEqual([
            'UPDATE users SET role = $1, password_hash = $2, updated_at = $3, tokens_valid_after = NOW() WHERE username = $4',
            'UPDATE users SET role = $1, password_hash = $2, updated_at = $3 WHERE username = $4',
        ]);
        expect(mockWarn).toHaveBeenCalledTimes(1);
    });

    it('다른 DB 오류는 그대로 던진다(부팅 Fail-Fast 유지)', async () => {
        route({ legacy: [], existing: [{ id: 'u-1', role: 'user' }] }, Object.assign(new Error('connection lost'), { code: '08006' }));
        await expect(boot()).rejects.toThrow('connection lost');
        expect(updates()).toHaveLength(1);
    });
});
