/**
 * 보안 점검 A4·A6 — 쿠키 모드 인증 응답과 로그아웃.
 *
 * A4: 웹(쿠키 모드) 로그인·refresh 응답 본문에 access 토큰을 싣지 않는다 — 토큰은 httpOnly 쿠키에만.
 *     모바일(returnRefreshToken / body.refreshToken)은 종전대로 body 로 받는다.
 * A6: /logout 은 access 토큰이 없거나 만료돼도 200 — refresh 토큰을 폐기하고 쿠키를 지운다.
 *     블랙리스트 기록은 응답 전에 끝낸다(await).
 *
 * 무DB — 실제 인증 미들웨어(optionalAuth/requireAuth)·쿠키 설정 함수를 쓰고, 블랙리스트 기록·
 * 사용자 조회·AuthService 만 mock 한다.
 */
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import type { PublicUser } from '../data/user-manager';

const sampleUser: PublicUser = {
    id: 'u1',
    email: 'cookie-mode@example.com',
    role: 'user',
    created_at: '2026-10-25T00:00:00.000Z',
    is_active: true,
};

const mockBlacklistToken = jest.fn();
const mockRemoveSessionFromMap = jest.fn();
const mockVerifyRefreshToken = jest.fn();
jest.mock('../auth', () => ({
    ...jest.requireActual('../auth'),
    blacklistToken: (...args: unknown[]) => mockBlacklistToken(...args),
    removeSessionFromMap: (...args: unknown[]) => mockRemoveSessionFromMap(...args),
    verifyRefreshToken: (...args: unknown[]) => mockVerifyRefreshToken(...args),
    generateRefreshToken: () => 'new-refresh-token',
    generateToken: () => 'new-access-token',
}));

// 미들웨어의 verifyToken 이 블랙리스트를 조회한다 — DB 대신 빈 목록
jest.mock('../data/models/token-blacklist', () => ({
    getTokenBlacklist: () => ({ has: async () => false, add: async () => undefined }),
}));

const mockUserManager = { getUserById: jest.fn() };
jest.mock('../data/user-manager', () => ({
    ...jest.requireActual('../data/user-manager'),
    getUserManager: () => mockUserManager,
}));

const mockAuthService = { login: jest.fn(), register: jest.fn(), changePassword: jest.fn() };
jest.mock('../services/AuthService', () => ({ getAuthService: () => mockAuthService }));

jest.mock('../services/AuditService', () => ({
    getAuditService: () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }),
}));

jest.mock('../controllers/auth-oauth.controller', () => ({
    createAuthOAuthController: () => {
        const { Router } = jest.requireActual('express');
        return Router();
    },
    stopOAuthCleanup: jest.fn(),
}));

import { createAuthController } from '../controllers/auth.controller';
import { getConfig } from '../config/env';

function setCookies(res: request.Response): string[] {
    const raw = res.headers['set-cookie'] as unknown;
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [String(raw)];
}

function cookieNamed(res: request.Response, name: string): string | undefined {
    return setCookies(res).find((c) => c.startsWith(`${name}=`));
}

/** 서명된 refresh 토큰 모양(로그아웃은 decode 만 한다) */
function refreshTokenFor(userId: string, jti: string): string {
    return jwt.sign({ userId, jti, type: 'refresh' }, getConfig().jwtSecret, { algorithm: 'HS256', expiresIn: '7d' });
}

/** 만료된 access 토큰 — 미들웨어 검증에서 떨어진다 */
function expiredAccessToken(): string {
    return jwt.sign(
        { userId: 'u1', email: sampleUser.email, role: 'user', jti: 'expired-access-jti', type: 'access', exp: Math.floor(Date.now() / 1000) - 60 },
        getConfig().jwtSecret,
        { algorithm: 'HS256' },
    );
}

