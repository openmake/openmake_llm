/**
 * ============================================================
 * Auth Core - JWT 토큰 관리 핵심 함수
 * ============================================================
 *
 * JWT 액세스/리프레시 토큰의 생성, 검증, 블랙리스트 관리,
 * 역할 권한 체크 등 인증 핵심 로직을 담당합니다.
 *
 * auth/index.ts와 auth/middleware.ts 간 순환 참조를 방지하기 위해
 * 핵심 함수들을 별도 모듈로 분리합니다.
 *
 * @module auth/auth-core
 */

import * as jwt from 'jsonwebtoken';
import type { Response } from 'express';
import { JWTPayload } from './types';
import { PublicUser, UserRole } from '../data/user-manager';
import * as crypto from 'crypto';
import { getTokenBlacklist } from '../data/models/token-blacklist';
import { getConfig } from '../config/env';
import { AUTH_CONFIG } from '../config/constants';
import { createLogger } from '../utils/logger';

// JWT 비밀키 (환경변수 필수)
// 보안: 런타임 시크릿 생성은 수평 확장 시 노드 간 불일치를 유발하므로 제거
const JWT_SECRET = getConfig().jwtSecret;
const logger = createLogger('Auth');

/**
 * 객체가 유효한 JWT 페이로드인지 타입 가드로 검사합니다.
 *
 * @param obj - 검사할 객체
 * @returns JWTPayload 타입 여부
 */
function isValidJWTPayload(obj: unknown): obj is JWTPayload {
    if (!obj || typeof obj !== 'object') return false;
    const record = obj as Record<string, unknown>;
    return typeof record.userId === 'string' || typeof record.userId === 'number';
}

// JWT_SECRET 미설정 시 프로덕션 환경에서는 즉시 종료
if (!JWT_SECRET) {
    if (getConfig().nodeEnv === 'test') {
        // 테스트 환경에서는 경고만 (테스트 프레임워크에서 자체 설정)
        logger.warn('⚠️ JWT_SECRET이 설정되지 않았습니다 (테스트 환경)');
    } else if (getConfig().nodeEnv === 'production') {
        logger.error('❌ JWT_SECRET 환경변수가 설정되지 않았습니다!');
        logger.error('프로덕션 환경에서는 JWT_SECRET이 필수입니다.');
        logger.error('생성 방법: openssl rand -hex 32');
        process.exit(1);
    } else {
        logger.error('❌ JWT_SECRET 환경변수가 설정되지 않았습니다!');
        logger.error('.env 파일에 JWT_SECRET을 반드시 설정하세요.');
        logger.error('생성 방법: openssl rand -hex 32');
        throw new Error('[Auth] JWT_SECRET 환경변수가 필수입니다. .env 파일에 설정하세요.');
    }
}


/**
 * JWT 액세스 토큰 생성
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
        expiresIn: AUTH_CONFIG.TOKEN_EXPIRY,
        jwtid: jti
    });
}

/**
 * 🔒 Phase 2 보안 패치: JWT 리프레시 토큰 생성
 *
 * 액세스 토큰(15분)이 만료된 후 새 액세스 토큰을 발급받기 위한 장기 토큰입니다.
 * - 만료: 7일
 * - jti 포함 (블랙리스트 지원)
 * - type: 'refresh' 필드로 액세스 토큰과 구분
 */
export function generateRefreshToken(user: PublicUser): string {
    const payload = {
        userId: user.id,
        email: user.email,
        role: user.role,
        type: 'refresh' as const
    };

    const jti = crypto.randomBytes(16).toString('hex');

    return jwt.sign(payload, JWT_SECRET, {
        expiresIn: AUTH_CONFIG.REFRESH_TOKEN_EXPIRY,
        jwtid: jti
    });
}

/**
 * 🔒 Phase 2: 리프레시 토큰 검증
 * 액세스 토큰 갱신용 리프레시 토큰을 검증합니다.
 *
 * @returns 검증된 페이로드 또는 null
 */
