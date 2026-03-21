/**
 * ============================================================
 * Auth Module - 인증 모듈 배럴 익스포트
 * ============================================================
 *
 * auth-core.ts의 JWT 함수와 middleware.ts의 Express 미들웨어,
 * types.ts의 타입 정의를 단일 진입점으로 재수출합니다.
 *
 * @module auth
 */

// 핵심 인증 함수 (auth-core.ts에서 정의)
export {
    generateToken,
    generateRefreshToken,
    verifyRefreshToken,
    verifyToken,
    blacklistToken,
    extractToken,
    hasPermission,
    isAdmin,
    setTokenCookie,
    setRefreshTokenCookie,
    clearTokenCookie,
} from './auth-core';

// 모듈 재-export
export * from './types';
export { optionalAuth, requireAuth, requireAdmin, requireRole } from './middleware';
