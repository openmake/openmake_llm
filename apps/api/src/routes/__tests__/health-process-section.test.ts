// /api/health 는 DB 를 건드리지 않는다 — 블랙리스트·사용자 조회가 불리면 멈추거나 던지게 해 둔다
jest.mock('../../data/models/token-blacklist', () => ({
    getTokenBlacklist: jest.fn(() => ({ has: () => new Promise<boolean>(() => { /* 영원히 대기(멈춘 풀) */ }) })),
}));
jest.mock('../../data/user-manager', () => ({
    ...jest.requireActual('../../data/user-manager'),
    getUserManager: jest.fn(() => { throw new Error('health 경로에서 사용자 조회 금지'); }),
}));

import * as jwt from 'jsonwebtoken';
import type { Request } from 'express';
import { getConfig } from '../../config/env';
import { getTokenBlacklist } from '../../data/models/token-blacklist';
import { getUserManager } from '../../data/user-manager';
import { readHealthProcessSection } from '../health-process-section';

const mem: NodeJS.MemoryUsage = { rss: 123_456, heapUsed: 45_678, heapTotal: 0, external: 0, arrayBuffers: 0 };

function sign(role: string, opts: jwt.SignOptions = {}): string {
    return jwt.sign({ userId: `bench-${role}`, email: `${role}@example.test`, role, type: 'access' }, getConfig().jwtSecret, { expiresIn: '5m', jwtid: `jti-${role}`, ...opts });
}
// 쿠키(httpOnly) 또는 Authorization 헤더로 토큰을 싣는다
const cookieReq = (token: string): Pick<Request, 'cookies' | 'headers'> => ({ cookies: { auth_token: token }, headers: {} });
const bearerReq = (token: string): Pick<Request, 'cookies' | 'headers'> => ({ cookies: {}, headers: { authorization: `Bearer ${token}` } });
const guestReq: Pick<Request, 'cookies' | 'headers'> = { cookies: {}, headers: {} };

describe('readHealthProcessSection — /api/health 의 관리자 전용 process 필드(서명된 JWT 만으로 판단, DB 없음)', () => {
    afterEach(() => {
        expect(getTokenBlacklist).not.toHaveBeenCalled();
        expect(getUserManager).not.toHaveBeenCalled();
    });

    it('관리자 토큰(쿠키)에는 pid·rss·heapUsed·uptimeSec 를 준다', () => {
        expect(readHealthProcessSection(cookieReq(sign('admin')), mem))
            .toEqual({ pid: process.pid, rss: 123_456, heapUsed: 45_678, uptimeSec: expect.any(Number) });
    });

    it('관리자 토큰(Bearer 헤더)에도 준다', () => {
        expect(readHealthProcessSection(bearerReq(sign('admin')), mem)).toEqual(expect.objectContaining({ rss: 123_456 }));
    });

    it('일반 사용자 토큰에는 주지 않는다', () => {
        expect(readHealthProcessSection(cookieReq(sign('user')), mem)).toBeUndefined();
    });

    it('토큰이 없으면(게스트) 주지 않는다', () => {
        expect(readHealthProcessSection(guestReq, mem)).toBeUndefined();
    });

    it('서명이 틀리거나 만료됐거나 JWT 모양이 아니거나 refresh 토큰이면 게스트로 본다(던지지 않는다)', () => {
        const forged = jwt.sign({ userId: 'x', email: 'x@example.test', role: 'admin', type: 'access' }, 'wrong-secret-wrong-secret-wrong-secret');
        const expired = sign('admin', { expiresIn: -10 });
        const refresh = jwt.sign({ userId: 'x', email: 'x@example.test', role: 'admin', type: 'refresh' }, getConfig().jwtSecret);
        for (const token of [forged, expired, 'not-a-jwt', refresh]) {
            expect(readHealthProcessSection(cookieReq(token), mem)).toBeUndefined();
        }
    });
});
