/**
 * 보안 점검 A4·A6 — 쿠키 모드 인증 응답과 로그아웃.
 *
 * A4: 웹(쿠키 모드) 로그인·refresh 응답 본문에 access 토큰을 싣지 않는다 — 토큰은 httpOnly 쿠키에만.
 *     모바일(returnRefreshToken / body.refreshToken)은 종전대로 body 로 받는다.
 * A6: /logout 은 access 토큰이 없거나 만료돼도 200 — refresh 토큰을 폐기하고 쿠키를 지운다.
 *     블랙리스트 기록은 응답 전에 끝낸다(await).
 * A2: 비밀번호 변경 성공 — 다른 기기 토큰은 무효화, 바꾼 이 기기에는 새 access·refresh 를 준다
 *     (쿠키 모드는 쿠키로만, 헤더 모드는 본문으로).
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

// 미들웨어의 verifyToken 이 블랙리스트를 조회한다 — DB 대신 빈 목록. add 는 실제 blacklistToken 을 쓰는 테스트가 센다
const mockBlacklistAdd = jest.fn();
jest.mock('../data/models/token-blacklist', () => ({
    getTokenBlacklist: () => ({ has: async () => false, getReason: async () => null, add: (...a: unknown[]) => mockBlacklistAdd(...a) }),
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

/** 서명된 refresh 토큰 — 로그아웃은 서명만 검증한다(만료 무시) */
function refreshTokenFor(userId: string, jti: string, secret: string = getConfig().jwtSecret, exp?: number): string {
    const payload = { userId, jti, type: 'refresh', ...(exp !== undefined ? { exp } : {}) };
    return jwt.sign(payload, secret, { algorithm: 'HS256', ...(exp === undefined ? { expiresIn: '7d' } : {}) });
}

/** refresh 쿠키 Set-Cookie 중 토큰 값을 싣는 것(만료 쿠키 제외) */
function refreshCookieWithValue(res: request.Response, value: string): string | undefined {
    return setCookies(res).find((c) => c.startsWith(`refresh_token=${value};`));
}

