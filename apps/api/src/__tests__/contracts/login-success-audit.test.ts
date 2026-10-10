/**
 * 성공 로그인 감사 기록(login.succeeded) — 새 세션이 만들어지는 경로 전부에서 한 행씩 남는다.
 *
 * 무DB — pg 는 throw mock (OAuth state 는 인메모리 폴백 경로), exchange code 는 실제 MemoryStore.
 * 대상: 비밀번호 로그인(쿠키·모바일 body), OAuth 웹 콜백, exchange code 교환. 토큰 갱신(refresh)은 제외.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { PublicUser } from '../../data/user-manager';

const sampleUser: PublicUser = {
    id: 'u1',
    email: 'riskpw@openmake.cc',
    role: 'user',
    created_at: '2026-08-16T00:00:00.000Z',
    is_active: true,
};

jest.mock('../../auth', () => ({
    requireAuth: (req: Request, _res: Response, next: NextFunction) => {
        req.user = sampleUser;
        next();
    },
    optionalAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
    extractToken: () => null,
    blacklistToken: jest.fn(),
    setTokenCookie: jest.fn(),
    clearTokenCookie: jest.fn(),
    setRefreshTokenCookie: jest.fn(),
    generateRefreshToken: () => 'SECRET-REFRESH-TOKEN',
    generateToken: () => 'SECRET-ACCESS-TOKEN',
    verifyRefreshToken: jest.fn(),
    removeSessionFromMap: jest.fn(),
}));

const mockAuthService = {
    login: jest.fn(),
    findOrCreateOAuthUser: jest.fn(),
    getAvailableProviders: () => ['google'],
};
jest.mock('../../services/AuthService', () => ({
    getAuthService: () => mockAuthService,
}));

const mockUserManager = { getUserById: jest.fn() };
jest.mock('../../data/user-manager', () => ({
    getUserManager: () => mockUserManager,
}));

const mockLogAudit = jest.fn();
jest.mock('../../services/AuditService', () => ({
    getAuditService: () => ({ logAudit: mockLogAudit }),
}));

jest.mock('../../data/models/unified-database', () => ({
    getPool: () => {
        throw new Error('no db in test');
    },
}));

jest.mock('../../middlewares/rate-limiters', () => ({
    authLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
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
import { generateSecureState, issueMobileExchangeRedirect } from '../../controllers/auth-oauth-helpers';
import { verifyRefreshToken } from '../../auth';

/** fire-and-forget 기록이 끝날 때까지 이벤트 루프를 몇 바퀴 돌린다 */
async function flush(): Promise<void> {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}

function succeededCalls(): Array<Record<string, unknown>> {
    return mockLogAudit.mock.calls.map((c) => c[0]).filter((a) => a.action === 'login.succeeded');
}

