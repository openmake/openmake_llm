/**
 * Auth Middleware Tests
 * 인증 미들웨어 테스트
 */

import { Request, Response, NextFunction } from 'express';
import { optionalAuth, requireAuth, requireAdmin, requireRole } from '../auth/middleware';

// Mock user manager
jest.mock('../data/user-manager', () => ({
    getUserManager: () => ({
        getUserById: async (id: number) => {
            if (id === 1) {
                return {
                    id: 1,
                    email: 'test@example.com',
                    role: 'user',
                    tier: 'free',
                    is_active: true,
                    created_at: new Date().toISOString()
                };
            }
            if (id === 2) {
                return {
                    id: 2,
                    email: 'admin@example.com',
                    role: 'admin',
                    tier: 'enterprise',
                    is_active: true,
                    created_at: new Date().toISOString()
                };
            }
            if (id === 3) {
                return {
                    id: 3,
                    email: 'inactive@example.com',
                    role: 'user',
                    tier: 'free',
                    is_active: false,
                    created_at: new Date().toISOString()
                };
            }
            return null;
        }
    }),
    PublicUser: {},
    UserRole: {}
}));

// Mock auth functions
jest.mock('../auth/index', () => ({
    extractToken: (header?: string) => {
        if (!header) return null;
        if (header.startsWith('Bearer ')) return header.substring(7);
        return header;
    },
    verifyToken: async (token: string) => {
        if (token === 'valid-user-token') return { userId: 1, email: 'test@example.com', role: 'user' };
        if (token === 'valid-admin-token') return { userId: 2, email: 'admin@example.com', role: 'admin' };
        if (token === 'inactive-user-token') return { userId: 3, email: 'inactive@example.com', role: 'user' };
        if (token === 'unknown-user-token') return { userId: 999, email: 'unknown@example.com', role: 'user' };
        return null;
    },
    hasPermission: (userRole: string, requiredRole: string) => {
        const roles = ['guest', 'user', 'admin'];
        return roles.indexOf(userRole) >= roles.indexOf(requiredRole);
    },
    isAdmin: (role: string) => role === 'admin'
}));

// Helper to create mock request
function createMockRequest(overrides: Partial<Request> = {}): Request {
    return {
        headers: {},
        cookies: {},
        ...overrides
    } as Request;
}

// Helper to create mock response
function createMockResponse(): Response & { jsonData?: unknown; statusCode?: number } {
    const res: Partial<Response> & { jsonData?: unknown; statusCode?: number } = {
        statusCode: 200,
        jsonData: null,
        status: function(code: number) {
            this.statusCode = code;
            return this as Response;
        },
        json: function(data: unknown) {
            this.jsonData = data;
            return this as Response;
        }
    };
    return res as Response & { jsonData?: unknown; statusCode?: number };
}

