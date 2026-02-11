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

// Auth request/response types → services/AuthService.ts (RegisterRequest, LoginRequest, AuthResult)

// OAuth 응답 타입
export interface OAuthTokenResponse {
    access_token: string;
    token_type?: string;
    scope?: string;
    refresh_token?: string;
    expires_in?: number;
}

export interface GoogleUserInfo {
    sub: string;
    email: string;
    name?: string;
    picture?: string;
    email_verified?: boolean;
}

export interface GitHubUser {
    id: number;
    login: string;
    email?: string;
    name?: string;
    avatar_url?: string;
}

export interface GitHubEmail {
    email: string;
    primary: boolean;
    verified: boolean;
    visibility?: string | null;
}
