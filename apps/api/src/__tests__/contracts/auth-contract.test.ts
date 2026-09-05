/**
 * Auth 응답 계약 테스트 — 실핸들러(auth.controller) 응답을 openapi.v1.json 으로 검증.
 *
 * 무DB — AuthService/user-manager/auth 토큰 유틸은 mock, OAuth 서브컨트롤러는 stub
 * (따라서 /api/auth/providers 는 fixture 검증). 기존 라우트 테스트 관행을 따른다.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { PublicUser } from '../../data/user-manager';
import { expectContract, validateContract } from './contract-validator';

const sampleUser: PublicUser = {
    id: 'u1',
    email: 'riskpw@openmake.cc',
    role: 'user',
    created_at: '2026-08-16T00:00:00.000Z',
    is_active: true,
};

let currentUser: PublicUser | null = null;

jest.mock('../../auth', () => ({
    requireAuth: (req: Request, _res: Response, next: NextFunction) => {
        req.user = currentUser ?? sampleUser;
        next();
    },
    optionalAuth: (req: Request, _res: Response, next: NextFunction) => {
        if (currentUser) req.user = currentUser;
        next();
    },
    extractToken: () => null,
    blacklistToken: jest.fn(),
    setTokenCookie: jest.fn(),
    clearTokenCookie: jest.fn(),
    setRefreshTokenCookie: jest.fn(),
    generateRefreshToken: () => 'new-refresh-token',
    generateToken: () => 'new-access-token',
    verifyRefreshToken: jest.fn(),
    removeSessionFromMap: jest.fn(),
}));

const mockAuthService = {
    login: jest.fn(),
    register: jest.fn(),
};
jest.mock('../../services/AuthService', () => ({
    getAuthService: () => mockAuthService,
}));

const mockUserManager = { getUserById: jest.fn() };
jest.mock('../../data/user-manager', () => ({
    getUserManager: () => mockUserManager,
}));

// login 실패 경로가 동적 import 로 로드 — 실 pg Pool 생성 방지 (무DB 원칙)
jest.mock('../../services/AuditService', () => ({
    getAuditService: () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }),
}));

jest.mock('../../controllers/auth-oauth.controller', () => ({
    createAuthOAuthController: () => {
        const { Router } = jest.requireActual('express');
        return Router();
    },
    stopOAuthCleanup: jest.fn(),
}));

jest.mock('../../middlewares/validation', () => ({
    validate: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
jest.mock('../../schemas', () => ({
    loginSchema: {},
    registerSchema: {},
    changePasswordSchema: {},
}));
jest.mock('../../config/env', () => ({
    getConfig: () => ({ cookieSecure: false, csrfProtection: 'off', port: 52416 }),
}));
jest.mock('../../config', () => ({
    getConfig: () => ({ cookieSecure: false, csrfProtection: 'off' }),
}));

import { createAuthController } from '../../controllers/auth.controller';
import { csrfTokenIssuer } from '../../middlewares/csrf-protection';
import { verifyRefreshToken } from '../../auth';
import { success } from '../../utils/api-response';

describe('Auth 응답 계약', () => {
    let app: express.Express;

    beforeAll(() => {
        app = express();
        app.use(cookieParser());
        app.use(express.json());
        app.use('/api/auth', createAuthController(52416));
        app.get('/api/csrf-token', csrfTokenIssuer);
    });

    beforeEach(() => {
        currentUser = null;
        jest.clearAllMocks();
    });

    test('POST /api/auth/login 200', async () => {
        mockAuthService.login.mockResolvedValue({ success: true, token: 'at', user: sampleUser });
        const r = await request(app).post('/api/auth/login').send({ email: 'a@b.c', password: 'x' });
        expect(r.status).toBe(200);
        expectContract('/api/auth/login', 'post', '200', r.body);
    });

    test('POST /api/auth/login 401 (실패 envelope)', async () => {
        mockAuthService.login.mockResolvedValue({ success: false, error: '인증 실패' });
        const r = await request(app).post('/api/auth/login').send({ email: 'a@b.c', password: 'x' });
        expect(r.status).toBe(401);
        expectContract('/api/auth/login', 'post', '401', r.body);
    });

    test('GET /api/auth/me 200 (인증 사용자)', async () => {
        currentUser = sampleUser;
        const r = await request(app).get('/api/auth/me');
        expect(r.status).toBe(200);
        expectContract('/api/auth/me', 'get', '200', r.body);
    });

    test('GET /api/auth/me 200 (순수 게스트 — user:null 규약)', async () => {
        const r = await request(app).get('/api/auth/me');
        expect(r.status).toBe(200);
        expect(r.body.data.user).toBeNull();
        expectContract('/api/auth/me', 'get', '200', r.body);
    });

    test('GET /api/auth/me 401 (무효 토큰 규약)', async () => {
        const r = await request(app).get('/api/auth/me').set('Authorization', 'Bearer expired');
        expect(r.status).toBe(401);
        expectContract('/api/auth/me', 'get', '401', r.body);
    });

    test('POST /api/auth/refresh 200 (rotation)', async () => {
        (verifyRefreshToken as jest.Mock).mockResolvedValue({ userId: 'u1' });
        mockUserManager.getUserById.mockResolvedValue(sampleUser);
        const r = await request(app).post('/api/auth/refresh').set('Cookie', ['refresh_token=abc']);
        expect(r.status).toBe(200);
        expectContract('/api/auth/refresh', 'post', '200', r.body);
    });

    test('POST /api/auth/refresh 401 (쿠키 없음)', async () => {
        const r = await request(app).post('/api/auth/refresh');
        expect(r.status).toBe(401);
        expectContract('/api/auth/refresh', 'post', '401', r.body);
    });

    test('POST /api/auth/logout 200', async () => {
        currentUser = sampleUser;
        const r = await request(app).post('/api/auth/logout');
        expect(r.status).toBe(200);
        expectContract('/api/auth/logout', 'post', '200', r.body);
    });

    test('GET /api/csrf-token 200 (raw JSON — envelope 미적용)', async () => {
        const r = await request(app).get('/api/csrf-token');
        expect(r.status).toBe(200);
        expectContract('/api/csrf-token', 'get', '200', r.body);
    });

    test('GET /api/auth/providers 200 — fixture 검증 (OAuth 컨트롤러 stub)', () => {
        const body = success({ providers: ['google', 'kakao'] });
        expect(validateContract('/api/auth/providers', 'get', '200', body).valid).toBe(true);
    });
});
