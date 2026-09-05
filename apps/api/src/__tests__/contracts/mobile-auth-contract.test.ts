/**
 * 모바일 인증 (iOS 축 2) — 동작 + 응답 계약 테스트.
 *
 * 무DB — pg 는 throw mock (OAuth state 는 인메모리 폴백 경로), exchange code 는
 * 실제 MemoryStore(KVStore) 로 일회성 시맨틱을 검증한다. validation 은 real(zod 400 검증).
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
    optionalAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
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
import {
    generateSecureState,
    validateAndConsumeState,
    issueMobileExchangeRedirect,
} from '../../controllers/auth-oauth-helpers';
import { verifyRefreshToken, blacklistToken } from '../../auth';

describe('모바일 인증 (iOS 축 2)', () => {
    let app: express.Express;

    beforeAll(() => {
        app = express();
        app.use(cookieParser());
        app.use(express.json());
        app.use('/api/auth', createAuthController(0));
    });

    beforeEach(() => {
        jest.clearAllMocks();
        (verifyRefreshToken as jest.Mock).mockResolvedValue({ userId: 'u1' });
        mockUserManager.getUserById.mockResolvedValue(sampleUser);
    });

    describe('refresh body 모드', () => {
        test('body.refreshToken → 새 refreshToken body 반환 + 쿠키 미설정', async () => {
            const r = await request(app).post('/api/auth/refresh').send({ refreshToken: 'mobile-rt' });
            expect(r.status).toBe(200);
            expect(r.body.data.refreshToken).toBe('new-refresh-token');
            expect(r.headers['set-cookie']).toBeUndefined();
            expect(cookieSpies.setTokenCookie).not.toHaveBeenCalled();
            expect(cookieSpies.setRefreshTokenCookie).not.toHaveBeenCalled();
            expect(blacklistToken).toHaveBeenCalledWith('mobile-rt'); // rotation
            expectContract('/api/auth/refresh', 'post', '200', r.body);
        });

        test('쿠키 모드 기존 동작 무변경 — body 에 refreshToken 없음 + 쿠키 회전', async () => {
            const r = await request(app).post('/api/auth/refresh').set('Cookie', ['refresh_token=web-rt']);
            expect(r.status).toBe(200);
            expect(r.body.data.refreshToken).toBeUndefined();
            expect(cookieSpies.setTokenCookie).toHaveBeenCalled();
            expect(cookieSpies.setRefreshTokenCookie).toHaveBeenCalled();
            expectContract('/api/auth/refresh', 'post', '200', r.body);
        });

        test('무효 refresh token → 401', async () => {
            (verifyRefreshToken as jest.Mock).mockResolvedValue(null);
            const r = await request(app).post('/api/auth/refresh').send({ refreshToken: 'bad' });
            expect(r.status).toBe(401);
            expectContract('/api/auth/refresh', 'post', '401', r.body);
        });
    });

    describe('login returnRefreshToken', () => {
        test('true → refreshToken body 포함 + 쿠키 미설정', async () => {
            mockAuthService.login.mockResolvedValue({ success: true, token: 'at', user: sampleUser });
            const r = await request(app)
                .post('/api/auth/login')
                .send({ email: 'riskpw@openmake.cc', password: 'pw', returnRefreshToken: true });
            expect(r.status).toBe(200);
            expect(r.body.data.refreshToken).toBe('new-refresh-token');
            expect(cookieSpies.setTokenCookie).not.toHaveBeenCalled();
            expect(cookieSpies.setRefreshTokenCookie).not.toHaveBeenCalled();
            expectContract('/api/auth/login', 'post', '200', r.body);
        });

        test('미지정 → 기존 쿠키 동작 무변경', async () => {
            mockAuthService.login.mockResolvedValue({ success: true, token: 'at', user: sampleUser });
            const r = await request(app)
                .post('/api/auth/login')
                .send({ email: 'riskpw@openmake.cc', password: 'pw' });
            expect(r.status).toBe(200);
            expect(r.body.data.refreshToken).toBeUndefined();
            expect(cookieSpies.setTokenCookie).toHaveBeenCalled();
            expect(cookieSpies.setRefreshTokenCookie).toHaveBeenCalled();
        });
    });

    describe('logout body refreshToken', () => {
        test('body.refreshToken 블랙리스트 처리', async () => {
            const r = await request(app).post('/api/auth/logout').send({ refreshToken: 'mobile-rt' });
            expect(r.status).toBe(200);
            expect(blacklistToken).toHaveBeenCalledWith('mobile-rt');
        });
    });

    describe('OAuth state client 귀속 (인메모리 폴백 경로)', () => {
        test('client=ios 저장 → 소비 시 client 반환 + 일회성', async () => {
            const state = await generateSecureState('google', 'ios');
            const first = await validateAndConsumeState(state, 'google');
            expect(first).toEqual({ valid: true, client: 'ios' });
            // 재사용 불가
            const second = await validateAndConsumeState(state, 'google');
            expect(second.valid).toBe(false);
        });

        test('client 미지정 = 웹 (null)', async () => {
            const state = await generateSecureState('google');
            expect(await validateAndConsumeState(state, 'google')).toEqual({ valid: true, client: null });
        });
    });

    describe('mobile exchange', () => {
        /** issueMobileExchangeRedirect 로 실제 발급된 code 를 캡처 */
        async function issueCode(): Promise<string> {
            const redirect = jest.fn();
            await issueMobileExchangeRedirect(
                { redirect } as unknown as Response, 'u1', 'google');
            const target: string = redirect.mock.calls[0][0];
            expect(target).toMatch(/^openmake:\/\/auth\/callback\?code=[0-9a-f]{64}$/);
            return target.split('code=')[1];
        }

        test('정상 교환 → 토큰 3종 body 반환, 쿠키 미설정', async () => {
            const code = await issueCode();
            const r = await request(app).post('/api/auth/mobile/exchange').send({ code });
            expect(r.status).toBe(200);
            expect(r.body.data.token).toBe('new-access-token');
            expect(r.body.data.refreshToken).toBe('new-refresh-token');
            expect(r.body.data.user.id).toBe('u1');
            expect(r.headers['set-cookie']).toBeUndefined();
            expectContract('/api/auth/mobile/exchange', 'post', '200', r.body);
        });

        test('코드 재사용 → 401 (일회성)', async () => {
            const code = await issueCode();
            await request(app).post('/api/auth/mobile/exchange').send({ code });
            const r = await request(app).post('/api/auth/mobile/exchange').send({ code });
            expect(r.status).toBe(401);
            expectContract('/api/auth/mobile/exchange', 'post', '401', r.body);
        });

        test('존재하지 않는 코드 → 401', async () => {
            const r = await request(app)
                .post('/api/auth/mobile/exchange')
                .send({ code: 'f'.repeat(64) });
            expect(r.status).toBe(401);
            expectContract('/api/auth/mobile/exchange', 'post', '401', r.body);
        });

        test('형식 오류 코드 → 400 (zod)', async () => {
            const r = await request(app).post('/api/auth/mobile/exchange').send({ code: 'short' });
            expect(r.status).toBe(400);
            expectContract('/api/auth/mobile/exchange', 'post', '400', r.body);
        });

        test('TTL 만료 코드 → 401', async () => {
            const { getKeyValueStore } = await import('../../storage');
            const { MOBILE_AUTH } = await import('../../config/security');
            const code = 'a'.repeat(64);
            await getKeyValueStore().set(
                MOBILE_AUTH.EXCHANGE_KEY_PREFIX + code,
                { userId: 'u1', provider: 'google' },
                10, // 10ms 만료
            );
            await new Promise((resolve) => setTimeout(resolve, 30));
            const r = await request(app).post('/api/auth/mobile/exchange').send({ code });
            expect(r.status).toBe(401);
        });

        test('비활성 사용자 → 401', async () => {
            mockUserManager.getUserById.mockResolvedValue({ ...sampleUser, is_active: false });
            const code = await issueCode();
            const r = await request(app).post('/api/auth/mobile/exchange').send({ code });
            expect(r.status).toBe(401);
        });
    });
});