describe('쿠키 모드 인증 응답 (A4) · 로그아웃 (A6)', () => {
    let app: express.Express;

    beforeAll(() => {
        app = express();
        app.use(cookieParser());
        app.use(express.json());
        app.use('/api/auth', createAuthController(0));
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockBlacklistToken.mockResolvedValue(true);
        mockAuthService.login.mockResolvedValue({ success: true, token: 'issued-access-token', user: sampleUser });
        mockVerifyRefreshToken.mockResolvedValue({ userId: 'u1' });
        mockUserManager.getUserById.mockResolvedValue(sampleUser);
    });

    describe('POST /login', () => {
        test('쿠키 모드 — 본문에 token 없음, access·refresh 쿠키 둘 다 설정', async () => {
            const r = await request(app).post('/api/auth/login').send({ email: sampleUser.email, password: 'pw' });
            expect(r.status).toBe(200);
            expect(r.body.data.token).toBeUndefined();
            expect(r.body.data.refreshToken).toBeUndefined();
            expect(r.body.data).toMatchObject({ success: true, user: { id: 'u1' } });
            expect(JSON.stringify(r.body)).not.toContain('issued-access-token');
            expect(cookieNamed(r, 'auth_token')).toContain('auth_token=issued-access-token');
            expect(cookieNamed(r, 'auth_token')).toContain('HttpOnly');
            expect(cookieNamed(r, 'refresh_token')).toContain('refresh_token=new-refresh-token');
        });

        test('모바일 모드(returnRefreshToken:true) — token·refreshToken 을 본문으로, 쿠키 없음', async () => {
            const r = await request(app)
                .post('/api/auth/login')
                .send({ email: sampleUser.email, password: 'pw', returnRefreshToken: true });
            expect(r.status).toBe(200);
            expect(r.body.data.token).toBe('issued-access-token');
            expect(r.body.data.refreshToken).toBe('new-refresh-token');
            expect(setCookies(r)).toEqual([]);
        });
    });

    describe('POST /refresh', () => {
        test('쿠키 모드 — 본문은 user 만, 새 토큰은 쿠키로', async () => {
            const r = await request(app).post('/api/auth/refresh').set('Cookie', ['refresh_token=web-rt']);
            expect(r.status).toBe(200);
            expect(r.body.data.token).toBeUndefined();
            expect(r.body.data.refreshToken).toBeUndefined();
            expect(r.body.data.user).toMatchObject({ id: 'u1' });
            expect(cookieNamed(r, 'auth_token')).toContain('auth_token=new-access-token');
            expect(cookieNamed(r, 'refresh_token')).toContain('refresh_token=new-refresh-token');
        });

        test('모바일 모드(body.refreshToken) — token·refreshToken 을 본문으로, 쿠키 없음', async () => {
            const r = await request(app).post('/api/auth/refresh').send({ refreshToken: 'mobile-rt' });
            expect(r.status).toBe(200);
            expect(r.body.data.token).toBe('new-access-token');
            expect(r.body.data.refreshToken).toBe('new-refresh-token');
            expect(setCookies(r)).toEqual([]);
        });
    });

    describe('POST /logout', () => {
        test('access 토큰 없이 refresh 쿠키만 — 200, refresh 토큰 블랙리스트·세션 정리·쿠키 삭제', async () => {
            const rt = refreshTokenFor('u1', 'refresh-jti-1');
            const r = await request(app).post('/api/auth/logout').set('Cookie', [`refresh_token=${rt}`]);
            expect(r.status).toBe(200);
            expect(mockBlacklistToken).toHaveBeenCalledWith(rt);
            expect(mockRemoveSessionFromMap).toHaveBeenCalledWith('u1', 'refresh-jti-1');
            expect(cookieNamed(r, 'auth_token')).toMatch(/Expires=Thu, 01 Jan 1970/);
            expect(cookieNamed(r, 'refresh_token')).toMatch(/Expires=Thu, 01 Jan 1970/);
        });

        test('만료된 access 쿠키 + refresh 쿠키 — 200, 두 토큰 모두 블랙리스트', async () => {
            const at = expiredAccessToken();
            const rt = refreshTokenFor('u1', 'refresh-jti-2');
            const r = await request(app).post('/api/auth/logout').set('Cookie', [`auth_token=${at}`, `refresh_token=${rt}`]);
            expect(r.status).toBe(200);
            expect(mockBlacklistToken).toHaveBeenCalledWith(at);
            expect(mockBlacklistToken).toHaveBeenCalledWith(rt);
        });

        test('쿠키·헤더 모두 없음 — 200, 블랙리스트 호출 없음, 쿠키 삭제', async () => {
            const r = await request(app).post('/api/auth/logout');
            expect(r.status).toBe(200);
            expect(r.body.data.message).toBeDefined();
            expect(mockBlacklistToken).not.toHaveBeenCalled();
            expect(cookieNamed(r, 'auth_token')).toMatch(/Expires=Thu, 01 Jan 1970/);
            expect(cookieNamed(r, 'refresh_token')).toMatch(/Expires=Thu, 01 Jan 1970/);
        });

        test('블랙리스트 기록이 끝난 뒤에 응답한다', async () => {
            let settled = 0;
            mockBlacklistToken.mockImplementation(
                () => new Promise((resolve) => setTimeout(() => { settled += 1; resolve(true); }, 20)),
            );
            const rt = refreshTokenFor('u1', 'refresh-jti-3');
            const r = await request(app)
                .post('/api/auth/logout')
                .set('Authorization', 'Bearer header-token')
                .set('Cookie', [`refresh_token=${rt}`]);
            expect(r.status).toBe(200);
            expect(mockBlacklistToken).toHaveBeenCalledTimes(2);
            expect(settled).toBe(2);
        });
    });
});
