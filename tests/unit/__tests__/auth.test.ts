/**
 * #20 개선: Auth 모듈 기초 단위 테스트
 * 
 * JWT 토큰 생성/검증, 권한 체크, 블랙리스트를 테스트합니다.
 */

import {
    generateToken,
    verifyToken,
    generateRefreshToken,
    verifyRefreshToken,
    extractToken,
    hasPermission,
    isAdmin,
    blacklistToken,
    isTokenBlacklisted,
    getBlacklistStats
} from '../../../infrastructure/security/auth/index';

import type { PublicUser } from '../../../infrastructure/security/auth/types';

const testUser: PublicUser = {
    id: 'user-test-1',
    username: 'testuser',
    email: 'test@example.com',
    role: 'user',
    created_at: new Date().toISOString(),
    is_active: true
};

const adminUser: PublicUser = {
    id: 'admin-test-1',
    username: 'admin',
    email: 'admin@example.com',
    role: 'admin',
    created_at: new Date().toISOString(),
    is_active: true
};

describe('Auth Module', () => {
    // ===== Token Generation =====
    describe('generateToken', () => {
        it('should generate a valid JWT string', () => {
            const token = generateToken(testUser);
            expect(typeof token).toBe('string');
            expect(token.split('.').length).toBe(3); // header.payload.signature
        });

        it('should generate different tokens for different users', () => {
            const token1 = generateToken(testUser);
            const token2 = generateToken(adminUser);
            expect(token1).not.toBe(token2);
        });

        it('should generate unique tokens (jti) for same user', () => {
            const token1 = generateToken(testUser);
            const token2 = generateToken(testUser);
            expect(token1).not.toBe(token2);
        });
    });

    // ===== Token Verification =====
    describe('verifyToken', () => {
        it('should verify a valid token and return payload', () => {
            const token = generateToken(testUser);
            const payload = verifyToken(token);

            expect(payload).not.toBeNull();
            expect(payload!.userId).toBe('user-test-1');
            expect(payload!.email).toBe('test@example.com');
            expect(payload!.role).toBe('user');
        });

        it('should return null for invalid token', () => {
            const payload = verifyToken('invalid.token.here');
            expect(payload).toBeNull();
        });

        it('should return null for empty string', () => {
            const payload = verifyToken('');
            expect(payload).toBeNull();
        });
    });

    // ===== Refresh Token =====
    describe('Refresh Token', () => {
        it('should generate and verify a refresh token', () => {
            const refreshToken = generateRefreshToken(testUser);
            expect(typeof refreshToken).toBe('string');

            const result = verifyRefreshToken(refreshToken);
            expect(result).not.toBeNull();
            expect(result!.userId).toBe('user-test-1');
        });

        it('should reject a regular access token as refresh token', () => {
            const accessToken = generateToken(testUser);
            const result = verifyRefreshToken(accessToken);
            expect(result).toBeNull();
        });
    });

    // ===== Token Extraction =====
    describe('extractToken', () => {
        it('should extract token from Bearer header', () => {
            const token = extractToken('Bearer abc123');
            expect(token).toBe('abc123');
        });

        it('should return raw string if no Bearer prefix', () => {
            const token = extractToken('raw-token');
            expect(token).toBe('raw-token');
        });

        it('should return null for undefined input', () => {
            expect(extractToken(undefined)).toBeNull();
        });
    });

    // ===== Role Permissions =====
    describe('Role Permissions', () => {
        it('should allow admin access to all roles', () => {
            expect(hasPermission('admin', 'admin')).toBe(true);
            expect(hasPermission('admin', 'user')).toBe(true);
            expect(hasPermission('admin', 'guest')).toBe(true);
        });

        it('should allow user access to user and guest', () => {
            expect(hasPermission('user', 'user')).toBe(true);
            expect(hasPermission('user', 'guest')).toBe(true);
            expect(hasPermission('user', 'admin')).toBe(false);
        });

        it('should allow guest access only to guest', () => {
            expect(hasPermission('guest', 'guest')).toBe(true);
            expect(hasPermission('guest', 'user')).toBe(false);
            expect(hasPermission('guest', 'admin')).toBe(false);
        });

        it('should correctly identify admin role', () => {
            expect(isAdmin('admin')).toBe(true);
            expect(isAdmin('user')).toBe(false);
            expect(isAdmin('guest')).toBe(false);
        });
    });

    // ===== Token Blacklist =====
    describe('Token Blacklist', () => {
        it('should blacklist a token and detect it', () => {
            const token = generateToken(testUser);
            expect(isTokenBlacklisted(token)).toBe(false);

            blacklistToken(token);
            expect(isTokenBlacklisted(token)).toBe(true);
        });

        it('should reject blacklisted token in verifyToken', () => {
            const token = generateToken(testUser);
            blacklistToken(token);

            const payload = verifyToken(token);
            expect(payload).toBeNull();
        });

        it('should report blacklist stats', () => {
            const stats = getBlacklistStats();
            expect(typeof stats.count).toBe('number');
            expect(typeof stats.persisted).toBe('boolean');
        });
    });
});
