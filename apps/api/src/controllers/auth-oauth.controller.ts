/**
 * ============================================================
 * Auth OAuth Controller
 * ============================================================
 * OAuth 인증 관련 API 라우트 (Google, GitHub, Kakao)
 *
 * auth.controller.ts에서 분리됨.
 * OAuth state 관리, 리다이렉트 URI 생성, OAuth 콜백 핸들러를 담당합니다.
 */

import { Request, Response, Router } from 'express';
import { getAuthService } from '../services/AuthService';
import type { OAuthTokenResponse, GoogleUserInfo, GitHubUser, GitHubEmail, KakaoUserInfo } from '../auth/types';
import { setTokenCookie, setRefreshTokenCookie, generateRefreshToken } from '../auth';
import { createLogger } from '../utils/logger';
import { success, badRequest, serviceUnavailable } from '../utils/api-response';
import { getConfig } from '../config/env';
import { APP_USER_AGENT } from '../config/constants';
import { GOOGLE_OAUTH, GITHUB_OAUTH, GITHUB_API, KAKAO_OAUTH } from '../config/external-services';
import {
    generateSecureState,
    validateAndConsumeState,
    buildRedirectUri,
    sendOAuthSuccessRedirect,
} from './auth-oauth-helpers';

// server.ts 종료 훅이 참조하는 정리 함수 (auth.controller.ts 경유 re-export 체인 유지)
export { stopOAuthCleanup } from './auth-oauth-helpers';

const log = createLogger('AuthOAuthController');

/**
 * OAuth 인증 관련 API 컨트롤러
 *
 * @class AuthOAuthController
 * @description
 * - OAuth 프로바이더 목록
 * - Google OAuth (로그인 + 콜백)
 * - GitHub OAuth (로그인 + 콜백)
 * - Kakao OAuth (로그인 + 콜백)
 */
export class AuthOAuthController {
    /** Express 라우터 인스턴스 */
    private router: Router;
    /** 서버 포트 (OAuth 리다이렉트 URI 생성용) */
    private serverPort: number;

    /**
     * AuthOAuthController 인스턴스를 생성합니다.
     * @param serverPort - 서버 포트 번호 (기본값: .env PORT)
     */
    constructor(serverPort: number = getConfig().port) {
        this.router = Router();
        this.serverPort = serverPort;
        this.setupRoutes();
    }

    private setupRoutes(): void {
        this.router.get('/providers', this.getProviders.bind(this));
        this.router.get('/login/google', this.googleLogin.bind(this));
        this.router.get('/login/github', this.githubLogin.bind(this));
        this.router.get('/login/kakao', this.kakaoLogin.bind(this));
        this.router.get('/callback/google', this.googleCallback.bind(this));
        this.router.get('/callback/github', this.githubCallback.bind(this));
        this.router.get('/callback/kakao', this.kakaoCallback.bind(this));
    }

    /**
     * GET /api/auth/providers - OAuth 프로바이더 목록
     */
    private getProviders(req: Request, res: Response): void {
        const authService = getAuthService();
        res.json(success({ providers: authService.getAvailableProviders() }));
    }

    /**
     * GET /api/auth/login/google - Google OAuth 시작
     */
    private async googleLogin(req: Request, res: Response): Promise<void> {
        const clientId = getConfig().googleClientId;
        const redirectUri = buildRedirectUri(req, 'google', this.serverPort);

        if (!clientId) {
            res.status(503).json(serviceUnavailable('Google OAuth가 설정되지 않았습니다'));
            return;
        }

        // 🔒 Phase 2 보안 패치: 암호학적으로 안전한 state 생성
        const state = await generateSecureState('google');
        const authUrl = new URL(GOOGLE_OAUTH.AUTH_URL);
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', 'email profile');
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('access_type', 'offline');
        authUrl.searchParams.set('prompt', 'consent');

        log.info(`[OAuth] Google 로그인 리다이렉트 (redirect_uri: ${redirectUri})`);
        res.redirect(authUrl.toString());
    }

