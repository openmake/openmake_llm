/**
 * 인증 모듈
 * JWT 토큰 생성/검증 및 인증 유틸리티
 * 
 * #8 연동: 토큰 블랙리스트 (PostgreSQL-backed) 통합
 */

import * as jwt from 'jsonwebtoken';
import type { Response } from 'express';
import { JWTPayload } from './types';
import { PublicUser, UserRole } from '../data/user-manager';
import * as crypto from 'crypto';
import { getTokenBlacklist } from '../data/models/token-blacklist';

// JWT 비밀키 (환경변수 필수)
// 보안: 런타임 시크릿 생성은 수평 확장 시 노드 간 불일치를 유발하므로 제거
const JWT_SECRET = process.env.JWT_SECRET || '';
const JWT_EXPIRES_IN = '15m';  // Access token - short lived for security
const REFRESH_TOKEN_EXPIRES_IN = '7d';  // Refresh token - longer lived

// JWT_SECRET 미설정 시 모든 환경에서 에러 (테스트 환경 제외)
if (!JWT_SECRET) {
    if (process.env.NODE_ENV === 'test') {
        // 테스트 환경에서는 경고만 (테스트 프레임워크에서 자체 설정)
        console.warn('[Auth] ⚠️ JWT_SECRET이 설정되지 않았습니다 (테스트 환경)');
    } else {
        console.error('[Auth] ❌ JWT_SECRET 환경변수가 설정되지 않았습니다!');
        console.error('[Auth] .env 파일에 JWT_SECRET을 반드시 설정하세요.');
        console.error('[Auth] 예: JWT_SECRET=$(openssl rand -hex 32)');
        throw new Error('[Auth] JWT_SECRET 환경변수가 필수입니다. .env 파일에 설정하세요.');
    }
}


/**
 * JWT 토큰 생성
 * #8 연동: jti (JWT ID) 추가로 블랙리스트 지원
 */
export function generateToken(user: PublicUser): string {
    const payload: JWTPayload = {
        userId: user.id,
        email: user.email,
        role: user.role
    };

    // jti(JWT ID)를 추가하여 토큰 단위 블랙리스트 지원
    const jti = crypto.randomBytes(16).toString('hex');

    return jwt.sign(payload, JWT_SECRET, { 
        expiresIn: JWT_EXPIRES_IN,
        jwtid: jti
    });
}

/**
 * JWT 토큰 검증
 * #8 연동: 블랙리스트 확인 추가
 */
export async function verifyToken(token: string): Promise<JWTPayload | null> {
    try {
        // 블랙리스트 확인 (jti 기반)
        const preCheck = jwt.decode(token) as Record<string, unknown> | null;
        if (preCheck?.jti && typeof preCheck.jti === 'string') {
            try {
                const blacklist = getTokenBlacklist();
                if (await blacklist.has(preCheck.jti)) {
                    console.warn('[Auth] 블랙리스트된 토큰 사용 시도');
                    return null;
                }
            } catch {
                // 블랙리스트 DB 접근 실패 시 무시 (가용성 우선)
            }
        }

        const decoded = jwt.verify(token, JWT_SECRET) as unknown as JWTPayload;
        return decoded;
    } catch (error) {
        console.error('[Auth] 토큰 검증 실패:', error);
        return null;
    }
}

/**
 * 토큰을 블랙리스트에 추가 (로그아웃 시 호출)
 * #8 연동: PostgreSQL 기반 영속 블랙리스트
 */
export async function blacklistToken(token: string): Promise<boolean> {
    try {
        const decoded = jwt.decode(token) as Record<string, unknown> | null;
        if (!decoded?.jti || typeof decoded.jti !== 'string') {
            // jti 없는 레거시 토큰 — 블랙리스트 불가
            return false;
        }
        const expiresAt = typeof decoded.exp === 'number' 
            ? decoded.exp * 1000 
            : Date.now() + 15 * 60 * 1000; // 기본 15분
        
        const blacklist = getTokenBlacklist();
        await blacklist.add(decoded.jti, expiresAt);
        console.log(`[Auth] 🚫 토큰 블랙리스트 추가: ${decoded.jti.substring(0, 8)}...`);
        return true;
    } catch (error) {
        console.error('[Auth] 토큰 블랙리스트 추가 실패:', error);
        return false;
    }
}

/**
 * Authorization 헤더에서 토큰 추출
 */
export function extractToken(authHeader?: string): string | null {
    if (!authHeader) return null;

    // "Bearer <token>" 형식
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7);
    }

    return authHeader;
}

/**
 * 역할 권한 체크
 */
export function hasPermission(userRole: UserRole, requiredRole: UserRole): boolean {
    const roleHierarchy: Record<UserRole, number> = {
        'admin': 3,
        'user': 2,
        'guest': 1
    };

    return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}

/**
 * 관리자 여부 확인
 */
export function isAdmin(role: UserRole): boolean {
    return role === 'admin';
}

// 모듈 재-export
export * from './types';
export { optionalAuth, requireAuth, requireAdmin, requireRole } from './middleware';

/**
 * 토큰을 httpOnly 쿠키에 설정
 */
export function setTokenCookie(res: Response, token: string): void {
    res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days (refresh token lifetime)
        path: '/'
    });
}

/**
 * 토큰 쿠키 삭제
 */
export function clearTokenCookie(res: Response): void {
    res.clearCookie('auth_token', { path: '/' });
}
