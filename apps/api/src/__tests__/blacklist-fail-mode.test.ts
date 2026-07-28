import * as jwt from 'jsonwebtoken';

const mockHas = jest.fn();
const mockGetConfig = jest.fn();

jest.mock('../data/models/token-blacklist', () => ({
    getTokenBlacklist: () => ({ has: mockHas }),
}));

jest.mock('../config/env', () => {
    const actual = jest.requireActual('../config/env');
    return { ...actual, getConfig: mockGetConfig };
});

describe('verifyToken — BLACKLIST_FAIL_MODE', () => {
    const secret = 'x'.repeat(32);

    beforeAll(() => {
        process.env.JWT_SECRET = secret;
    });

    beforeEach(() => {
        mockHas.mockReset();
        mockGetConfig.mockReset();
    });

    test('access 토큰: failMode=open 이어도 DB 장애 시 거부 (access-only fail-safe)', async () => {
        mockGetConfig.mockReturnValue({ jwtSecret: secret, blacklistFailMode: 'open', nodeEnv: 'test' });
        mockHas.mockRejectedValue(new Error('DB down'));

        const { verifyToken } = await import('../auth/auth-core');
        const validToken = jwt.sign({ userId: 'u1', type: 'access' }, secret, { jwtid: 'jti-1', expiresIn: '15m' });
        const result = await verifyToken(validToken);
        // access 는 폐기 즉시성 우선 — failMode 와 무관하게 항상 거부
        expect(result).toBeNull();
    });

    test('refresh 토큰: failMode=open 이면 DB 장애 시 통과 (로그인 가용성 보존)', async () => {
        mockGetConfig.mockReturnValue({ jwtSecret: secret, blacklistFailMode: 'open', nodeEnv: 'test' });
        mockHas.mockRejectedValue(new Error('DB down'));

        const { verifyRefreshToken } = await import('../auth/auth-core');
        const refreshToken = jwt.sign({ userId: 'u1', type: 'refresh' }, secret, { jwtid: 'jti-r1', expiresIn: '7d' });
        const result = await verifyRefreshToken(refreshToken);
        // refresh 는 failMode 를 존중 — open 이면 통과해 로그인/재발급 경로 유지
        expect(result).not.toBeNull();
        expect(result?.userId).toBe('u1');
    });

    test('fail-safe: DB 장애 시 토큰 거부', async () => {
        mockGetConfig.mockReturnValue({ jwtSecret: secret, blacklistFailMode: 'safe', nodeEnv: 'test' });
        mockHas.mockRejectedValue(new Error('DB down'));

        const { verifyToken } = await import('../auth/auth-core');
        const validToken = jwt.sign({ userId: 'u1', type: 'access' }, secret, { jwtid: 'jti-1', expiresIn: '15m' });
        const result = await verifyToken(validToken);
        expect(result).toBeNull();
    });

    test('fail-safe + refresh 토큰: DB 장애 시 거부', async () => {
        mockGetConfig.mockReturnValue({ jwtSecret: secret, blacklistFailMode: 'safe', nodeEnv: 'test' });
        mockHas.mockRejectedValue(new Error('DB down'));

        const { verifyRefreshToken } = await import('../auth/auth-core');
        const refreshToken = jwt.sign({ userId: 'u1', type: 'refresh' }, secret, { jwtid: 'jti-2', expiresIn: '7d' });
        const result = await verifyRefreshToken(refreshToken);
        expect(result).toBeNull();
    });

    test('정상 DB: 블랙리스트 미포함 토큰은 모드와 무관히 통과', async () => {
        mockGetConfig.mockReturnValue({ jwtSecret: secret, blacklistFailMode: 'safe', nodeEnv: 'test' });
        mockHas.mockResolvedValue(false);

        const { verifyToken } = await import('../auth/auth-core');
        const validToken = jwt.sign({ userId: 'u2', type: 'access' }, secret, { jwtid: 'jti-3', expiresIn: '15m' });
        const result = await verifyToken(validToken);
        expect(result).not.toBeNull();
        expect(result?.userId).toBe('u2');
    });
});
