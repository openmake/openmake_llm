/**
 * 인증 미들웨어
 * Express 요청에 대한 인증 처리
 * 
 * #5 개선: 역방향 참조 제거 - getUserById를 DI(의존성 주입)로 전환
 */

import { Request, Response, NextFunction } from 'express';
import { extractToken, verifyToken, hasPermission, isAdmin } from './index';
import { PublicUser, AuthUser, UserRole } from './types';

// NOTE: Express.Request.user 타입은 backend/api/src/auth/middleware.ts에서
// declare global로 선언됨. 빌드된 .d.ts와 중복 선언 충돌을 방지하기 위해
// 이 모듈에서는 global 타입을 재선언하지 않음.

/**
 * 사용자 조회 함수 타입
 * 외부에서 주입하여 역방향 의존성 제거
 */
type UserLookupFn = (userId: string) => PublicUser | null;

let _userLookup: UserLookupFn | null = null;

/**
 * 사용자 조회 함수 등록 (앱 초기화 시 호출)
 * 
 * @example
 * ```typescript
 * import { registerUserLookup } from './infrastructure/security/auth/middleware';
 * import { getUserManager } from './data/user-manager';
 * 
 * registerUserLookup((userId) => getUserManager().getUserById(userId));
 * ```
 */
export function registerUserLookup(fn: UserLookupFn): void {
    _userLookup = fn;
    console.log('[Auth Middleware] 사용자 조회 함수 등록됨');
}

function getUserById(userId: string): PublicUser | null {
    if (!_userLookup) {
        console.error('[Auth Middleware] 사용자 조회 함수가 등록되지 않았습니다! registerUserLookup()을 호출하세요.');
        return null;
    }
    return _userLookup(userId);
}

/**
 * 인증 미들웨어 (선택적)
 * 토큰이 있으면 검증하고 사용자 정보를 req.user에 추가
 * 토큰이 없어도 통과 (게스트 허용)
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;
    const token = extractToken(authHeader);

    if (token) {
        const payload = verifyToken(token);

        if (payload) {
            const user = getUserById(payload.userId);

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
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;
    const token = extractToken(authHeader);

    if (!token) {
        res.status(401).json({ error: '인증이 필요합니다' });
        return;
    }

    const payload = verifyToken(token);

    if (!payload) {
        res.status(401).json({ error: '유효하지 않은 토큰입니다' });
        return;
    }

    const user = getUserById(payload.userId);

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
