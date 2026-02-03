/**
 * 인증 타입 정의
 */

// 공유 타입 정의 (#5: 역방향 참조 제거 - 자체 정의로 전환)
export type UserRole = 'admin' | 'user' | 'guest';

export interface PublicUser {
    id: string;
    username: string;
    email?: string;
    role: UserRole;
    created_at: string;
    last_login?: string;
    is_active: boolean;
}

// JWT 페이로드
export interface JWTPayload {
    userId: string;
    email: string;
    role: UserRole;
    iat?: number;
    exp?: number;
    jti?: string;
}

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

// 인증된 요청
export interface AuthenticatedRequest {
    user?: PublicUser | AuthUser;
    token?: string;
}

// 로그인 요청
export interface LoginRequest {
    email: string;
    password: string;
}

// 회원가입 요청
export interface RegisterRequest {
    email: string;
    password: string;
}

// 로그인 응답
export interface LoginResponse {
    success: boolean;
    token?: string;
    user?: PublicUser;
    error?: string;
}

// 회원가입 응답
export interface RegisterResponse {
    success: boolean;
    user?: PublicUser;
    error?: string;
}
