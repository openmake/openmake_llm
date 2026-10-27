// /api/health 는 블랙리스트를 보지 않는다 — 불리면 영원히 멈추게 해 둔다(멈춘 풀 흉내).
// 관리자 판정만 DB 를 본다: 서명된 JWT 의 role 이 관리자일 때 getUserById 로 현재 role·is_active 를 재확인한다.
jest.mock('../../data/models/token-blacklist', () => ({
    getTokenBlacklist: jest.fn(() => ({ has: () => new Promise<boolean>(() => { /* 영원히 대기(멈춘 풀) */ }) })),
}));
const mockGetUserById = jest.fn();
jest.mock('../../data/user-manager', () => ({
    ...jest.requireActual('../../data/user-manager'),
    getUserManager: jest.fn(() => ({ getUserById: (...a: unknown[]) => mockGetUserById(...a) })),
}));

import * as jwt from 'jsonwebtoken';
import type { Request } from 'express';
import { getConfig } from '../../config/env';
import { getTokenBlacklist } from '../../data/models/token-blacklist';
import { readHealthProcessSection } from '../health-process-section';

const mem: NodeJS.MemoryUsage = { rss: 123_456, heapUsed: 45_678, heapTotal: 0, external: 0, arrayBuffers: 0 };

function sign(role: string, opts: jwt.SignOptions = {}): string {
    return jwt.sign({ userId: `bench-${role}`, email: `${role}@example.test`, role, type: 'access' }, getConfig().jwtSecret, { expiresIn: '5m', jwtid: `jti-${role}`, ...opts });
}
const dbUser = (role: string, isActive = true) => ({ id: 'bench-admin', email: 'admin@example.test', role, created_at: '2026-10-25T00:00:00.000Z', is_active: isActive });
// 쿠키(httpOnly) 또는 Authorization 헤더로 토큰을 싣는다
const cookieReq = (token: string): Pick<Request, 'cookies' | 'headers'> => ({ cookies: { auth_token: token }, headers: {} });
const bearerReq = (token: string): Pick<Request, 'cookies' | 'headers'> => ({ cookies: {}, headers: { authorization: `Bearer ${token}` } });
const guestReq: Pick<Request, 'cookies' | 'headers'> = { cookies: {}, headers: {} };

describe('readHealthProcessSection — /api/health 의 관리자 전용 process 필드', () => {
    beforeEach(() => {
        mockGetUserById.mockReset().mockResolvedValue(dbUser('admin'));
    });
    afterEach(() => {
        expect(getTokenBlacklist).not.toHaveBeenCalled();
    });

    it('관리자 토큰(쿠키) + DB 에서도 활성 관리자 → pid·rss·heapUsed·uptimeSec 를 준다', async () => {
        await expect(readHealthProcessSection(cookieReq(sign('admin')), mem))
            .resolves.toEqual({ pid: process.pid, rss: 123_456, heapUsed: 45_678, uptimeSec: expect.any(Number) });
        expect(mockGetUserById).toHaveBeenCalledWith('bench-admin');
    });

    it('관리자 토큰(Bearer 헤더)에도 준다', async () => {
        await expect(readHealthProcessSection(bearerReq(sign('admin')), mem)).resolves.toEqual(expect.objectContaining({ rss: 123_456 }));
    });

    it('관리자 토큰이어도 DB 의 현재 role 이 user(강등)면 주지 않는다', async () => {
        mockGetUserById.mockResolvedValue(dbUser('user'));
        await expect(readHealthProcessSection(cookieReq(sign('admin')), mem)).resolves.toBeUndefined();
    });

    it('관리자 토큰이어도 DB 에서 비활성이거나 사용자가 없으면 주지 않는다', async () => {
        mockGetUserById.mockResolvedValue(dbUser('admin', false));
        await expect(readHealthProcessSection(cookieReq(sign('admin')), mem)).resolves.toBeUndefined();
        mockGetUserById.mockResolvedValue(null);
        await expect(readHealthProcessSection(cookieReq(sign('admin')), mem)).resolves.toBeUndefined();
    });

    it('DB role=admin 이지만 tokens_valid_after 가 토큰 iat 이후(무효화 이전 발급) → 비관리자', async () => {
        const token = sign('admin');
        const iat = (jwt.decode(token) as { iat: number }).iat;
        mockGetUserById.mockResolvedValue({ ...dbUser('admin'), tokens_valid_after: new Date((iat + 5) * 1000).toISOString() });
        await expect(readHealthProcessSection(cookieReq(token), mem)).resolves.toBeUndefined();
    });

    it('DB role=admin 이고 tokens_valid_after 가 NULL → 관리자 유지', async () => {
        mockGetUserById.mockResolvedValue({ ...dbUser('admin'), tokens_valid_after: null });
        await expect(readHealthProcessSection(cookieReq(sign('admin')), mem)).resolves.toEqual(expect.objectContaining({ rss: 123_456 }));
    });

    it('DB 조회가 던지면 비관리자로 본다(축소 응답, 던지지 않는다)', async () => {
        mockGetUserById.mockRejectedValue(new Error('db down'));
        await expect(readHealthProcessSection(cookieReq(sign('admin')), mem)).resolves.toBeUndefined();
    });

    it('일반 사용자 토큰에는 주지 않는다 — DB 를 보지 않는다', async () => {
        await expect(readHealthProcessSection(cookieReq(sign('user')), mem)).resolves.toBeUndefined();
        expect(mockGetUserById).not.toHaveBeenCalled();
    });

    it('토큰이 없으면(게스트) 주지 않는다 — DB 를 보지 않는다', async () => {
        await expect(readHealthProcessSection(guestReq, mem)).resolves.toBeUndefined();
        expect(mockGetUserById).not.toHaveBeenCalled();
    });

    it('서명이 틀리거나 만료됐거나 JWT 모양이 아니거나 refresh 토큰이면 게스트로 본다(던지지 않는다, DB 안 봄)', async () => {
        const forged = jwt.sign({ userId: 'x', email: 'x@example.test', role: 'admin', type: 'access' }, 'wrong-secret-wrong-secret-wrong-secret');
        const expired = sign('admin', { expiresIn: -10 });
        const refresh = jwt.sign({ userId: 'x', email: 'x@example.test', role: 'admin', type: 'refresh' }, getConfig().jwtSecret);
        for (const token of [forged, expired, 'not-a-jwt', refresh]) {
            await expect(readHealthProcessSection(cookieReq(token), mem)).resolves.toBeUndefined();
        }
        expect(mockGetUserById).not.toHaveBeenCalled();
    });
});