describe('Auth Middleware', () => {
    describe('optionalAuth', () => {
        it('should pass through without token', async () => {
            const req = createMockRequest();
            const res = createMockResponse();
            let nextCalled = false;
            const next: NextFunction = () => { nextCalled = true; };
            
            await optionalAuth(req, res, next);
            
            expect(nextCalled).toBe(true);
            expect(req.user).toBeUndefined();
        });

        it('should set user from Bearer token in header', async () => {
            const req = createMockRequest({
                headers: { authorization: 'Bearer valid-user-token' }
            });
            const res = createMockResponse();
            let nextCalled = false;
            const next: NextFunction = () => { nextCalled = true; };
            
            await optionalAuth(req, res, next);
            
            expect(nextCalled).toBe(true);
            expect(req.user).toBeDefined();
            expect(req.user?.email).toBe('test@example.com');
        });

        it('should prefer cookie over header', async () => {
            const req = createMockRequest({
                headers: { authorization: 'Bearer invalid-token' },
                cookies: { auth_token: 'valid-user-token' }
            });
            const res = createMockResponse();
            let nextCalled = false;
            const next: NextFunction = () => { nextCalled = true; };
            
            await optionalAuth(req, res, next);
            
            expect(nextCalled).toBe(true);
            expect(req.user).toBeDefined();
        });

        it('should pass through with invalid token', async () => {
            const req = createMockRequest({
                headers: { authorization: 'Bearer invalid-token' }
            });
            const res = createMockResponse();
            let nextCalled = false;
            const next: NextFunction = () => { nextCalled = true; };
            
            await optionalAuth(req, res, next);
            
            expect(nextCalled).toBe(true);
            expect(req.user).toBeUndefined();
        });
    });

    describe('requireAuth', () => {
        it('should return 401 without token', async () => {
            const req = createMockRequest();
            const res = createMockResponse();
            let nextCalled = false;
            const next: NextFunction = () => { nextCalled = true; };
            
            await requireAuth(req, res, next);
            
            expect(nextCalled).toBe(false);
            expect(res.statusCode).toBe(401);
            expect((res.jsonData as { success: boolean; error: { message: string } })?.error?.message).toContain('인증이 필요합니다');
        });

        it('should return 401 with invalid token', async () => {
            const req = createMockRequest({
                headers: { authorization: 'Bearer invalid-token' }
            });
            const res = createMockResponse();
            let nextCalled = false;
            const next: NextFunction = () => { nextCalled = true; };
            
            await requireAuth(req, res, next);
            
            expect(nextCalled).toBe(false);
            expect(res.statusCode).toBe(401);
            expect((res.jsonData as { success: boolean; error: { message: string } })?.error?.message).toContain('유효하지 않은 토큰');
        });

        it('should return 401 for unknown user', async () => {
            const req = createMockRequest({
                headers: { authorization: 'Bearer unknown-user-token' }
            });
            const res = createMockResponse();
            let nextCalled = false;
            const next: NextFunction = () => { nextCalled = true; };
            
            await requireAuth(req, res, next);
            
            expect(nextCalled).toBe(false);
            expect(res.statusCode).toBe(401);
            expect((res.jsonData as { success: boolean; error: { message: string } })?.error?.message).toContain('사용자를 찾을 수 없습니다');
        });

        it('should return 403 for inactive user', async () => {
            const req = createMockRequest({
                headers: { authorization: 'Bearer inactive-user-token' }
            });
            const res = createMockResponse();
            let nextCalled = false;
            const next: NextFunction = () => { nextCalled = true; };
            
            await requireAuth(req, res, next);
            
            expect(nextCalled).toBe(false);
            expect(res.statusCode).toBe(403);
            expect((res.jsonData as { success: boolean; error: { message: string } })?.error?.message).toContain('비활성화된 계정');
        });

        it('should pass with valid token', async () => {
            const req = createMockRequest({
                headers: { authorization: 'Bearer valid-user-token' }
            });
            const res = createMockResponse();
            let nextCalled = false;
            const next: NextFunction = () => { nextCalled = true; };
            
            await requireAuth(req, res, next);
            
            expect(nextCalled).toBe(true);
            expect(req.user).toBeDefined();
            expect(req.token).toBe('valid-user-token');
        });
    });

    describe('requireAdmin', () => {
        it('should return 401 without user', () => {
            const req = createMockRequest();
            const res = createMockResponse();
            let nextCalled = false;
            const next: NextFunction = () => { nextCalled = true; };
            
            requireAdmin(req, res, next);
            
            expect(nextCalled).toBe(false);
            expect(res.statusCode).toBe(401);
        });

        it('should return 403 for non-admin user', () => {
            const req = createMockRequest();
            req.user = { userId: '1', role: 'user' };
            const res = createMockResponse();
            let nextCalled = false;
            const next: NextFunction = () => { nextCalled = true; };
            
            requireAdmin(req, res, next);
            
            expect(nextCalled).toBe(false);
            expect(res.statusCode).toBe(403);
            expect((res.jsonData as { success: boolean; error: { message: string } })?.error?.message).toContain('관리자 권한');
        });

        it('should pass for admin user', () => {
            const req = createMockRequest();
            req.user = { userId: '2', role: 'admin' };
            const res = createMockResponse();
            let nextCalled = false;
            const next: NextFunction = () => { nextCalled = true; };
            
            requireAdmin(req, res, next);
            
            expect(nextCalled).toBe(true);
        });
    });

    describe('requireRole', () => {
        it('should return 401 without user', () => {
            const req = createMockRequest();
            const res = createMockResponse();
            let nextCalled = false;
            const next: NextFunction = () => { nextCalled = true; };
            
            const middleware = requireRole('user');
            middleware(req, res, next);
            
            expect(nextCalled).toBe(false);
            expect(res.statusCode).toBe(401);
        });

        it('should return 403 when user lacks required role', () => {
            const req = createMockRequest();
            req.user = { userId: '1', role: 'guest' };
            const res = createMockResponse();
            let nextCalled = false;
            const next: NextFunction = () => { nextCalled = true; };
            
            const middleware = requireRole('user');
            middleware(req, res, next);
            
            expect(nextCalled).toBe(false);
            expect(res.statusCode).toBe(403);
        });

        it('should pass when user has required role', () => {
            const req = createMockRequest();
            req.user = { userId: '1', role: 'user' };
            const res = createMockResponse();
            let nextCalled = false;
            const next: NextFunction = () => { nextCalled = true; };
            
            const middleware = requireRole('user');
            middleware(req, res, next);
            
            expect(nextCalled).toBe(true);
        });

        it('should pass when user has higher role', () => {
            const req = createMockRequest();
            req.user = { userId: '2', role: 'admin' };
            const res = createMockResponse();
            let nextCalled = false;
            const next: NextFunction = () => { nextCalled = true; };
            
            const middleware = requireRole('user');
            middleware(req, res, next);
            
            expect(nextCalled).toBe(true);
        });
    });
});
