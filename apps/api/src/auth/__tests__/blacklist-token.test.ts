/**
 * blacklistToken(보안 점검 A6 보강) — 익명 /logout 이 아무 토큰이나 블랙리스트 테이블에 쓰지 못하게
 * 서버 secret 으로 서명이 맞는 토큰만 기록한다(만료는 무시). 위조 exp 로 행이 오래 남지 않도록
 * expiresAt 은 리프레시 수명 상한으로 자른다.
 */
import * as jwt from 'jsonwebtoken';

const mockBlacklistAdd = jest.fn();
jest.mock('../../data/models/token-blacklist', () => ({
    getTokenBlacklist: () => ({ add: (...a: unknown[]) => mockBlacklistAdd(...a) }),
}));
jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { blacklistToken, verifySignatureIgnoringExpiry } from '../auth-core';
import { AUTH_CONFIG } from '../../config/constants';
import { getConfig } from '../../config/env';

const sign = (payload: object, secret: string = getConfig().jwtSecret): string =>
    jwt.sign(payload, secret, { algorithm: 'HS256' });
const nowSec = (): number => Math.floor(Date.now() / 1000);

beforeEach(() => {
    mockBlacklistAdd.mockReset().mockResolvedValue(undefined);
});

describe('blacklistToken', () => {
    it('다른 secret 으로 서명한 토큰 — false, 저장소 add 없음', async () => {
        const forged = sign({ userId: 'u1', jti: 'forged-jti', exp: nowSec() + 600 }, 'another-secret-not-the-server-one-0000');
        await expect(blacklistToken(forged)).resolves.toBe(false);
        expect(mockBlacklistAdd).not.toHaveBeenCalled();
    });

    it('무서명 문자열 — false, 저장소 add 없음', async () => {
        await expect(blacklistToken('not-a-jwt')).resolves.toBe(false);
        expect(mockBlacklistAdd).not.toHaveBeenCalled();
    });

    it('유효 서명 + 만료(exp 과거) — true, jti 를 기록', async () => {
        const exp = nowSec() - 60;
        await expect(blacklistToken(sign({ userId: 'u1', jti: 'expired-jti', exp }))).resolves.toBe(true);
        expect(mockBlacklistAdd).toHaveBeenCalledWith('expired-jti', exp * 1000);
    });

    it('exp 가 지금+10년 — expiresAt 은 지금 + 리프레시 수명 이하로 자른다', async () => {
        const before = Date.now();
        await expect(blacklistToken(sign({ userId: 'u1', jti: 'far-future-jti', exp: nowSec() + 10 * 365 * 24 * 3600 }))).resolves.toBe(true);
        const after = Date.now();
        const [jti, expiresAt] = mockBlacklistAdd.mock.calls[0] as [string, number];
        expect(jti).toBe('far-future-jti');
        expect(expiresAt).toBeLessThanOrEqual(after + AUTH_CONFIG.REFRESH_TOKEN_MAX_AGE_MS);
        expect(expiresAt).toBeGreaterThanOrEqual(before + AUTH_CONFIG.REFRESH_TOKEN_MAX_AGE_MS);
    });

    it('jti 없는 서명 토큰 — false', async () => {
        await expect(blacklistToken(sign({ userId: 'u1', exp: nowSec() + 600 }))).resolves.toBe(false);
        expect(mockBlacklistAdd).not.toHaveBeenCalled();
    });
});

describe('verifySignatureIgnoringExpiry', () => {
    it('만료돼도 서명이 맞으면 페이로드, 서명이 다르면 null', () => {
        const ok = sign({ userId: 'u1', jti: 'j', type: 'refresh', exp: nowSec() - 60 });
        expect(verifySignatureIgnoringExpiry(ok)).toMatchObject({ userId: 'u1', jti: 'j', type: 'refresh' });
        expect(verifySignatureIgnoringExpiry(sign({ userId: 'u1', jti: 'j' }, 'another-secret-not-the-server-one-0000'))).toBeNull();
        expect(verifySignatureIgnoringExpiry('garbage')).toBeNull();
    });

    it('HS256 외 알고리즘(none)은 거부', () => {
        const unsigned = jwt.sign({ userId: 'u1', jti: 'j' }, '', { algorithm: 'none' });
        expect(verifySignatureIgnoringExpiry(unsigned)).toBeNull();
    });
});