describe('성공 로그인 감사 기록 (login.succeeded)', () => {
    let app: express.Express;
    const realFetch = global.fetch;

    beforeAll(() => {
        app = express();
        app.use(cookieParser());
        app.use(express.json());
        app.use('/api/auth', createAuthController(0));
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockLogAudit.mockResolvedValue(undefined);
        mockUserManager.getUserById.mockResolvedValue(sampleUser);
    });

    afterEach(() => {
        global.fetch = realFetch;
    });

    function mockGoogleFetch(): void {
        global.fetch = jest.fn()
            .mockResolvedValueOnce({ json: async () => ({ access_token: 'SECRET-PROVIDER-TOKEN' }) })
            .mockResolvedValueOnce({ json: async () => ({ email: sampleUser.email, email_verified: true }) }) as unknown as typeof fetch;
    }

    describe('비밀번호 로그인', () => {
        test('쿠키 모드 성공 → 사용자·IP·UA 와 method=password 를 남긴다', async () => {
            mockAuthService.login.mockResolvedValue({ success: true, token: 'SECRET-ACCESS-TOKEN', user: sampleUser });
            const r = await request(app)
                .post('/api/auth/login')
                .set('User-Agent', 'jest-agent')
                .send({ email: sampleUser.email, password: 'SECRET-PASSWORD' });
            expect(r.status).toBe(200);
            await flush();

            const calls = succeededCalls();
            expect(calls).toHaveLength(1);
            expect(calls[0]).toMatchObject({
                action: 'login.succeeded',
                userId: 'u1',
                resourceType: 'auth',
                details: { method: 'password' },
                userAgent: 'jest-agent',
                actor: { email: sampleUser.email, role: 'user' },
            });
            expect(typeof calls[0].ipAddress).toBe('string');
        });

        test('모바일 body 모드(returnRefreshToken) 성공도 한 번 남긴다', async () => {
            mockAuthService.login.mockResolvedValue({ success: true, token: 'SECRET-ACCESS-TOKEN', user: sampleUser });
            const r = await request(app)
                .post('/api/auth/login')
                .send({ email: sampleUser.email, password: 'SECRET-PASSWORD', returnRefreshToken: true });
            expect(r.status).toBe(200);
            await flush();
            expect(succeededCalls()).toHaveLength(1);
            expect(succeededCalls()[0].details).toEqual({ method: 'password' });
        });

        test('비밀번호·토큰은 기록에 들어가지 않는다', async () => {
            mockAuthService.login.mockResolvedValue({ success: true, token: 'SECRET-ACCESS-TOKEN', user: sampleUser });
            await request(app).post('/api/auth/login').send({ email: sampleUser.email, password: 'SECRET-PASSWORD' });
            await flush();
            expect(succeededCalls()).toHaveLength(1);
            expect(JSON.stringify(mockLogAudit.mock.calls)).not.toMatch(/SECRET-/);
        });

        test('실패 로그인은 login.failed 만 남긴다', async () => {
            mockAuthService.login.mockResolvedValue({ success: false, error: '이메일 또는 비밀번호가 올바르지 않습니다' });
            const r = await request(app).post('/api/auth/login').send({ email: sampleUser.email, password: 'SECRET-PASSWORD' });
            expect(r.status).toBe(401);
            await flush();
            expect(succeededCalls()).toHaveLength(0);
            expect(mockLogAudit.mock.calls.map((c) => c[0].action)).toEqual(['login.failed']);
        });

        test('기록이 실패해도 로그인은 성공한다', async () => {
            mockLogAudit.mockRejectedValue(new Error('db down'));
            mockAuthService.login.mockResolvedValue({ success: true, token: 'SECRET-ACCESS-TOKEN', user: sampleUser });
            const r = await request(app).post('/api/auth/login').send({ email: sampleUser.email, password: 'SECRET-PASSWORD' });
            await flush();
            expect(r.status).toBe(200);
            expect(mockLogAudit).toHaveBeenCalled();
        });
    });

    describe('OAuth 콜백', () => {
        test('웹(쿠키) 콜백 성공 → method=oauth, provider 를 남긴다', async () => {
            mockGoogleFetch();
            mockAuthService.findOrCreateOAuthUser.mockResolvedValue({ success: true, token: 'SECRET-ACCESS-TOKEN', user: sampleUser });
            const state = await generateSecureState('google');
            const r = await request(app).get('/api/auth/callback/google').query({ code: 'SECRET-OAUTH-CODE', state });
            expect(r.status).toBe(200);
            await flush();

            const calls = succeededCalls();
            expect(calls).toHaveLength(1);
            expect(calls[0]).toMatchObject({
                userId: 'u1',
                resourceType: 'auth',
                details: { method: 'oauth', provider: 'google' },
            });
            expect(JSON.stringify(mockLogAudit.mock.calls)).not.toMatch(/SECRET-/);
        });

        test('모바일 콜백은 코드만 발급한다 — 세션이 생기는 교환 시점에 남긴다', async () => {
            mockGoogleFetch();
            mockAuthService.findOrCreateOAuthUser.mockResolvedValue({ success: true, token: 'SECRET-ACCESS-TOKEN', user: sampleUser });
            const state = await generateSecureState('google', 'ios');
            const r = await request(app).get('/api/auth/callback/google').query({ code: 'SECRET-OAUTH-CODE', state });
            expect(r.status).toBe(302);
            await flush();
            expect(succeededCalls()).toHaveLength(0);
        });

        test('OAuth 실패는 남기지 않는다', async () => {
            mockGoogleFetch();
            mockAuthService.findOrCreateOAuthUser.mockResolvedValue({ success: false, error: '비활성 계정' });
            const state = await generateSecureState('google');
            await request(app).get('/api/auth/callback/google').query({ code: 'SECRET-OAUTH-CODE', state });
            await flush();
            expect(succeededCalls()).toHaveLength(0);
        });
    });

    describe('exchange code 교환', () => {
        async function issueCode(): Promise<string> {
            const redirect = jest.fn();
            await issueMobileExchangeRedirect({ redirect } as unknown as Response, 'u1', 'google');
            return (redirect.mock.calls[0][0] as string).split('code=')[1];
        }

        test('교환 성공 → method=exchange, provider 를 남긴다 (기존 auth.mobile_exchange 도 그대로)', async () => {
            const code = await issueCode();
            const r = await request(app).post('/api/auth/mobile/exchange').send({ code });
            expect(r.status).toBe(200);
            await flush();

            const calls = succeededCalls();
            expect(calls).toHaveLength(1);
            expect(calls[0]).toMatchObject({
                userId: 'u1',
                resourceType: 'auth',
                details: { method: 'exchange', provider: 'google' },
            });
            expect(mockLogAudit.mock.calls.map((c) => c[0].action).sort()).toEqual(['auth.mobile_exchange', 'login.succeeded']);
            expect(JSON.stringify(mockLogAudit.mock.calls)).not.toContain(code);
            expect(JSON.stringify(mockLogAudit.mock.calls)).not.toMatch(/SECRET-/);
        });

        test('교환 실패는 남기지 않는다', async () => {
            const r = await request(app).post('/api/auth/mobile/exchange').send({ code: 'f'.repeat(64) });
            expect(r.status).toBe(401);
            await flush();
            expect(succeededCalls()).toHaveLength(0);
        });
    });

    test('토큰 갱신(refresh)은 로그인으로 남기지 않는다', async () => {
        (verifyRefreshToken as jest.Mock).mockResolvedValue({ userId: 'u1' });
        const r = await request(app).post('/api/auth/refresh').send({ refreshToken: 'mobile-rt' });
        expect(r.status).toBe(200);
        await flush();
        expect(succeededCalls()).toHaveLength(0);
    });
});
