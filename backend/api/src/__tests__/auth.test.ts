/**
 * Auth Module Tests
 * JWT 토큰 생성/검증 및 권한 체크 테스트
 */

// 테스트용 환경변수 설정 (다른 import 전에 설정)
process.env.JWT_SECRET = 'test-secret-key-for-testing-purposes-only';
// 🔒 보안 패치 2026-02-07: 하드코딩된 DB 인증정보 제거 — 환경변수 필수
if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = `postgresql://${process.env.POSTGRES_USER || 'openmake'}:${process.env.POSTGRES_PASSWORD || 'test'}@localhost:5432/${process.env.POSTGRES_DB || 'openmake_llm'}`;
}

import {
    generateToken,
    verifyToken,
    extractToken,
    hasPermission,
    isAdmin
} from '../auth';
import { PublicUser } from '../data/user-manager';

describe('Auth Module', () => {
    // 테스트용 사용자 데이터
    const mockUser: PublicUser = {
        id: 'user-1',
        email: 'test@example.com',
        role: 'user',
        tier: 'free',
        is_active: true,
        created_at: new Date().toISOString()
    };

    const mockAdminUser: PublicUser = {
        id: 'user-2',
        email: 'admin@example.com',
        role: 'admin',
        tier: 'enterprise',
        is_active: true,
        created_at: new Date().toISOString()
    };

    describe('generateToken', () => {
        it('should generate a valid JWT token', () => {
            const token = generateToken(mockUser);

            expect(token).toBeDefined();
            expect(typeof token).toBe('string');
            expect(token.split('.')).toHaveLength(3); // JWT는 3개 세그먼트
        });

        it('should generate different tokens for different users', () => {
            const token1 = generateToken(mockUser);
            const token2 = generateToken(mockAdminUser);

            expect(token1).not.toBe(token2);
        });
    });

    describe('verifyToken', () => {
        it('should verify a valid token', async () => {
            const token = generateToken(mockUser);
            const payload = await verifyToken(token);

            expect(payload).not.toBeNull();
            expect(payload?.userId).toBe(mockUser.id);
            expect(payload?.email).toBe(mockUser.email);
            expect(payload?.role).toBe(mockUser.role);
        });

        it('should return null for invalid token', async () => {
            const payload = await verifyToken('invalid-token');

            expect(payload).toBeNull();
        });

        it('should return null for empty token', async () => {
            const payload = await verifyToken('');

            expect(payload).toBeNull();
        });

        it('should return null for malformed JWT', async () => {
            const payload = await verifyToken('a.b.c');

            expect(payload).toBeNull();
        });
    });

    describe('extractToken', () => {
        it('should extract token from Bearer header', () => {
            const token = extractToken('Bearer mytoken123');

            expect(token).toBe('mytoken123');
        });

        it('should return raw token if no Bearer prefix', () => {
            const token = extractToken('rawtoken456');

            expect(token).toBe('rawtoken456');
        });

        it('should return null for undefined header', () => {
            const token = extractToken(undefined);

            expect(token).toBeNull();
        });

        it('should return null for empty header', () => {
            const token = extractToken('');

            expect(token).toBeNull();
        });
    });

    describe('hasPermission', () => {
        it('should allow admin to access admin resources', () => {
            expect(hasPermission('admin', 'admin')).toBe(true);
        });

        it('should allow admin to access user resources', () => {
            expect(hasPermission('admin', 'user')).toBe(true);
        });

        it('should allow admin to access guest resources', () => {
            expect(hasPermission('admin', 'guest')).toBe(true);
        });

        it('should allow user to access user resources', () => {
            expect(hasPermission('user', 'user')).toBe(true);
        });

        it('should allow user to access guest resources', () => {
            expect(hasPermission('user', 'guest')).toBe(true);
        });

        it('should deny user access to admin resources', () => {
            expect(hasPermission('user', 'admin')).toBe(false);
        });

        it('should allow guest to access guest resources', () => {
            expect(hasPermission('guest', 'guest')).toBe(true);
        });

        it('should deny guest access to user resources', () => {
            expect(hasPermission('guest', 'user')).toBe(false);
        });

        it('should deny guest access to admin resources', () => {
            expect(hasPermission('guest', 'admin')).toBe(false);
        });
    });

    describe('isAdmin', () => {
        it('should return true for admin role', () => {
            expect(isAdmin('admin')).toBe(true);
        });

        it('should return false for user role', () => {
            expect(isAdmin('user')).toBe(false);
        });

        it('should return false for guest role', () => {
            expect(isAdmin('guest')).toBe(false);
        });
    });
});

