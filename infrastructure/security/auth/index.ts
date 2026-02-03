/**
 * 인증 모듈
 * JWT 토큰 생성/검증 및 인증 유틸리티
 * 
 * 🔒 개선: 토큰 블랙리스트 및 리프레시 토큰 메커니즘 추가
 */

import * as jwt from 'jsonwebtoken';
import { JWTPayload, PublicUser, UserRole } from './types';
import * as crypto from 'crypto';

// ============================================
// 🔒 토큰 블랙리스트 (로그아웃/강제 만료)
// #8 개선: 인메모리 + SQLite 영속화 (서버 재시작 시에도 유지)
// ============================================

// 인메모리 캐시 (빠른 조회용)
const tokenBlacklist = new Map<string, number>();
const BLACKLIST_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1시간마다 정리

// #8: SQLite 영속화 콜백 (앱 초기화 시 등록)
type BlacklistPersistFn = {
    save: (jti: string, expiresAt: number) => void;
    has: (jti: string) => boolean;
    loadAll: () => Array<{ jti: string; expires_at: number }>;
    cleanup: () => number;
};
let _blacklistPersist: BlacklistPersistFn | null = null;

/**
 * #8: 블랙리스트 영속화 함수 등록
 * SQLite 등 외부 스토리지 연동을 위한 DI
 */
export function registerBlacklistPersistence(fns: BlacklistPersistFn): void {
    _blacklistPersist = fns;
    // 기존 영속 데이터 로드
    try {
        const entries = fns.loadAll();
        const now = Date.now();
        let loaded = 0;
        for (const entry of entries) {
            if (entry.expires_at > now) {
                tokenBlacklist.set(entry.jti, entry.expires_at);
                loaded++;
            }
        }
        console.log(`[Auth] 🔒 영속화된 블랙리스트 ${loaded}개 로드됨`);
    } catch (e) {
        console.error('[Auth] 블랙리스트 로드 실패:', e);
    }
}

// 블랙리스트 정리 스케줄러
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [tokenId, expTime] of tokenBlacklist.entries()) {
        if (expTime < now) {
            tokenBlacklist.delete(tokenId);
            cleaned++;
        }
    }
    // #8: 영속 스토리지도 정리
    if (_blacklistPersist) {
        cleaned += _blacklistPersist.cleanup();
    }
    if (cleaned > 0) {
        console.log(`[Auth] 🧹 만료된 블랙리스트 토큰 ${cleaned}개 정리됨`);
    }
}, BLACKLIST_CLEANUP_INTERVAL);

/**
 * 🔒 토큰을 블랙리스트에 추가 (로그아웃 시)
 * #8 개선: 인메모리 + 영속 스토리지에 저장
 */
export function blacklistToken(token: string): void {
    try {
        const decoded = jwt.decode(token) as any;
        if (decoded?.jti && decoded?.exp) {
            const expiresAt = decoded.exp * 1000;
            tokenBlacklist.set(decoded.jti, expiresAt);
            // #8: 영속 스토리지에도 저장
            _blacklistPersist?.save(decoded.jti, expiresAt);
            console.log(`[Auth] 🚫 토큰 블랙리스트 추가: ${decoded.jti.substring(0, 8)}...`);
        }
    } catch (e) {
        console.error('[Auth] 토큰 블랙리스트 추가 실패:', e);
    }
}

/**
 * 🔒 토큰이 블랙리스트에 있는지 확인
 * #8 개선: 인메모리 캐시 → 영속 스토리지 순으로 확인
 */
export function isTokenBlacklisted(token: string): boolean {
    try {
        const decoded = jwt.decode(token) as any;
        if (decoded?.jti) {
            // 인메모리 캐시 먼저 확인 (빠름)
            if (tokenBlacklist.has(decoded.jti)) {
                return true;
            }
            // #8: 영속 스토리지 확인 (인메모리에 없을 경우 - 서버 재시작 후)
            if (_blacklistPersist?.has(decoded.jti)) {
                // 인메모리 캐시에 다시 추가
                if (decoded.exp) {
                    tokenBlacklist.set(decoded.jti, decoded.exp * 1000);
                }
                return true;
            }
        }
    } catch (e) {
        // 디코딩 실패 시 false 반환
    }
    return false;
}

/**
 * 🔒 블랙리스트 통계
 */
export function getBlacklistStats(): { count: number; persisted: boolean } {
    return { count: tokenBlacklist.size, persisted: !!_blacklistPersist };
}

