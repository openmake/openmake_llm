/**
 * clearSessionsForUser(보안 점검 A2) — 비밀번호 변경 등으로 사용자 세션을 끊을 때
 * 인메모리 세션 맵(activeSessionMap)을 비우고 남은 리프레시 jti 를 실제 만료 시각까지 블랙리스트에 올린다.
 */
import * as jwt from 'jsonwebtoken';

const mockBlacklistAdd = jest.fn();
jest.mock('../../data/models/token-blacklist', () => ({
    getTokenBlacklist: () => ({ add: (...a: unknown[]) => mockBlacklistAdd(...a) }),
}));
jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { generateRefreshToken, clearSessionsForUser } from '../auth-core';
import { AUTH_CONFIG } from '../../config/constants';
import type { PublicUser } from '../../data/user-manager';

const user = (id: string): PublicUser => ({ id, email: `${id}@x`, role: 'user', created_at: '2026-01-01T00:00:00.000Z' } as PublicUser);
const jtiOf = (token: string): string => (jwt.decode(token) as { jti: string }).jti;

beforeEach(() => {
    mockBlacklistAdd.mockReset().mockResolvedValue(undefined);
    jest.restoreAllMocks();
});

describe('clearSessionsForUser', () => {
    it('남은 리프레시 jti 를 발급 시각 + 리프레시 수명(실제 만료)으로 블랙리스트에 올린다', () => {
        const t0 = 1_800_000_000_000;
        jest.spyOn(Date, 'now').mockReturnValue(t0);
        const a = generateRefreshToken(user('u-clear'));
        jest.spyOn(Date, 'now').mockReturnValue(t0 + 5_000);
        const b = generateRefreshToken(user('u-clear'));
        const other = generateRefreshToken(user('u-other'));

        clearSessionsForUser('u-clear');

        expect(mockBlacklistAdd).toHaveBeenCalledTimes(2);
        expect(mockBlacklistAdd).toHaveBeenCalledWith(jtiOf(a), t0 + AUTH_CONFIG.REFRESH_TOKEN_MAX_AGE_MS);
        expect(mockBlacklistAdd).toHaveBeenCalledWith(jtiOf(b), t0 + 5_000 + AUTH_CONFIG.REFRESH_TOKEN_MAX_AGE_MS);
        expect(mockBlacklistAdd).not.toHaveBeenCalledWith(jtiOf(other), expect.anything());
    });

    it('세션 맵에서 지운다 — 다시 불러도 블랙리스트 추가가 없고, 새 로그인은 지운 세션과 합산되지 않는다', () => {
        for (let i = 0; i < AUTH_CONFIG.MAX_SESSIONS_PER_USER; i++) generateRefreshToken(user('u-map'));
        clearSessionsForUser('u-map');
        mockBlacklistAdd.mockClear();

        clearSessionsForUser('u-map');
        expect(mockBlacklistAdd).not.toHaveBeenCalled();

        // 지운 세션이 남아 있었다면 여기서 세션 제한 초과로 이전 세션이 블랙리스트된다
        generateRefreshToken(user('u-map'));
        expect(mockBlacklistAdd).not.toHaveBeenCalled();
    });

    it('세션이 없는 사용자는 아무것도 하지 않는다', () => {
        clearSessionsForUser('u-none');
        expect(mockBlacklistAdd).not.toHaveBeenCalled();
    });

    it('블랙리스트 저장 실패는 던지지 않는다(토큰 무효화 기준 시각이 주 방어선)', async () => {
        mockBlacklistAdd.mockRejectedValue(new Error('db down'));
        generateRefreshToken(user('u-fail'));
        expect(() => clearSessionsForUser('u-fail')).not.toThrow();
        await new Promise((r) => setImmediate(r));
    });
});