/** 유효한 access 토큰 — requireAuth 를 통과한다 */
function validAccessToken(): string {
    return jwt.sign(
        { userId: 'u1', email: sampleUser.email, role: 'user', type: 'access' },
        getConfig().jwtSecret,
        { algorithm: 'HS256', expiresIn: '15m', jwtid: 'current-access-jti' },
    );
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
            expect(refreshCookieWithValue(r, 'new-refresh-token')).toBeDefined();
        });

        test('쿠키 모드 — refresh 쿠키 Path=/api/auth (logout 에도 실리게), 옛 /api/auth/refresh 쿠키는 만료', async () => {
            const r = await request(app).post('/api/auth/login').send({ email: sampleUser.email, password: 'pw' });
            const rc = refreshCookieWithValue(r, 'new-refresh-token');
            expect(rc).toMatch(/; Path=\/api\/auth(;|$)/);
            expect(rc).not.toContain('Path=/api/auth/refresh');
            // 배포 전 발급된 옛 경로 쿠키가 남아 있으면 /refresh 에서 먼저 읽혀(긴 path 우선) 회전된 새 토큰을 가린다
            const legacy = setCookies(r).find((c) => c.startsWith('refresh_token=;') && c.includes('Path=/api/auth/refresh'));
            expect(legacy).toMatch(/Expires=Thu, 01 Jan 1970/);
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
            expect(refreshCookieWithValue(r, 'new-refresh-token')).toMatch(/; Path=\/api\/auth(;|$)/);
            // 구 path 쿠키 만료(회전된 새 쿠키를 가리지 않게)
            const legacy = setCookies(r).find((c) => c.startsWith('refresh_token=;') && c.includes('Path=/api/auth/refresh'));
            expect(legacy).toMatch(/Expires=Thu, 01 Jan 1970/);
        });

        test('모바일 모드(body.refreshToken) — token·refreshToken 을 본문으로, 쿠키 없음', async () => {
            const r = await request(app).post('/api/auth/refresh').send({ refreshToken: 'mobile-rt' });
            expect(r.status).toBe(200);
            expect(r.body.data.token).toBe('new-access-token');
            expect(r.body.data.refreshToken).toBe('new-refresh-token');
            expect(setCookies(r)).toEqual([]);
        });
    });

    describe('PUT /password', () => {
        const body = { currentPassword: 'OldPassw0rd!x', newPassword: 'NewPassw0rd!x' };

        beforeEach(() => {
            mockAuthService.changePassword.mockResolvedValue({ success: true });
        });

        test('쿠키 모드 — auth_token·refresh_token 을 새 값으로 설정, 본문에 토큰 없음', async () => {
            const r = await request(app)
                .put('/api/auth/password')
                .set('Cookie', [`auth_token=${validAccessToken()}`, 'refresh_token=old-refresh-token'])
                .send(body);
            expect(r.status).toBe(200);
            expect(r.body.data).toEqual({ success: true });
            expect(cookieNamed(r, 'auth_token')).toContain('auth_token=new-access-token');
            expect(cookieNamed(r, 'auth_token')).toContain('HttpOnly');
            expect(refreshCookieWithValue(r, 'new-refresh-token')).toMatch(/; Path=\/api\/auth(;|$)/);
            expect(JSON.stringify(r.body)).not.toContain('new-access-token');
        });

        test('헤더(비쿠키) 모드 — 본문에 token·refreshToken, 쿠키 없음', async () => {
            const r = await request(app)
                .put('/api/auth/password')
                .set('Authorization', `Bearer ${validAccessToken()}`)
                .send(body);
            expect(r.status).toBe(200);
            expect(r.body.data).toEqual({ success: true, token: 'new-access-token', refreshToken: 'new-refresh-token' });
            expect(setCookies(r)).toEqual([]);
        });

        test('실패 — 새 토큰도 쿠키 변경도 없다', async () => {
            mockAuthService.changePassword.mockResolvedValue({ success: false, error: '현재 비밀번호가 올바르지 않습니다' });
            const r = await request(app)
                .put('/api/auth/password')
                .set('Cookie', [`auth_token=${validAccessToken()}`])
                .send(body);
            expect(r.status).toBe(401);
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

        test('로그아웃 응답의 refresh 쿠키 삭제는 /api/auth 와 옛 /api/auth/refresh 경로 둘 다', async () => {
            const r = await request(app).post('/api/auth/logout');
            const cleared = setCookies(r).filter((c) => c.startsWith('refresh_token=;'));
            expect(cleared.some((c) => /; Path=\/api\/auth(;|$)/.test(c))).toBe(true);
            expect(cleared.some((c) => c.includes('Path=/api/auth/refresh'))).toBe(true);
        });

        describe('서명 검증 — 실제 blacklistToken (저장소 add 만 mock)', () => {
            beforeEach(() => {
                const actual = jest.requireActual('../auth') as typeof import('../auth');
                mockBlacklistToken.mockImplementation((t: string) => actual.blacklistToken(t));
                mockBlacklistAdd.mockReset().mockResolvedValue(undefined);
            });

            test('refresh 쿠키가 올바른 서명 + 만료(exp 과거)여도 블랙리스트·세션맵 정리', async () => {
                const rt = refreshTokenFor('u1', 'expired-refresh-jti', undefined, Math.floor(Date.now() / 1000) - 60);
                const r = await request(app).post('/api/auth/logout').set('Cookie', [`refresh_token=${rt}`]);
                expect(r.status).toBe(200);
                expect(mockBlacklistAdd).toHaveBeenCalledWith('expired-refresh-jti', expect.any(Number), 'revoked');
                expect(mockRemoveSessionFromMap).toHaveBeenCalledWith('u1', 'expired-refresh-jti');
            });

            test('다른 secret 으로 서명한 refresh 쿠키 — 블랙리스트 add·세션맵 정리 0회, 200, 쿠키 삭제', async () => {
                const forged = refreshTokenFor('u1', 'forged-refresh-jti', 'another-secret-not-the-server-one-0000');
                const r = await request(app).post('/api/auth/logout').set('Cookie', [`refresh_token=${forged}`]);
                expect(r.status).toBe(200);
                expect(mockBlacklistAdd).not.toHaveBeenCalled();
                expect(mockRemoveSessionFromMap).not.toHaveBeenCalled();
                expect(cookieNamed(r, 'auth_token')).toMatch(/Expires=Thu, 01 Jan 1970/);
                expect(cookieNamed(r, 'refresh_token')).toMatch(/Expires=Thu, 01 Jan 1970/);
            });

            test('access 쿠키가 위조 서명 — 블랙리스트 add 0회', async () => {
                const forgedAccess = jwt.sign(
                    { userId: 'u1', jti: 'forged-access-jti', type: 'access' },
                    'another-secret-not-the-server-one-0000',
                    { algorithm: 'HS256', expiresIn: '15m' },
                );
                const r = await request(app).post('/api/auth/logout').set('Cookie', [`auth_token=${forgedAccess}`]);
                expect(r.status).toBe(200);
                expect(mockBlacklistAdd).not.toHaveBeenCalled();
            });
        });
    });
});
