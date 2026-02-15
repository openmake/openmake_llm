/**
 * ============================================================
 * Auth Middleware - Express 인증 미들웨어
 * ============================================================
 *
 * JWT 토큰 기반 인증 미들웨어를 제공합니다.
 * Cookie → Authorization 헤더 순서로 토큰을 추출하며, DB 조회로 사용자를 확인합니다.
 *
 * @module auth/middleware
 * @description
 * - optionalAuth: 게스트 허용 (토큰 없어도 통과)
 * - requireAuth: 인증 필수 (401 반환)
 * - requireAdmin: 관리자 권한 필수 (403 반환)
 * - requireRole: 특정 역할 이상 필수 (팩토리 함수)
 * - Express.Request 타입 확장 (user, token, authMethod, apiKeyRecord, requestId)
 */

import { Request, Response, NextFunction } from 'express';
import { extractToken, verifyToken, hasPermission, isAdmin } from './index';
import { getUserManager, PublicUser, UserRole } from '../data/user-manager';

/**
 * JWT 토큰에서 추출된 인증 정보 (미들웨어용)
 * PublicUser보다 간소화된 버전 - JWT 페이로드에서 직접 추출
 * @interface AuthUser
 */
export interface AuthUser {
    /** JWT 페이로드의 userId */
    userId: string;
    /** 사용자 ID (DB 조회 후 설정) */
    id?: string | number;
    /** 사용자명 */
    username?: string;
    /** 이메일 주소 */
    email?: string;
    /** 사용자 역할 */
    role: UserRole;
    /** MCP 도구 접근 등급 */
    tier?: 'free' | 'pro' | 'enterprise';
    /** 계정 활성화 상태 */
    is_active?: boolean;
    /** 계정 생성 일시 */
    created_at?: string;
    /** 마지막 로그인 일시 */
    last_login?: string;
}

// Request 타입 확장
// user는 PublicUser (DB 조회) 또는 AuthUser (JWT 직접 추출) 가능
declare global {
    namespace Express {
        interface Request {
            /** 인증된 사용자 정보 - PublicUser(DB) 또는 AuthUser(JWT) */
            user?: PublicUser | AuthUser;
            token?: string;
            cookies?: Record<string, string>;

            /** API Key 인증 정보 (Phase 2) */
            authMethod?: 'jwt' | 'api-key';
            apiKeyId?: string;
            apiKeyRecord?: import('../data/models/unified-database').UserApiKey;

            /** Request ID (Phase 2) */
            requestId?: string;
        }
    }
}

/**
 * 인증 미들웨어 (선택적)
 * 토큰이 있으면 검증하고 사용자 정보를 req.user에 추가
 * 토큰이 없어도 통과 (게스트 허용)
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
    // Cookie first (httpOnly), then Authorization header (backward compat)
    const authHeader = req.headers.authorization;
    const token = (req.cookies?.auth_token) || extractToken(authHeader);

    if (token) {
        const payload = await verifyToken(token);

        if (payload) {
            const userManager = getUserManager();
            const user = await userManager.getUserById(payload.userId);

            if (user && user.is_active) {
                req.user = user;
                req.token = token;
            }
        }
    }

    next();
}

/**
 * 인증 필수 미들웨어
 * 유효한 토큰이 없으면 401 반환
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Cookie first (httpOnly), then Authorization header (backward compat)
    const authHeader = req.headers.authorization;
    const token = (req.cookies?.auth_token) || extractToken(authHeader);

    if (!token) {
        res.status(401).json({ success: false, error: { message: '인증이 필요합니다' } });
        return;
    }

    const payload = await verifyToken(token);

    if (!payload) {
        res.status(401).json({ success: false, error: { message: '유효하지 않은 토큰입니다' } });
        return;
    }

    const userManager = getUserManager();
    const user = await userManager.getUserById(payload.userId);

    if (!user) {
        res.status(401).json({ success: false, error: { message: '사용자를 찾을 수 없습니다' } });
        return;
    }

    if (!user.is_active) {
        res.status(403).json({ success: false, error: { message: '비활성화된 계정입니다' } });
        return;
    }

    req.user = user;
    req.token = token;
    next();
}

/**
 * 관리자 권한 필수 미들웨어
 * requireAuth 이후에 사용
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
    if (!req.user) {
        res.status(401).json({ success: false, error: { message: '인증이 필요합니다' } });
        return;
    }

    if (!isAdmin(req.user.role)) {
        res.status(403).json({ success: false, error: { message: '관리자 권한이 필요합니다' } });
        return;
    }

    next();
}

/**
 * 특정 역할 필수 미들웨어 팩토리
 */
export function requireRole(role: UserRole) {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (!req.user) {
            res.status(401).json({ success: false, error: { message: '인증이 필요합니다' } });
            return;
        }

        if (!hasPermission(req.user.role, role)) {
            res.status(403).json({ success: false, error: { message: `${role} 이상의 권한이 필요합니다` } });
            return;
        }

        next();
    };
}
