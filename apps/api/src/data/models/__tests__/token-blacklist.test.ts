/**
 * token_blacklist reason(보안 점검 A7) — 회전('rotated')과 그 밖 폐기('revoked')를 구분해 저장한다.
 * refresh 재사용 탐지는 'rotated' 만 본다. 한 번 rotated 로 기록된 jti 는 뒤의 로그아웃(revoked)이 덮어쓰지 않는다.
 */
const mockQuery = jest.fn();
jest.mock('../unified-database', () => ({ getPool: () => ({ query: (...a: unknown[]) => mockQuery(...a) }) }));
jest.mock('../../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { getTokenBlacklist, resetTokenBlacklist } from '../token-blacklist';

const sqlCalls = (): string[] => mockQuery.mock.calls.map((c) => String(c[0]).replace(/\s+/g, ' ').trim());
const lastCall = (): [string, unknown[]] => {
    const c = mockQuery.mock.calls[mockQuery.mock.calls.length - 1];
    return [String(c[0]).replace(/\s+/g, ' ').trim(), c[1] as unknown[]];
};

beforeEach(() => {
    resetTokenBlacklist();
    mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
});
afterAll(() => resetTokenBlacklist());

describe('token_blacklist 테이블 보장', () => {
    it('CREATE 에 reason 열을 두고, 기존 테이블에도 ADD COLUMN IF NOT EXISTS 로 멱등 추가한다', async () => {
        await getTokenBlacklist().getReason('j');
        const sql = sqlCalls();
        expect(sql.some((q) => q.startsWith('CREATE TABLE IF NOT EXISTS token_blacklist') && q.includes("reason TEXT NOT NULL DEFAULT 'revoked'"))).toBe(true);
        expect(sql).toContain("ALTER TABLE token_blacklist ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT 'revoked'");
    });
});

describe('add', () => {
    it("reason 생략 — 'revoked' 로 저장", async () => {
        await getTokenBlacklist().add('jti-1', 1234);
        const [sql, params] = lastCall();
        expect(sql).toContain('INSERT INTO token_blacklist (jti, expires_at, reason) VALUES ($1, $2, $3)');
        expect(params).toEqual(['jti-1', 1234, 'revoked']);
    });

    it("'rotated' 는 그대로, 충돌 시 한 번 rotated 면 유지한다", async () => {
        await getTokenBlacklist().add('jti-2', 5678, 'rotated');
        const [sql, params] = lastCall();
        expect(params).toEqual(['jti-2', 5678, 'rotated']);
        expect(sql).toContain(
            "ON CONFLICT (jti) DO UPDATE SET expires_at = EXCLUDED.expires_at, reason = CASE WHEN token_blacklist.reason = 'rotated' THEN 'rotated' ELSE EXCLUDED.reason END",
        );
    });
});

describe('getReason', () => {
    it('만료 전 행의 reason 을 돌려준다', async () => {
        const before = Date.now();
        mockQuery.mockImplementation(async (sql: string) =>
            sql.startsWith('SELECT reason') ? { rows: [{ reason: 'rotated' }] } : { rows: [] });
        await expect(getTokenBlacklist().getReason('jti-3')).resolves.toBe('rotated');
        const [sql, params] = lastCall();
        expect(sql).toBe('SELECT reason FROM token_blacklist WHERE jti = $1 AND expires_at > $2');
        expect(params[0]).toBe('jti-3');
        expect(params[1] as number).toBeGreaterThanOrEqual(before);
    });

    it('행이 없으면 null', async () => {
        await expect(getTokenBlacklist().getReason('none')).resolves.toBeNull();
    });

    it("알 수 없는 값은 'revoked' 로 본다(재사용 탐지 안 함)", async () => {
        mockQuery.mockImplementation(async (sql: string) =>
            sql.startsWith('SELECT reason') ? { rows: [{ reason: 'weird' }] } : { rows: [] });
        await expect(getTokenBlacklist().getReason('jti-4')).resolves.toBe('revoked');
    });
});
