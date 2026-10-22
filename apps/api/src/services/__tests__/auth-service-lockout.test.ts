/**
 * W3 S7 — 잠긴 계정의 로그인 실패는 일반 실패와 같은 문구(계정 존재 비노출)이고 locked:true 만 더한다.
 */

const mockAuthenticateDetailed = jest.fn();

jest.mock('../../data/user-manager', () => ({
    getUserManager: jest.fn(() => ({ authenticateDetailed: mockAuthenticateDetailed })),
    USER_ROLES: { ADMIN: 'admin', USER: 'user', GUEST: 'guest' },
}));
jest.mock('../../auth', () => ({ generateToken: jest.fn().mockReturnValue('jwt-token') }));
jest.mock('../../config/env', () => ({ getConfig: jest.fn().mockReturnValue({ adminEmails: '' }) }));
jest.mock('../../utils/logger', () => ({
    createLogger: jest.fn().mockReturnValue({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { AuthService } from '../AuthService';

describe('AuthService.login — 계정 잠금', () => {
    beforeEach(() => mockAuthenticateDetailed.mockReset());

    test('잠긴 계정 — 일반 실패와 같은 문구 + locked:true', async () => {
        mockAuthenticateDetailed.mockResolvedValueOnce({ user: null, locked: false });
        const wrong = await new AuthService().login({ email: 'a@example.com', password: 'x' });
        mockAuthenticateDetailed.mockResolvedValueOnce({ user: null, locked: true });
        const locked = await new AuthService().login({ email: 'a@example.com', password: 'x' });

        expect(locked.success).toBe(false);
        expect(locked.locked).toBe(true);
        expect(locked.error).toBe(wrong.error);
        expect(locked.error).toBe('이메일 또는 비밀번호가 올바르지 않습니다');
        expect(locked.token).toBeUndefined();
        expect(wrong.locked).toBe(false);
    });

    test('성공 — 토큰 발급', async () => {
        mockAuthenticateDetailed.mockResolvedValueOnce({ user: { id: '1', email: 'a@example.com', role: 'user' }, locked: false });
        const ok = await new AuthService().login({ email: 'a@example.com', password: 'x' });
        expect(ok).toEqual(expect.objectContaining({ success: true, token: 'jwt-token' }));
    });
});
