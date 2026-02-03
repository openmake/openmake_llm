/**
 * OAuth Provider System
 * Google, GitHub 등 소셜 로그인을 위한 OAuth 2.0 프로바이더 시스템
 */

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { generateToken } from './index';
import { PublicUser } from './types';

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
        // Google OAuth
        if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
            this.registerProvider('google', {
                ...PROVIDER_CONFIGS.google,
                clientId: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                redirectUri: process.env.OAUTH_REDIRECT_URI || 'http://localhost:52416/api/auth/callback/google'
            });
            console.log('[OAuth] Google 프로바이더 등록됨');
        }

        // GitHub OAuth
        if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
            this.registerProvider('github', {
                ...PROVIDER_CONFIGS.github,
                clientId: process.env.GITHUB_CLIENT_ID,
                clientSecret: process.env.GITHUB_CLIENT_SECRET,
                redirectUri: process.env.OAUTH_REDIRECT_URI || 'http://localhost:52416/api/auth/callback/github'
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
        const nonce = uuidv4();
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
                        const primaryEmail = emailResponse.data.find((e: any) => e.primary);
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

/**
 * #3 개선: OAuth 사용자 upsert 함수 타입
 * 외부에서 주입하여 OAuth 로그인 시 사용자 생성/조회 로직을 연결
 */
type OAuthUserUpsertFn = (userInfo: OAuthUserInfo) => Promise<PublicUser | null>;
let _oauthUserUpsert: OAuthUserUpsertFn | null = null;

/**
 * OAuth 사용자 upsert 함수 등록
 * 앱 초기화 시 호출하여 OAuth 로그인 시 DB 연동 가능
 */
export function registerOAuthUserUpsert(fn: OAuthUserUpsertFn): void {
    _oauthUserUpsert = fn;
    console.log('[OAuth] 사용자 upsert 함수 등록됨');
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
export function setupOAuthRoutes(app: any): void {
    const oauth = getOAuthManager();

    // 사용 가능한 프로바이더 목록
    app.get('/api/auth/providers', (req: any, res: any) => {
        res.json({
            providers: oauth.getAvailableProviders()
        });
    });

    // 인증 시작
    app.get('/api/auth/login/:provider', (req: any, res: any) => {
        const { provider } = req.params;
        const returnUrl = req.query.returnUrl;

        const authUrl = oauth.getAuthorizationUrl(provider, returnUrl);
        if (!authUrl) {
            return res.status(400).json({ error: '지원하지 않는 프로바이더' });
        }

        res.redirect(authUrl);
    });

    // 콜백 처리
    // #3 개선: OAuth 콜백에서 JWT 토큰 발급 완성
    app.get('/api/auth/callback/:provider', async (req: any, res: any) => {
        const { provider } = req.params;
        const { code, state, error } = req.query;

        if (error) {
            return res.redirect(`/login.html?error=${encodeURIComponent(error)}`);
        }

        if (!code || !state) {
            return res.redirect('/login.html?error=missing_params');
        }

        try {
            const userInfo = await oauth.handleCallback(provider, code, state);
            if (!userInfo) {
                return res.redirect('/login.html?error=oauth_failed');
            }

            // #3: 사용자 upsert 함수가 등록되어 있으면 사용
            let user: PublicUser | null = null;

            if (_oauthUserUpsert) {
                user = await _oauthUserUpsert(userInfo);
            }

            if (!user) {
                // upsert 함수가 없으면 기본 사용자 정보로 PublicUser 생성
                user = {
                    id: `oauth-${userInfo.provider}-${userInfo.providerId}`,
                    username: userInfo.name || userInfo.email,
                    email: userInfo.email,
                    role: 'user',
                    created_at: new Date().toISOString(),
                    is_active: true
                };
            }

            // #3: JWT 토큰 발급
            const token = generateToken(user);

            // 프론트엔드로 토큰 전달 (리다이렉트 + query param)
            const returnUrl = '/index.html';
            res.redirect(`${returnUrl}?token=${encodeURIComponent(token)}&provider=${provider}`);
        } catch (err: any) {
            console.error('[OAuth] 콜백 처리 오류:', err);
            return res.redirect('/login.html?error=oauth_internal_error');
        }
    });

    console.log('[OAuth] 라우트 설정 완료');
}
