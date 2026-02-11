/**
 * OAuth Provider System
 * Google, GitHub 등 소셜 로그인을 위한 OAuth 2.0 프로바이더 시스템
 */

import axios from 'axios';
import * as crypto from 'crypto';
import type { Application, Request, Response } from 'express';
import { getConfig } from '../config/env';
import { getAuthService } from '../services/AuthService';
import { setTokenCookie, setRefreshTokenCookie, generateRefreshToken } from '../auth';

// OAuth 프로바이더 설정
export interface OAuthProviderConfig {
    clientId: string;
    clientSecret: string;
    authorizationUrl: string;
    tokenUrl: string;
    userInfoUrl: string;
    scopes: string[];
    redirectUri: string;
}

// OAuth 사용자 정보
export interface OAuthUserInfo {
    provider: string;
    providerId: string;
    email: string;
    name: string;
    avatar?: string;
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
    raw: Record<string, any>;
}

// OAuth 상태 (CSRF 방지)
interface OAuthState {
    nonce: string;
    provider: string;
    returnUrl?: string;
    createdAt: Date;
}

// 프로바이더별 설정
const PROVIDER_CONFIGS: Record<string, Omit<OAuthProviderConfig, 'clientId' | 'clientSecret' | 'redirectUri'>> = {
    google: {
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
        scopes: ['openid', 'email', 'profile']
    },
    github: {
        authorizationUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        userInfoUrl: 'https://api.github.com/user',
        scopes: ['read:user', 'user:email']
    }
};

/**
 * OAuth 프로바이더 관리자
 */
export class OAuthManager {
    private providers: Map<string, OAuthProviderConfig> = new Map();
    private states: Map<string, OAuthState> = new Map();
    private stateExpiry = 10 * 60 * 1000; // 10분
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor() {
        this.loadProvidersFromEnv();

        // 만료된 상태 정리 (5분마다)
        this.cleanupInterval = setInterval(() => this.cleanupExpiredStates(), 5 * 60 * 1000);
    }

    /**
     * 리소스 정리 - 메모리 누수 방지
     */
    destroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.states.clear();
        this.providers.clear();
        console.log('[OAuth] OAuthManager 리소스 정리 완료');
    }


    /**
     * 환경변수에서 프로바이더 설정 로드
     */
    private loadProvidersFromEnv(): void {
        const config = getConfig();
        const baseRedirectUri = config.oauthRedirectUri;
        // Google OAuth
        if (config.googleClientId && config.googleClientSecret) {
            this.registerProvider('google', {
                ...PROVIDER_CONFIGS.google,
                clientId: config.googleClientId,
                clientSecret: config.googleClientSecret,
                redirectUri: baseRedirectUri
            });
            console.log('[OAuth] Google 프로바이더 등록됨');
        }

        // GitHub OAuth
        if (config.githubClientId && config.githubClientSecret) {
            this.registerProvider('github', {
                ...PROVIDER_CONFIGS.github,
                clientId: config.githubClientId,
                clientSecret: config.githubClientSecret,
                redirectUri: baseRedirectUri.replace('/callback/google', '/callback/github')
            });
            console.log('[OAuth] GitHub 프로바이더 등록됨');
        }
    }

    /**
     * 프로바이더 등록
     */
    registerProvider(name: string, config: OAuthProviderConfig): void {
        this.providers.set(name, config);
    }

    /**
     * 사용 가능한 프로바이더 목록
     */
    getAvailableProviders(): string[] {
        return Array.from(this.providers.keys());
    }

    /**
     * 인증 URL 생성
     */
    getAuthorizationUrl(provider: string, returnUrl?: string): string | null {
        const config = this.providers.get(provider);
        if (!config) {
            console.error(`[OAuth] 알 수 없는 프로바이더: ${provider}`);
            return null;
        }

        // CSRF 방지용 상태 생성
        const nonce = crypto.randomBytes(32).toString('hex');
        const state: OAuthState = {
            nonce,
            provider,
            returnUrl,
            createdAt: new Date()
        };
        this.states.set(nonce, state);

        // URL 생성
        const params = new URLSearchParams({
            client_id: config.clientId,
            redirect_uri: config.redirectUri,
            response_type: 'code',
            scope: config.scopes.join(' '),
            state: nonce
        });

        // Google은 추가 파라미터 필요
        if (provider === 'google') {
            params.append('access_type', 'offline');
            params.append('prompt', 'consent');
        }

        return `${config.authorizationUrl}?${params.toString()}`;
    }

    /**
     * 콜백 처리 - 인증 코드로 토큰 교환
     */
    async handleCallback(
        provider: string,
        code: string,
        state: string
    ): Promise<OAuthUserInfo | null> {
        // 상태 검증
        const storedState = this.states.get(state);
        if (!storedState || storedState.provider !== provider) {
            console.error('[OAuth] 잘못된 state 또는 provider');
            return null;
        }

        // 상태 삭제 (한 번만 사용)
        this.states.delete(state);

        // 만료 체크
        if (Date.now() - storedState.createdAt.getTime() > this.stateExpiry) {
            console.error('[OAuth] 만료된 state');
            return null;
        }

        const config = this.providers.get(provider);
        if (!config) return null;

        try {
            // 토큰 교환
            const tokenResponse = await this.exchangeCodeForToken(config, code);
            if (!tokenResponse) return null;

            // 사용자 정보 조회
            const userInfo = await this.fetchUserInfo(provider, config, tokenResponse);
            return userInfo;
        } catch (error) {
            console.error('[OAuth] 콜백 처리 오류:', error);
            return null;
        }
    }

    /**
     * 인증 코드를 토큰으로 교환
     */
    private async exchangeCodeForToken(
        config: OAuthProviderConfig,
        code: string
    ): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number } | null> {
        try {
            const response = await axios.post(config.tokenUrl,
                new URLSearchParams({
                    client_id: config.clientId,
                    client_secret: config.clientSecret,
                    code,
                    redirect_uri: config.redirectUri,
                    grant_type: 'authorization_code'
                }).toString(),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json'
                    }
                }
            );

            const data = response.data;

            // GitHub은 다른 형식으로 응답할 수 있음
            if (typeof data === 'string') {
                const parsed = new URLSearchParams(data);
                return {
                    accessToken: parsed.get('access_token') || '',
                    refreshToken: parsed.get('refresh_token') || undefined
                };
            }

            return {
                accessToken: data.access_token,
                refreshToken: data.refresh_token,
                expiresIn: data.expires_in
            };
        } catch (error) {
            console.error('[OAuth] 토큰 교환 실패:', error);
            return null;
        }
    }

    /**
     * 사용자 정보 조회
     */
    private async fetchUserInfo(
        provider: string,
        config: OAuthProviderConfig,
        tokens: { accessToken: string; refreshToken?: string; expiresIn?: number }
    ): Promise<OAuthUserInfo | null> {
        try {
            const response = await axios.get(config.userInfoUrl, {
                headers: {
                    'Authorization': `Bearer ${tokens.accessToken}`,
                    'Accept': 'application/json'
                }
            });

            const data = response.data;

            // 프로바이더별 데이터 정규화
            let userInfo: OAuthUserInfo;

            if (provider === 'google') {
                userInfo = {
                    provider: 'google',
                    providerId: data.id,
                    email: data.email,
                    name: data.name,
                    avatar: data.picture,
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    expiresAt: tokens.expiresIn
                        ? new Date(Date.now() + tokens.expiresIn * 1000)
                        : undefined,
                    raw: data
                };
            } else if (provider === 'github') {
                // GitHub은 이메일을 별도 API로 조회해야 할 수 있음
                let email = data.email;
                if (!email) {
                    try {
                        const emailResponse = await axios.get('https://api.github.com/user/emails', {
                            headers: {
                                'Authorization': `Bearer ${tokens.accessToken}`,
                                'Accept': 'application/json'
                            }
                        });
                        const primaryEmail = emailResponse.data.find((e: { primary?: boolean; email?: string }) => e.primary);
                        email = primaryEmail?.email || '';
                    } catch (e) {
                        console.warn('[OAuth] GitHub 이메일 조회 실패');
                    }
                }

                userInfo = {
                    provider: 'github',
                    providerId: String(data.id),
                    email,
                    name: data.name || data.login,
                    avatar: data.avatar_url,
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    raw: data
                };
            } else {
                // 일반적인 OpenID Connect 형식
                userInfo = {
                    provider,
                    providerId: data.sub || data.id,
                    email: data.email,
                    name: data.name,
                    avatar: data.picture,
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    raw: data
                };
            }

            return userInfo;
        } catch (error) {
            console.error('[OAuth] 사용자 정보 조회 실패:', error);
            return null;
        }
    }

    /**
     * 만료된 상태 정리
     */
    private cleanupExpiredStates(): void {
        const now = Date.now();
        for (const [nonce, state] of this.states) {
            if (now - state.createdAt.getTime() > this.stateExpiry) {
                this.states.delete(nonce);
            }
        }
    }
}