export async function verifyRefreshToken(token: string): Promise<JWTPayload | null> {
    try {
        // 블랙리스트 확인
         const preCheck = jwt.decode(token) as Record<string, unknown> | null;
         if (preCheck?.jti && typeof preCheck.jti === 'string') {
             try {
                 const blacklist = getTokenBlacklist();
                 if (await blacklist.has(preCheck.jti)) {
                     logger.warn('블랙리스트된 리프레시 토큰 사용 시도');
                     return null;
                 }
             } catch {
                 // 블랙리스트 DB 접근 실패 시 무시 (가용성 우선)
             }
         }

         // type이 'refresh'인지 확인
         if (preCheck?.type !== 'refresh') {
             logger.warn('리프레시 토큰이 아닌 토큰으로 갱신 시도');
             return null;
         }

         const decoded = jwt.verify(token, JWT_SECRET);
         if (!isValidJWTPayload(decoded)) {
             logger.warn('JWT 페이로드 형식 불일치');
             return null;
         }
         return decoded;
     } catch (error) {
         logger.error('리프레시 토큰 검증 실패:', error);
         return null;
     }
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
                     logger.warn('블랙리스트된 토큰 사용 시도');
                     return null;
                 }
             } catch {
                 // 블랙리스트 DB 접근 실패 시 무시 (가용성 우선)
             }
         }

         // refresh token으로 access 인증 시도 차단
         // refresh token(7일 수명)이 access token(15분) 대신 사용되는 것을 방지
         if (preCheck?.type === 'refresh') {
             logger.warn('refresh 토큰으로 access 인증 시도 차단');
             return null;
         }

         const decoded = jwt.verify(token, JWT_SECRET);
         if (!isValidJWTPayload(decoded)) {
             logger.warn('JWT 페이로드 형식 불일치');
             return null;
         }
         return decoded;
     } catch (error) {
         // jwt malformed / expired 등은 정상적 상황 (만료 쿠키) — 스택트레이스 없이 간단 로그
         const errName = error instanceof Error ? error.name : '';
         if (errName === 'JsonWebTokenError' || errName === 'TokenExpiredError') {
             logger.warn(`토큰 검증 실패: ${errName} — ${(error as Error).message}`);
         } else {
             logger.error('토큰 검증 실패:', error);
         }
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
            : Date.now() + AUTH_CONFIG.ACCESS_TOKEN_MAX_AGE_MS; // 기본 15분

        const blacklist = getTokenBlacklist();
         await blacklist.add(decoded.jti, expiresAt);
         logger.info(`🚫 토큰 블랙리스트 추가: ${decoded.jti.substring(0, 8)}...`);
         return true;
     } catch (error) {
         logger.error('토큰 블랙리스트 추가 실패:', error);
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

/**
 * 토큰을 httpOnly 쿠키에 설정
 * 🔒 Phase 2: 액세스 토큰 쿠키 (15분 만료)
 */
export function setTokenCookie(res: Response, token: string): void {
    res.cookie('auth_token', token, {
        httpOnly: true,
        secure: getConfig().cookieSecure,
        sameSite: 'lax',
        maxAge: AUTH_CONFIG.ACCESS_TOKEN_MAX_AGE_MS, // 15분 (액세스 토큰 수명과 일치)
        path: '/'
    });
}

/**
 * 🔒 Phase 2: 리프레시 토큰을 httpOnly 쿠키에 설정 (7일 만료)
 */
export function setRefreshTokenCookie(res: Response, refreshToken: string): void {
    res.cookie('refresh_token', refreshToken, {
        httpOnly: true,
        secure: getConfig().cookieSecure,
        sameSite: 'lax',
        maxAge: AUTH_CONFIG.REFRESH_TOKEN_MAX_AGE_MS, // 7일
        path: '/api/auth/refresh' // 리프레시 엔드포인트에서만 전송
    });
}

/**
 * 토큰 쿠키 삭제
 * 🔒 Phase 2: 액세스 + 리프레시 쿠키 모두 삭제
 */
export function clearTokenCookie(res: Response): void {
    res.clearCookie('auth_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/api/auth/refresh' });
}
