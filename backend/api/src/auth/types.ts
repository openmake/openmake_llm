/**
 * 인증 타입 정의
 */

import { UserRole, PublicUser } from '../data/user-manager';

// JWT 페이로드
export interface JWTPayload {
    userId: number;
    email: string;
    role: UserRole;
    iat?: number;
    exp?: number;
    jti?: string;
}

// 인증된 요청
export interface AuthenticatedRequest {
    user?: PublicUser;
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
