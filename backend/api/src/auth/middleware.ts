/**
 * 인증 미들웨어
 * Express 요청에 대한 인증 처리
 */

import { Request, Response, NextFunction } from 'express';
import { extractToken, verifyToken, hasPermission, isAdmin } from './index';
import { getUserManager, PublicUser, UserRole } from '../data/user-manager';

/**
 * JWT 토큰에서 추출된 인증 정보 (미들웨어용)
 * PublicUser보다 간소화된 버전 - JWT 페이로드에서 직접 추출
 */
export interface AuthUser {
    userId: string;
    id?: string | number;
    username?: string;
    email?: string;
    role: UserRole;
    tier?: 'free' | 'pro' | 'enterprise';
    is_active?: boolean;
    created_at?: string;
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
        }
    }
}

/**
 * 인증 미들웨어 (선택적)
 * 토큰이 있으면 검증하고 사용자 정보를 req.user에 추가
 * 토큰이 없어도 통과 (게스트 허용)
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
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
        res.status(401).json({ error: '인증이 필요합니다' });
        return;
    }

    const payload = await verifyToken(token);

    if (!payload) {
        res.status(401).json({ error: '유효하지 않은 토큰입니다' });
        return;
    }

    const userManager = getUserManager();
    const user = await userManager.getUserById(payload.userId);

    if (!user) {
        res.status(401).json({ error: '사용자를 찾을 수 없습니다' });
        return;
    }

    if (!user.is_active) {
        res.status(403).json({ error: '비활성화된 계정입니다' });
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
        res.status(401).json({ error: '인증이 필요합니다' });
        return;
    }

    if (!isAdmin(req.user.role)) {
        res.status(403).json({ error: '관리자 권한이 필요합니다' });
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
            res.status(401).json({ error: '인증이 필요합니다' });
            return;
        }

        if (!hasPermission(req.user.role, role)) {
            res.status(403).json({ error: `${role} 이상의 권한이 필요합니다` });
            return;
        }

        next();
    };
}
