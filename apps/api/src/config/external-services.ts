/**
 * ============================================================
 * 외부 서비스 URL 상수 중앙 관리
 * ============================================================
 * GitHub API, Google OAuth, Swagger CDN 등
 * 외부 서비스 엔드포인트 URL을 정의합니다.
 *
 * @module config/external-services
 */

// ============================================
// GitHub API
// ============================================

/**
 * GitHub API 관련 URL
 */
export const GITHUB_API = {
    /** GitHub 코드 검색 API */
    SEARCH_CODE: 'https://api.github.com/search/code',
    /** GitHub 리포지토리 콘텐츠 API (prefix) */
    REPO_CONTENTS: 'https://api.github.com/repos',
    /** GitHub 사용자 정보 API */
    USER_INFO: 'https://api.github.com/user',
    /** GitHub 사용자 이메일 API */
    USER_EMAILS: 'https://api.github.com/user/emails',
} as const;

// ============================================
// Google OAuth
// ============================================

/**
 * Google OAuth 2.0 관련 URL
 * controllers/auth.controller.ts에서 참조
 */
export const GOOGLE_OAUTH = {
    /** Google 인증 페이지 URL */
    AUTH_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
    /** Google 토큰 교환 URL */
    TOKEN_URL: 'https://oauth2.googleapis.com/token',
    /** Google 사용자 정보 URL */
    USERINFO_URL: 'https://www.googleapis.com/oauth2/v2/userinfo',
} as const;

// ============================================
// GitHub OAuth
// ============================================

/**
 * GitHub OAuth 관련 URL
 * controllers/auth.controller.ts에서 참조
 */
export const GITHUB_OAUTH = {
    /** GitHub 인증 페이지 URL */
    AUTH_URL: 'https://github.com/login/oauth/authorize',
    /** GitHub 토큰 교환 URL */
    TOKEN_URL: 'https://github.com/login/oauth/access_token',
} as const;

// ============================================
// Swagger UI CDN
// ============================================

/**
 * Swagger UI CDN 리소스 URL
 * swagger.ts에서 참조
 */
export const SWAGGER_CDN = {
    /** Swagger UI CDN 버전 */
    VERSION: '5.11.0',
    /** Swagger UI CSS URL */
    get CSS_URL(): string {
        return `https://unpkg.com/swagger-ui-dist@${this.VERSION}/swagger-ui.css`;
    },
    /** Swagger UI Bundle JS URL */
    get BUNDLE_JS_URL(): string {
        return `https://unpkg.com/swagger-ui-dist@${this.VERSION}/swagger-ui-bundle.js`;
    },
} as const;