    /**
     * GET /api/auth/login/github - GitHub OAuth 시작
     */
    private async githubLogin(req: Request, res: Response): Promise<void> {
        const clientId = getConfig().githubClientId;
        const redirectUri = buildRedirectUri(req, 'github', this.serverPort);

        if (!clientId) {
            res.status(503).json(serviceUnavailable('GitHub OAuth가 설정되지 않았습니다'));
            return;
        }

        // 🔒 Phase 2 보안 패치: 암호학적으로 안전한 state 생성
        const state = await generateSecureState('github');
        const authUrl = new URL(GITHUB_OAUTH.AUTH_URL);
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('scope', 'read:user user:email');
        authUrl.searchParams.set('state', state);

        log.info('[OAuth] GitHub 로그인 리다이렉트');
        res.redirect(authUrl.toString());
    }

    /**
     * GET /api/auth/callback/google - Google OAuth 콜백
     */
    private async googleCallback(req: Request, res: Response): Promise<void> {
        const { code, error: oauthError, state } = req.query;

        if (oauthError) {
            res.redirect(`/login?error=${encodeURIComponent(String(oauthError))}`);
            return;
        }

        if (!state || typeof state !== 'string') {
            log.error('[OAuth] Google callback: Missing state parameter');
            res.status(400).json(badRequest('OAuth state parameter is required'));
            return;
        }

        // 🔒 Phase 2 CSRF 방어: state 검증 (Phase 3: DB 기반 비동기)
        if (!await validateAndConsumeState(state, 'google')) {
            log.error('[OAuth] Google callback: Invalid or expired state');
            res.redirect('/login?error=invalid_state');
            return;
        }

        if (!code) {
            res.redirect('/login?error=no_code');
            return;
        }

        try {
            const clientId = getConfig().googleClientId;
            const clientSecret = getConfig().googleClientSecret;
            const redirectUri = buildRedirectUri(req, 'google', this.serverPort);

            // 토큰 교환
            const tokenRes = await fetch(GOOGLE_OAUTH.TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    code: String(code),
                    client_id: clientId,
                    client_secret: clientSecret,
                    redirect_uri: redirectUri,
                    grant_type: 'authorization_code'
                })
            });

            const tokenData = await tokenRes.json() as OAuthTokenResponse;
            if (!tokenData.access_token) throw new Error('토큰 교환 실패');

            // 사용자 정보 가져오기
            const userInfoRes = await fetch(GOOGLE_OAUTH.USERINFO_URL, {
                headers: { Authorization: `Bearer ${tokenData.access_token}` }
            });

            const userInfo = await userInfoRes.json() as GoogleUserInfo;
            if (!userInfo.email) throw new Error('이메일 정보를 가져올 수 없습니다');

            const authService = getAuthService();
            const result = await authService.findOrCreateOAuthUser(userInfo.email, 'google');

            if (!result.success || !result.token || !result.user) throw new Error(result.error || '인증 실패');

            setTokenCookie(res, result.token);
            setRefreshTokenCookie(res, generateRefreshToken(result.user));
            sendOAuthSuccessRedirect(res, '/?auth=callback');
        } catch (error) {
            log.error('[OAuth Google Callback] 오류:', error);
            res.redirect('/login?error=oauth_failed');
        }
    }

    /**
     * GET /api/auth/callback/github - GitHub OAuth 콜백
     */
    private async githubCallback(req: Request, res: Response): Promise<void> {
        const { code, error: oauthError, state } = req.query;

        if (oauthError) {
            res.redirect(`/login?error=${encodeURIComponent(String(oauthError))}`);
            return;
        }

        if (!state || typeof state !== 'string') {
            log.error('[OAuth] GitHub callback: Missing state parameter');
            res.status(400).json(badRequest('OAuth state parameter is required'));
            return;
        }

        // 🔒 Phase 2 CSRF 방어: state 검증 (Phase 3: DB 기반 비동기)
        if (!await validateAndConsumeState(state, 'github')) {
            log.error('[OAuth] GitHub callback: Invalid or expired state');
            res.redirect('/login?error=invalid_state');
            return;
        }

        if (!code) {
            res.redirect('/login?error=no_code');
            return;
        }

        try {
            const clientId = getConfig().githubClientId;
            const clientSecret = getConfig().githubClientSecret;

            // 토큰 교환
            const tokenRes = await fetch(GITHUB_OAUTH.TOKEN_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    client_id: clientId,
                    client_secret: clientSecret,
                    code: String(code)
                })
            });

            const tokenData = await tokenRes.json() as OAuthTokenResponse;
            if (!tokenData.access_token) throw new Error('토큰 교환 실패');

            // 사용자 정보 가져오기
            const userRes = await fetch(GITHUB_API.USER_INFO, {
                headers: {
                    Authorization: `Bearer ${tokenData.access_token}`,
                    'User-Agent': APP_USER_AGENT
                }
            });

            const githubUser = await userRes.json() as GitHubUser;
            let email = githubUser.email;

            // 이메일 없으면 별도 API 호출
            if (!email) {
                const emailRes = await fetch(GITHUB_API.USER_EMAILS, {
                    headers: {
                        Authorization: `Bearer ${tokenData.access_token}`,
                        'User-Agent': APP_USER_AGENT
                    }
                });
                const emails = await emailRes.json() as GitHubEmail[];
                const primaryEmail = emails.find(e => e.primary);
                // BUG-R3-003: 가짜 @github.local 도메인 대신 이메일 비공개 사용자는 로그인 거부
                // primary 이메일이 없으면 OAuth 프로필에서 public 이메일 사용, 그것도 없으면 거부
                if (!primaryEmail?.email) {
                    log.warn(`[OAuth GitHub] 이메일 비공개 사용자 로그인 거부: login=${githubUser.login}`);
                    res.redirect('/login?error=email_required');
                    return;
                }
                email = primaryEmail.email;
            }

            const authService = getAuthService();
            const result = await authService.findOrCreateOAuthUser(email, 'github');

            if (!result.success || !result.token || !result.user) throw new Error(result.error || '인증 실패');

            setTokenCookie(res, result.token);
            setRefreshTokenCookie(res, generateRefreshToken(result.user));
            sendOAuthSuccessRedirect(res, '/?auth=callback');
        } catch (error) {
            log.error('[OAuth GitHub Callback] 오류:', error);
            res.redirect('/login?error=oauth_failed');
        }
    }

    /**
     * GET /api/auth/login/kakao - Kakao OAuth 시작
     */
    private async kakaoLogin(req: Request, res: Response): Promise<void> {
        const clientId = getConfig().kakaoClientId;
        const redirectUri = buildRedirectUri(req, 'kakao', this.serverPort);

        if (!clientId) {
            res.status(503).json(serviceUnavailable('Kakao OAuth가 설정되지 않았습니다'));
            return;
        }

        // 🔒 암호학적으로 안전한 state 생성 (CSRF 방어)
        const state = await generateSecureState('kakao');
        const authUrl = new URL(KAKAO_OAUTH.AUTH_URL);
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        // 비즈앱 전환으로 이메일(account_email) 동의항목 활성화 → 실이메일로 식별(타 provider 병합).
        // 닉네임(profile_nickname)도 함께 요청. 둘 다 필수 동의라 콤마 구분 scope 로 전달.
        authUrl.searchParams.set('scope', 'account_email,profile_nickname');
        authUrl.searchParams.set('state', state);

        log.info(`[OAuth] Kakao 로그인 리다이렉트 (redirect_uri: ${redirectUri})`);
        res.redirect(authUrl.toString());
    }

    /**
     * GET /api/auth/callback/kakao - Kakao OAuth 콜백
     */
    private async kakaoCallback(req: Request, res: Response): Promise<void> {
        const { code, error: oauthError, state } = req.query;

        if (oauthError) {
            res.redirect(`/login?error=${encodeURIComponent(String(oauthError))}`);
            return;
        }

        if (!state || typeof state !== 'string') {
            log.error('[OAuth] Kakao callback: Missing state parameter');
            res.status(400).json(badRequest('OAuth state parameter is required'));
            return;
        }

        // 🔒 CSRF 방어: state 검증 (일회성, DB 기반)
        if (!await validateAndConsumeState(state, 'kakao')) {
            log.error('[OAuth] Kakao callback: Invalid or expired state');
            res.redirect('/login?error=invalid_state');
            return;
        }

        if (!code) {
            res.redirect('/login?error=no_code');
            return;
        }

        try {
            const clientId = getConfig().kakaoClientId;
            const clientSecret = getConfig().kakaoClientSecret;
            const redirectUri = buildRedirectUri(req, 'kakao', this.serverPort);

            // 토큰 교환 (Kakao 는 client_secret 포함 x-www-form-urlencoded)
            const tokenRes = await fetch(KAKAO_OAUTH.TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    client_id: clientId,
                    client_secret: clientSecret,
                    redirect_uri: redirectUri,
                    code: String(code)
                })
            });

            const tokenData = await tokenRes.json() as OAuthTokenResponse;
            if (!tokenData.access_token) throw new Error('토큰 교환 실패');

            // 사용자 정보 가져오기
            const userInfoRes = await fetch(KAKAO_OAUTH.USERINFO_URL, {
                headers: { Authorization: `Bearer ${tokenData.access_token}` }
            });

            const kakaoUser = await userInfoRes.json() as KakaoUserInfo;

            // 비즈앱 전환으로 이메일(account_email) 필수 동의 활성화 → 실이메일로 식별한다(Google 등
            // 타 provider 와 동일 이메일이면 계정 병합). 단, 계정 병합은 이메일 소유권을 신뢰하는
            // 행위이므로 카카오가 유효(is_email_valid)하고 인증(is_email_verified)했다고 확인한
            // 이메일만 병합에 사용한다. 미검증/무효/미동의 이메일은 회원번호(id) 기반 합성 이메일로
            // 격리 — 이렇게 하지 않으면 공격자가 피해자 이메일을 미검증 상태로 걸어 계정을 탈취할 수 있다.
            // (회원번호는 '사용자 아이디 고정'(기본 ON)이라 안정적.)
            const kakaoId = kakaoUser.id;
            if (!kakaoId) throw new Error('카카오 사용자 정보를 가져올 수 없습니다');
            const kakaoAccount = kakaoUser.kakao_account;
            const hasVerifiedEmail =
                !!kakaoAccount?.email &&
                kakaoAccount.is_email_valid === true &&
                kakaoAccount.is_email_verified === true;
            const email = hasVerifiedEmail ? kakaoAccount!.email! : `kakao_${kakaoId}@kakao.local`;

            const authService = getAuthService();
            const result = await authService.findOrCreateOAuthUser(email, 'kakao');

            if (!result.success || !result.token || !result.user) throw new Error(result.error || '인증 실패');

            setTokenCookie(res, result.token);
            setRefreshTokenCookie(res, generateRefreshToken(result.user));
            sendOAuthSuccessRedirect(res, '/?auth=callback');
        } catch (error) {
            log.error('[OAuth Kakao Callback] 오류:', error);
            res.redirect('/login?error=oauth_failed');
        }
    }

    /**
     * Express 라우터를 반환합니다.
     * @returns 설정된 Router 인스턴스
     */
    getRouter(): Router {
        return this.router;
    }
}

/**
 * AuthOAuthController 인스턴스를 생성하는 팩토리 함수
 *
 * @param serverPort - 서버 포트 번호 (선택적, 기본값: .env PORT)
 * @returns 설정된 Express Router
 */
export function createAuthOAuthController(serverPort?: number): Router {
    return new AuthOAuthController(serverPort).getRouter();
}
