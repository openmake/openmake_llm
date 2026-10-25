/**
 * refresh 재사용 탐지(보안 점검 A7) — 블랙리스트에 오른(이미 회전·폐기된) refresh 토큰이 다시 제시되면
 * 탈취로 보고 그 사용자의 토큰 전체를 invalidateTokensBefore 로 끊는다. 거부(null)는 그대로.
 * 서명이 맞지 않는(위조) 토큰으로는 남의 토큰을 끊을 수 없어야 한다.
 */
import * as jwt from 'jsonwebtoken';

const mockHas = jest.fn();
const mockInvalidate = jest.fn();
jest.mock('../../data/models/token-blacklist', () => ({
    getTokenBlacklist: () => ({ has: (...a: unknown[]) => mockHas(...a) }),
}));
jest.mock('../../data/user-manager-token-invalidation', () => ({
    invalidateTokensBefore: (...a: unknown[]) => mockInvalidate(...a),
}));
jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { verifyRefreshToken } from '../auth-core';
import { getConfig } from '../../config/env';

const secret = getConfig().jwtSecret;
const refresh = (userId: string, jti: string, key = secret): string =>
    jwt.sign({ userId, type: 'refresh' }, key, { jwtid: jti, expiresIn: '7d' });

beforeEach(() => {
    mockHas.mockReset();
    mockInvalidate.mockReset().mockResolvedValue(undefined);
});

describe('verifyRefreshToken — refresh 재사용 탐지', () => {
    it('블랙리스트된 refresh 가 제시되면 그 사용자의 토큰 전체를 무효화하고 null', async () => {
        mockHas.mockResolvedValue(true);
        const result = await verifyRefreshToken(refresh('u-reuse', 'jti-reused'));
        expect(result).toBeNull();
        expect(mockInvalidate).toHaveBeenCalledTimes(1);
        expect(mockInvalidate).toHaveBeenCalledWith('u-reuse');
    });

    it('숫자 userId 도 문자열로 넘긴다', async () => {
        mockHas.mockResolvedValue(true);
        const token = jwt.sign({ userId: 42, type: 'refresh' }, secret, { jwtid: 'jti-num', expiresIn: '7d' });
        expect(await verifyRefreshToken(token)).toBeNull();
        expect(mockInvalidate).toHaveBeenCalledWith('42');
    });

    it('무효화가 실패해도 거부는 유지한다(throw 하지 않음)', async () => {
        mockHas.mockResolvedValue(true);
        mockInvalidate.mockRejectedValue(new Error('DB down'));
        await expect(verifyRefreshToken(refresh('u-fail', 'jti-fail'))).resolves.toBeNull();
        expect(mockInvalidate).toHaveBeenCalledWith('u-fail');
    });

    it('서명이 다른(위조) 토큰은 블랙리스트 jti 를 써도 무효화를 일으키지 않는다', async () => {
        mockHas.mockResolvedValue(true);
        const forged = refresh('victim', 'jti-known', 'y'.repeat(40));
        expect(await verifyRefreshToken(forged)).toBeNull();
        expect(mockInvalidate).not.toHaveBeenCalled();
    });

    it('블랙리스트에 없는 정상 refresh 는 무효화 없이 통과', async () => {
        mockHas.mockResolvedValue(false);
        const result = await verifyRefreshToken(refresh('u-ok', 'jti-ok'));
        expect(result?.userId).toBe('u-ok');
        expect(mockInvalidate).not.toHaveBeenCalled();
    });
});