// 🔒 보안 강화: JWT 비밀키 검증 및 관리
const MIN_JWT_SECRET_LENGTH = 32; // 최소 256비트

const generateDevSecret = () => {
    return `dev-session-${crypto.randomBytes(32).toString('hex')}`;
};

// JWT Secret 검증 및 설정
let JWT_SECRET: string;
const JWT_EXPIRES_IN = '7d';

if (process.env.JWT_SECRET) {
    // 🔒 Secret 길이 검증
    if (process.env.JWT_SECRET.length < MIN_JWT_SECRET_LENGTH) {
        console.error(`[Auth] ❌ JWT_SECRET이 너무 짧습니다! (현재: ${process.env.JWT_SECRET.length}자, 최소: ${MIN_JWT_SECRET_LENGTH}자)`);
        console.error('[Auth] 보안을 위해 32자 이상의 랜덤 문자열을 사용하세요.');
        console.error('[Auth] 생성 방법: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
        if (process.env.NODE_ENV === 'production') {
            throw new Error('[Auth] 프로덕션 환경에서는 충분히 긴 JWT_SECRET이 필수입니다!');
        }
    }
    JWT_SECRET = process.env.JWT_SECRET;
    console.log('[Auth] ✅ JWT_SECRET 설정 완료');
} else {
    // 개발 환경에서만 임시 시크릿 생성
    if (process.env.NODE_ENV === 'production') {
        throw new Error('[Auth] 프로덕션 환경에서는 JWT_SECRET 환경변수가 필수입니다!');
    }
    
    JWT_SECRET = generateDevSecret();
    console.warn('[Auth] ⚠️ ========================================');
    console.warn('[Auth] ⚠️ JWT_SECRET 환경변수가 설정되지 않았습니다!');
    console.warn('[Auth] ⚠️ 개발 환경용 임시 시크릿이 자동 생성되었습니다.');
    console.warn('[Auth] ⚠️ 서버 재시작 시 모든 기존 토큰이 무효화됩니다!');
    console.warn('[Auth] ⚠️ .env 파일에 JWT_SECRET을 반드시 설정하세요.');
    console.warn('[Auth] ⚠️ ========================================');
}


/**
 * JWT 토큰 생성
 * 🔒 jti (JWT ID) 추가로 블랙리스트 지원
 */
export function generateToken(user: PublicUser): string {
    const payload: JWTPayload = {
        userId: user.id,
        email: user.email || '',
        role: user.role
    };

    // 🔒 고유 토큰 ID 추가 (블랙리스트 지원)
    const jti = crypto.randomBytes(16).toString('hex');
    
    return jwt.sign(payload, JWT_SECRET, { 
        expiresIn: JWT_EXPIRES_IN,
        jwtid: jti
    });
}

/**
 * 🔒 리프레시 토큰 생성 (장기 토큰)
 * - 액세스 토큰 만료 시 새 토큰 발급에 사용
 * - 30일 만료
 */
export function generateRefreshToken(user: PublicUser): string {
    const payload = {
        userId: user.id,
        type: 'refresh'
    };

    const jti = crypto.randomBytes(16).toString('hex');
    
    return jwt.sign(payload, JWT_SECRET, { 
        expiresIn: '30d',
        jwtid: jti
    });
}

/**
 * 🔒 리프레시 토큰 검증
 */
export function verifyRefreshToken(token: string): { userId: string } | null {
    try {
        if (isTokenBlacklisted(token)) {
            console.warn('[Auth] 블랙리스트된 리프레시 토큰');
            return null;
        }
        
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        if (decoded.type !== 'refresh') {
            return null;
        }
        return { userId: decoded.userId };
    } catch (error) {
        console.error('[Auth] 리프레시 토큰 검증 실패:', error);
        return null;
    }
}

/**
 * JWT 토큰 검증
 * 🔒 블랙리스트 확인 추가
 */
export function verifyToken(token: string): JWTPayload | null {
    try {
        // 🔒 블랙리스트 확인
        if (isTokenBlacklisted(token)) {
            console.warn('[Auth] 블랙리스트된 토큰 사용 시도');
            return null;
        }
        
        const decoded = jwt.verify(token, JWT_SECRET) as unknown as JWTPayload;
        return decoded;
    } catch (error) {
        console.error('[Auth] 토큰 검증 실패:', error);
        return null;
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
export { optionalAuth, requireAuth, requireAdmin, requireRole, registerUserLookup } from './middleware';
