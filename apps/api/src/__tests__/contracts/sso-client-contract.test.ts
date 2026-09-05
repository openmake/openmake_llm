/**
 * 웹 SSO 클라이언트(config/security.ts SSO_CLIENTS, 예: bench) — 동작 테스트.
 *
 * mobile-auth-contract 와 같은 무DB 구성. optionalAuth 모의는 x-test-user 헤더로 로그인 상태를 흉내낸다.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { PublicUser } from '../../data/user-manager';
import { expectContract } from './contract-validator';

const sampleUser: PublicUser = {
    id: 'u1',
    email: 'riskpw@openmake.cc',
    role: 'user',
    created_at: '2026-08-16T00:00:00.000Z',
    is_active: true,
};

const cookieSpies = {
    setTokenCookie: jest.fn(),
    setRefreshTokenCookie: jest.fn(),
};

jest.mock('../../auth', () => ({
    requireAuth: (req: Request, _res: Response, next: NextFunction) => {
        req.user = sampleUser;
        next();
    },
    optionalAuth: (req: Request, _res: Response, next: NextFunction) => {
        const h = req.headers['x-test-user'];
        if (h === 'user') req.user = sampleUser;
        if (h === 'guest') req.user = { ...sampleUser, id: 'g1', role: 'guest' };
        next();
    },
    extractToken: () => null,
    blacklistToken: jest.fn(),
    setTokenCookie: (...args: unknown[]) => cookieSpies.setTokenCookie(...args),
    clearTokenCookie: jest.fn(),
    setRefreshTokenCookie: (...args: unknown[]) => cookieSpies.setRefreshTokenCookie(...args),
    generateRefreshToken: () => 'new-refresh-token',
    generateToken: () => 'new-access-token',
    verifyRefreshToken: jest.fn(),
    removeSessionFromMap: jest.fn(),
}));

const mockAuthService = {
    login: jest.fn(),
    getAvailableProviders: () => ['google'],
};
jest.mock('../../services/AuthService', () => ({
    getAuthService: () => mockAuthService,
}));

const mockUserManager = { getUserById: jest.fn() };
jest.mock('../../data/user-manager', () => ({
    getUserManager: () => mockUserManager,
}));

jest.mock('../../services/AuditService', () => ({
    getAuditService: () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }),
}));

// 무DB — helpers 의 oauth_states 접근은 전부 인메모리 폴백으로 유도
jest.mock('../../data/models/unified-database', () => ({
    getPool: () => {
        throw new Error('no db in test');
    },
}));

jest.mock('../../middlewares/rate-limiters', () => ({
    authLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

jest.mock('../../mcp/lifecycle-hooks', () => ({
    emitUserLogout: jest.fn(),
}));

const testConfig = {
    port: 0,
    cookieSecure: false,
    csrfProtection: 'off',
    storageBackend: 'memory',
    googleClientId: 'gid',
    googleClientSecret: 'gsecret',
    oauthRedirectUri: '',
};
jest.mock('../../config/env', () => ({ getConfig: () => testConfig }));
jest.mock('../../config', () => ({ getConfig: () => testConfig }));

import { createAuthController } from '../../controllers/auth.controller';
import { generateSecureState, validateAndConsumeState } from '../../controllers/auth-oauth-helpers';
import { SSO_CLIENTS } from '../../config/security';

describe('웹 SSO 클라이언트 (sso/authorize)', () => {
    let app: express.Express;

    beforeAll(() => {
        app = express();
        app.use(cookieParser());
        app.use(express.json());
        app.use('/api/auth', createAuthController(0));
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockUserManager.getUserById.mockResolvedValue(sampleUser);
    });

    test('알 수 없는 client → 400', async () => {
        const r = await request(app).get('/api/auth/sso/authorize?client=evil');
        expect(r.status).toBe(400);
    });

    test('client 누락 → 400', async () => {
        const r = await request(app).get('/api/auth/sso/authorize');
        expect(r.status).toBe(400);
    });

    test('로그인 안 됨 → /login?client=bench 로 리다이렉트', async () => {
        const r = await request(app).get('/api/auth/sso/authorize?client=bench');
        expect(r.status).toBe(302);
        expect(r.headers.location).toBe('/login?client=bench');
    });

    test('게스트 세션 → /login 으로 (게스트는 SSO 불가)', async () => {
        const r = await request(app).get('/api/auth/sso/authorize?client=bench').set('x-test-user', 'guest');
        expect(r.status).toBe(302);
        expect(r.headers.location).toBe('/login?client=bench');
    });

    test('로그인 됨 → 등록된 redirect URI 로 code 전달, code 는 exchange 에서 일회성', async () => {
        const r = await request(app).get('/api/auth/sso/authorize?client=bench').set('x-test-user', 'user');
        expect(r.status).toBe(302);
        const loc = new URL(r.headers.location);
        expect(`${loc.origin}${loc.pathname}`).toBe(SSO_CLIENTS.bench.redirectUri);
        const code = loc.searchParams.get('code');
        expect(code).toMatch(/^[0-9a-f]{64}$/);

        const ex = await request(app).post('/api/auth/mobile/exchange').send({ code });
        expect(ex.status).toBe(200);
        expect(ex.body.data.user.id).toBe('u1');
        expect(ex.body.data.token).toBe('new-access-token');

        const again = await request(app).post('/api/auth/mobile/exchange').send({ code });
        expect(again.status).toBe(401);
    });

    test('OAuth 시작 ?client=bench → state 에 sso:bench 귀속 (콜백 분기용)', async () => {
        const r = await request(app).get('/api/auth/login/google?client=bench');
        expect(r.status).toBe(302);
        const state = new URL(r.headers.location).searchParams.get('state');
        expect(state).toBeTruthy();
        const consumed = await validateAndConsumeState(state as string, 'google');
        expect(consumed).toEqual({ valid: true, client: 'sso:bench' });
    });

    test('OAuth 시작 client 미지정 → 웹(null) 유지', async () => {
        const state = await generateSecureState('google');
        expect(await validateAndConsumeState(state, 'google')).toEqual({ valid: true, client: null });
    });
});