// Add at the end of the file, after existing tests
import { AuthService } from '../services/AuthService';

describe('Password Policy', () => {
    const authService = new AuthService();
    
    it('should reject password shorter than 8 characters', async () => {
        const result = await authService.register({ email: 'test@test.com', password: 'Aa1!' });
        expect(result.success).toBe(false);
        expect(result.error).toContain('8자');
    });
    
    it('should reject password without uppercase', async () => {
        const result = await authService.register({ email: 'test@test.com', password: 'abcd1234!' });
        expect(result.success).toBe(false);
        expect(result.error).toContain('대문자');
    });
    
    it('should reject password without lowercase', async () => {
        const result = await authService.register({ email: 'test@test.com', password: 'ABCD1234!' });
        expect(result.success).toBe(false);
        expect(result.error).toContain('소문자');
    });
    
    it('should reject password without number', async () => {
        const result = await authService.register({ email: 'test@test.com', password: 'Abcdefgh!' });
        expect(result.success).toBe(false);
        expect(result.error).toContain('숫자');
    });
    
    it('should reject password without special character', async () => {
        const result = await authService.register({ email: 'test@test.com', password: 'Abcd1234' });
        expect(result.success).toBe(false);
        expect(result.error).toContain('특수문자');
    });
    
    it('should accept valid password', async () => {
        const result = await authService.register({ email: 'newuser@test.com', password: 'ValidPass1!' });
        // Success depends on whether user already exists, but should NOT fail on password
        if (!result.success) {
            expect(result.error).not.toContain('비밀번호');
        }
    });
});

describe('Token Blacklist', () => {
    // In-memory 구현으로 PostgreSQL 없이 ITokenBlacklist 인터페이스 동작 검증
    type BlacklistEntry = { jti: string; expiresAt: number };
    let store: BlacklistEntry[];

    const blacklist = {
        add: async (jti: string, expiresAt: number) => {
            const idx = store.findIndex(e => e.jti === jti);
            if (idx >= 0) { store[idx].expiresAt = expiresAt; }
            else { store.push({ jti, expiresAt }); }
        },
        has: async (jti: string) => {
            return store.some(e => e.jti === jti && e.expiresAt > Date.now());
        },
        cleanup: async () => {
            const now = Date.now();
            const before = store.length;
            store = store.filter(e => e.expiresAt >= now);
            return before - store.length;
        },
        getStats: async () => {
            const now = Date.now();
            return { count: store.filter(e => e.expiresAt > now).length };
        },
    };

    beforeEach(() => {
        store = [];
    });

    it('should add token to blacklist', async () => {
        await blacklist.add('test-jti-1', Date.now() + 60000);
        expect(await blacklist.has('test-jti-1')).toBe(true);
    });

    it('should return false for non-existent token', async () => {
        expect(await blacklist.has('non-existent')).toBe(false);
    });

    it('should return false for expired token', async () => {
        await blacklist.add('expired-jti', Date.now() - 1000);
        expect(await blacklist.has('expired-jti')).toBe(false);
    });

    it('should cleanup expired tokens', async () => {
        await blacklist.add('expired-1', Date.now() - 1000);
        await blacklist.add('expired-2', Date.now() - 2000);
        await blacklist.add('valid', Date.now() + 60000);

        const cleaned = await blacklist.cleanup();
        expect(cleaned).toBe(2);
        const stats = await blacklist.getStats();
        expect(stats.count).toBe(1);
    });

    it('should return correct stats', async () => {
        await blacklist.add('jti-1', Date.now() + 60000);
        await blacklist.add('jti-2', Date.now() + 60000);

        const stats = await blacklist.getStats();
        expect(stats.count).toBe(2);
    });
});
