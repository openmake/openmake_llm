/**
 * refresh 재사용 탐지(보안 점검 A7) — 회전으로 폐기된(reason 'rotated') refresh 토큰이 다시 제시되면
 * 탈취로 보고 그 사용자의 토큰 전체를 invalidateTokensBefore 로 끊는다. 거부(null)는 그대로.
 * 로그아웃·세션 상한 정리·비밀번호 변경으로 폐기된('revoked') 토큰은 거부만 한다(전 기기 로그아웃 오탐 방지).
 * 서명이 맞지 않는(위조) 토큰으로는 남의 토큰을 끊을 수 없어야 한다.
 */
import * as jwt from 'jsonwebtoken';

const mockGetReason = jest.fn();
const mockInvalidate = jest.fn();
let mockFailMode: 'open' | 'safe' = 'open';
jest.mock('../../data/models/token-blacklist', () => ({
    getTokenBlacklist: () => ({ getReason: (...a: unknown[]) => mockGetReason(...a) }),
}));
jest.mock('../../data/user-manager-token-invalidation', () => ({
    invalidateTokensBefore: (...a: unknown[]) => mockInvalidate(...a),
}));
jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
jest.mock('../../config/env', () => {
    const actual = jest.requireActual('../../config/env');
    return { ...actual, getConfig: () => ({ ...actual.getConfig(), blacklistFailMode: mockFailMode }) };
});

import { verifyRefreshToken } from '../auth-core';
import { getConfig } from '../../config/env';

const secret = getConfig().jwtSecret;
const refresh = (userId: string, jti: string, key = secret): string =>
    jwt.sign({ userId, type: 'refresh' }, key, { jwtid: jti, expiresIn: '7d' });

beforeEach(() => {
    mockGetReason.mockReset();
    mockInvalidate.mockReset().mockResolvedValue(undefined);
    mockFailMode = 'open';
});

describe('verifyRefreshToken — refresh 재사용 탐지', () => {
    it("회전으로 폐기된('rotated') refresh 가 제시되면 그 사용자의 토큰 전체를 무효화하고 null", async () => {
        mockGetReason.mockResolvedValue('rotated');
        const result = await verifyRefreshToken(refresh('u-reuse', 'jti-reused'));
        expect(result).toBeNull();
        expect(mockGetReason).toHaveBeenCalledWith('jti-reused');
        expect(mockInvalidate).toHaveBeenCalledTimes(1);
        expect(mockInvalidate).toHaveBeenCalledWith('u-reuse');
    });

    it("로그아웃 등으로 폐기된('revoked') refresh 는 거부만 — 무효화 없음", async () => {
        mockGetReason.mockResolvedValue('revoked');
        expect(await verifyRefreshToken(refresh('u-revoked', 'jti-revoked'))).toBeNull();
        expect(mockInvalidate).not.toHaveBeenCalled();
    });

    it('숫자 userId 도 문자열로 넘긴다', async () => {
        mockGetReason.mockResolvedValue('rotated');
        const token = jwt.sign({ userId: 42, type: 'refresh' }, secret, { jwtid: 'jti-num', expiresIn: '7d' });
        expect(await verifyRefreshToken(token)).toBeNull();
        expect(mockInvalidate).toHaveBeenCalledWith('42');
    });

    it('무효화가 실패해도 거부는 유지한다(throw 하지 않음)', async () => {
        mockGetReason.mockResolvedValue('rotated');
        mockInvalidate.mockRejectedValue(new Error('DB down'));
        await expect(verifyRefreshToken(refresh('u-fail', 'jti-fail'))).resolves.toBeNull();
        expect(mockInvalidate).toHaveBeenCalledWith('u-fail');
    });

    it('무효화 실패는 BLACKLIST_FAIL_MODE=open 이어도 통과로 바뀌지 않는다', async () => {
        mockFailMode = 'open';
        mockGetReason.mockResolvedValue('rotated');
        mockInvalidate.mockRejectedValue(new Error('DB down'));
        expect(await verifyRefreshToken(refresh('u-open', 'jti-open'))).toBeNull();
    });

    it('서명이 다른(위조) 토큰은 rotated jti 를 써도 무효화를 일으키지 않는다', async () => {
        mockGetReason.mockResolvedValue('rotated');
        const forged = refresh('victim', 'jti-known', 'y'.repeat(40));
        expect(await verifyRefreshToken(forged)).toBeNull();
        expect(mockInvalidate).not.toHaveBeenCalled();
    });

    it('블랙리스트된 access 타입 토큰을 refresh 로 제시 — 무효화 없음, null', async () => {
        mockGetReason.mockResolvedValue('rotated');
        const access = jwt.sign({ userId: 'u-access', type: 'access' }, secret, { jwtid: 'jti-access', expiresIn: '15m' });
        expect(await verifyRefreshToken(access)).toBeNull();
        expect(mockInvalidate).not.toHaveBeenCalled();
    });

    it('블랙리스트에 없는 정상 refresh 는 무효화 없이 통과', async () => {
        mockGetReason.mockResolvedValue(null);
        const result = await verifyRefreshToken(refresh('u-ok', 'jti-ok'));
        expect(result?.userId).toBe('u-ok');
        expect(mockInvalidate).not.toHaveBeenCalled();
    });

    it('블랙리스트 조회 실패 + open → 통과, 무효화 없음', async () => {
        mockFailMode = 'open';
        mockGetReason.mockRejectedValue(new Error('DB down'));
        const result = await verifyRefreshToken(refresh('u-db-open', 'jti-db-open'));
        expect(result?.userId).toBe('u-db-open');
        expect(mockInvalidate).not.toHaveBeenCalled();
    });

    it('블랙리스트 조회 실패 + safe → null, 무효화 없음', async () => {
        mockFailMode = 'safe';
        mockGetReason.mockRejectedValue(new Error('DB down'));
        expect(await verifyRefreshToken(refresh('u-db-safe', 'jti-db-safe'))).toBeNull();
        expect(mockInvalidate).not.toHaveBeenCalled();
    });
});