// 싱글톤 인스턴스
let oauthManagerInstance: OAuthManager | null = null;

export function getOAuthManager(): OAuthManager {
    if (!oauthManagerInstance) {
        oauthManagerInstance = new OAuthManager();
    }
    return oauthManagerInstance;
}

/**
 * OAuth 라우트 설정 헬퍼
 */
export function setupOAuthRoutes(app: Application): void {
    const oauth = getOAuthManager();

    // 사용 가능한 프로바이더 목록
    app.get('/api/auth/providers', (req: Request, res: Response) => {
        res.json({
            providers: oauth.getAvailableProviders()
        });
    });

    // 인증 시작
    app.get('/api/auth/login/:provider', (req: Request, res: Response) => {
        const { provider } = req.params;
        const returnUrl = req.query.returnUrl as string | undefined;

        const authUrl = oauth.getAuthorizationUrl(provider, returnUrl);
        if (!authUrl) {
            return res.status(400).json({ error: '지원하지 않는 프로바이더' });
        }

        res.redirect(authUrl);
    });

    // 콜백 처리
    app.get('/api/auth/callback/:provider', async (req: Request, res: Response) => {
        const { provider } = req.params;
        const code = req.query.code as string | undefined;
        const state = req.query.state as string | undefined;
        const error = req.query.error as string | undefined;

        if (error) {
            return res.redirect(`/login.html?error=${encodeURIComponent(error)}`);
        }

        if (!code || !state) {
            return res.redirect('/login.html?error=missing_params');
        }

        const userInfo = await oauth.handleCallback(provider, code, state);
        if (!userInfo) {
            return res.redirect('/login.html?error=oauth_failed');
        }

        // 사용자 생성/조회 + JWT 토큰 발급
        const authService = getAuthService();
        const authResult = await authService.findOrCreateOAuthUser(
            userInfo.email,
            provider as 'google' | 'github'
        );

        if (!authResult.success || !authResult.token || !authResult.user) {
            return res.redirect('/login.html?error=auth_failed');
        }

        // HttpOnly 쿠키에 액세스 + 리프레시 토큰 설정
        setTokenCookie(res, authResult.token);
        setRefreshTokenCookie(res, generateRefreshToken(authResult.user));

        // 메인 페이지로 리다이렉트
        res.redirect('/');
    });

    console.log('[OAuth] 라우트 설정 완료');
}
