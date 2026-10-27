/**
 * 인증 미들웨어의 토큰 무효화 검사(A2 기반).
 * requireAuth: users.tokens_valid_after 이전에 발급된 토큰은 401, 이후 발급은 통과.
 * optionalAuth: 무효화된 토큰은 만료 토큰처럼 다룬다 — 게스트로 통과(req.user 없음), 쿠키 정리.
 */
import type { Request, Response } from 'express';

const mockVerifyToken = jest.fn();
const mockClearTokenCookie = jest.fn();
jest.mock('../auth-core', () => ({
    extractToken: (h?: string) => (h?.startsWith('Bearer ') ? h.slice(7) : null),
    verifyToken: (...a: unknown[]) => mockVerifyToken(...a),
    isAdmin: () => false,
    clearTokenCookie: (...a: unknown[]) => mockClearTokenCookie(...a),
    looksLikeJWT: () => true,
}));
const mockGetUserById = jest.fn();
jest.mock('../../data/user-manager', () => ({
    getUserManager: () => ({ getUserById: mockGetUserById }),
}));
jest.mock('../../security/security-audit', () => ({ auditHttpDenied: jest.fn() }));

import { requireAuth, optionalAuth } from '../middleware';
import { AUTH_COOKIES } from '../../config/security';

const VALID_AFTER_ISO = '2026-10-25T06:00:00.000Z';
const VALID_AFTER_SEC = Date.parse(VALID_AFTER_ISO) / 1000;
const USER = { id: 'u-1', email: 'u@x', role: 'user', is_active: true, created_at: '2026-01-01T00:00:00.000Z' };

function makeReq(): Request {
    return { headers: {}, cookies: { [AUTH_COOKIES.ACCESS]: 'a.b.c' }, path: '/api/x' } as unknown as Request;
}
function makeRes(): Response {
    const res = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    return res as unknown as Response;
}

beforeEach(() => {
    mockVerifyToken.mockReset();
    mockGetUserById.mockReset();
    mockClearTokenCookie.mockReset();
});

describe('requireAuth — tokens_valid_after', () => {
    it('tokens_valid_after 이후 발급된 토큰은 통과', async () => {
        mockVerifyToken.mockResolvedValue({ userId: 'u-1', iat: VALID_AFTER_SEC + 10 });
        mockGetUserById.mockResolvedValue({ ...USER, tokens_valid_after: VALID_AFTER_ISO });
        const req = makeReq();
        const res = makeRes();
        const next = jest.fn();
        await requireAuth(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
        expect(req.user).toEqual(expect.objectContaining({ id: 'u-1' }));
    });

    it('tokens_valid_after 이전 발급된 토큰은 401 토큰이 무효화되었습니다', async () => {
        mockVerifyToken.mockResolvedValue({ userId: 'u-1', iat: VALID_AFTER_SEC - 10 });
        mockGetUserById.mockResolvedValue({ ...USER, tokens_valid_after: VALID_AFTER_ISO });
        const req = makeReq();
        const res = makeRes();
        const next = jest.fn();
        await requireAuth(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            error: expect.objectContaining({ message: '토큰이 무효화되었습니다' }),
        }));
        expect(next).not.toHaveBeenCalled();
        expect(req.user).toBeUndefined();
    });

    it('tokens_valid_after 가 NULL 이면 기존처럼 통과', async () => {
        mockVerifyToken.mockResolvedValue({ userId: 'u-1', iat: VALID_AFTER_SEC - 10 });
        mockGetUserById.mockResolvedValue({ ...USER, tokens_valid_after: null });
        const res = makeRes();
        const next = jest.fn();
        await requireAuth(makeReq(), res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });
});

describe('optionalAuth — tokens_valid_after', () => {
    it('무효화된 토큰은 게스트로 통과하고 쿠키를 정리한다(401 아님)', async () => {
        mockVerifyToken.mockResolvedValue({ userId: 'u-1', iat: VALID_AFTER_SEC - 10 });
        mockGetUserById.mockResolvedValue({ ...USER, tokens_valid_after: VALID_AFTER_ISO });
        const req = makeReq();
        const res = makeRes();
        const next = jest.fn();
        await optionalAuth(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
        expect(req.user).toBeUndefined();
        expect(mockClearTokenCookie).toHaveBeenCalledWith(res);
    });

    it('이후 발급된 토큰은 req.user 를 싣는다', async () => {
        mockVerifyToken.mockResolvedValue({ userId: 'u-1', iat: VALID_AFTER_SEC + 10 });
        mockGetUserById.mockResolvedValue({ ...USER, tokens_valid_after: VALID_AFTER_ISO });
        const req = makeReq();
        const next = jest.fn();
        await optionalAuth(req, makeRes(), next);
        expect(next).toHaveBeenCalled();
        expect(req.user).toEqual(expect.objectContaining({ id: 'u-1' }));
    });
});
