/**
 * ============================================================
 * Auth Types - 인증 관련 타입 정의
 * ============================================================
 *
 * JWT 페이로드, OAuth 응답, 소셜 로그인 사용자 정보 등
 * 인증 시스템 전반에서 사용되는 타입을 정의합니다.
 *
 * @module auth/types
 * @description
 * - JWTPayload: 액세스/리프레시 토큰 페이로드
 * - OAuthTokenResponse: OAuth 토큰 교환 응답
 * - GoogleUserInfo / GitHubUser / GitHubEmail: 소셜 로그인 사용자 정보
 */

import { UserRole, PublicUser } from '../data/user-manager';

/**
 * JWT 토큰 페이로드 인터페이스
 * jwt.sign()으로 서명되어 토큰에 포함되는 데이터
 * @interface JWTPayload
 */
export interface JWTPayload {
    /** 사용자 고유 식별자 */
    userId: string;
    /** 사용자 이메일 */
    email: string;
    /** 사용자 역할 (admin/user/guest) */
    role: UserRole;
    /** 토큰 발급 시각 (jwt 자동 생성, epoch seconds) */
    iat?: number;
    /** 토큰 만료 시각 (epoch seconds) */
    exp?: number;
    /** JWT ID - 블랙리스트 지원용 고유 식별자 */
    jti?: string;
}

/**
 * 인증된 Express 요청 확장 인터페이스
 * @interface AuthenticatedRequest
 */
export interface AuthenticatedRequest {
    /** 인증된 사용자 정보 */
    user?: PublicUser;
    /** 인증 토큰 문자열 */
    token?: string;
}

// Auth request/response types -> services/AuthService.ts (RegisterRequest, LoginRequest, AuthResult)

/**
 * OAuth 토큰 교환 응답 인터페이스
 * Google/GitHub OAuth 프로바이더로부터 받는 토큰 정보
 * @interface OAuthTokenResponse
 */
export interface OAuthTokenResponse {
    /** OAuth 액세스 토큰 */
    access_token: string;
    /** 토큰 타입 (보통 'Bearer') */
    token_type?: string;
    /** 허용된 스코프 */
    scope?: string;
    /** 리프레시 토큰 (Google만 제공) */
    refresh_token?: string;
    /** 토큰 만료 시간 (초) */
    expires_in?: number;
}

/**
 * Google OAuth 사용자 정보
 * Google userinfo API 응답
 * @interface GoogleUserInfo
 */
export interface GoogleUserInfo {
    /** Google 사용자 고유 ID */
    sub: string;
    /** 이메일 주소 */
    email: string;
    /** 표시 이름 */
    name?: string;
    /** 프로필 사진 URL */
    picture?: string;
    /** 이메일 인증 여부 */
    email_verified?: boolean;
}

/**
 * GitHub OAuth 사용자 정보
 * GitHub user API 응답
 * @interface GitHubUser
 */
export interface GitHubUser {
    /** GitHub 사용자 숫자 ID */
    id: number;
    /** GitHub 로그인 사용자명 */
    login: string;
    /** 공개 이메일 (비공개일 수 있음) */
    email?: string;
    /** 표시 이름 */
    name?: string;
    /** 프로필 아바타 URL */
    avatar_url?: string;
}

/**
 * GitHub 이메일 정보
 * GitHub user/emails API 응답 항목
 * @interface GitHubEmail
 */
export interface GitHubEmail {
    /** 이메일 주소 */
    email: string;
    /** 기본 이메일 여부 */
    primary: boolean;
    /** 이메일 인증 여부 */
    verified: boolean;
    /** 이메일 공개 설정 */
    visibility?: string | null;
}
