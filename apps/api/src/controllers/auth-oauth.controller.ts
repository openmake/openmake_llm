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
import { setTokenCookie, setRefreshTokenCookie, generateRefreshToken, generateToken } from '../auth';
import { getUserManager } from '../data/user-manager';
import { createLogger } from '../utils/logger';
import { success, badRequest, unauthorized, serviceUnavailable, internalError } from '../utils/api-response';
import { getConfig } from '../config/env';
import { APP_USER_AGENT } from '../config/constants';
import { MOBILE_AUTH } from '../config/security';
import { GOOGLE_OAUTH, GITHUB_OAUTH, GITHUB_API, KAKAO_OAUTH } from '../config/external-services';
import { authLimiter } from '../middlewares/rate-limiters';
import { validate } from '../middlewares/validation';
import { mobileExchangeSchema } from '../schemas';
import {
    generateSecureState,
    validateAndConsumeState,
    buildRedirectUri,
    sendOAuthSuccessRedirect,
    issueMobileExchangeRedirect,
    consumeMobileExchangeCode,
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
        // 모바일(iOS) 전용: OAuth exchange code → 토큰 교환 (사전 인증 POST — CSRF 부트스트랩 대상)
        this.router.post('/mobile/exchange', authLimiter, validate(mobileExchangeSchema), this.mobileExchange.bind(this));
    }

    /**
     * `?client=` 화이트리스트 해석 — 허용 목록 외 값은 웹으로 취급 (undefined)
     */
    private resolveMobileClient(req: Request): string | undefined {
        const client = req.query.client;
        return typeof client === 'string' && (MOBILE_AUTH.ALLOWED_CLIENTS as readonly string[]).includes(client)
            ? client
            : undefined;
    }

    /**
     * POST /api/auth/mobile/exchange - exchange code → 토큰 교환 (iOS 축 2)
     *
     * OAuth 콜백이 발급한 일회성 코드(60s TTL)를 access/refresh token 으로 교환한다.
     * 응답은 body 전용 — 쿠키 미설정 (앱은 Keychain 에 저장).
     */
    private async mobileExchange(req: Request, res: Response): Promise<void> {
        const { code } = req.body as { code: string };
        try {
            const entry = await consumeMobileExchangeCode(code);
            if (!entry) {
                this.auditMobileExchange(req, false, undefined, 'invalid_or_expired_code');
                res.status(401).json(unauthorized('유효하지 않거나 만료된 코드입니다'));
                return;
            }

            const user = await getUserManager().getUserById(entry.userId);
            if (!user || !user.is_active) {
                this.auditMobileExchange(req, false, entry.userId, 'user_not_found_or_inactive');
                res.status(401).json(unauthorized('사용자를 찾을 수 없습니다'));
                return;
            }

            const token = generateToken(user);
            const refreshToken = generateRefreshToken(user);
            this.auditMobileExchange(req, true, user.id, entry.provider);
            log.info(`[OAuth] 모바일 exchange 성공: ${user.email} (${entry.provider})`);
            res.json(success({ token, refreshToken, user }));
        } catch (error) {
            log.error('[OAuth] 모바일 exchange 오류:', error);
            res.status(500).json(internalError('토큰 교환 중 오류가 발생했습니다'));
        }
    }

    /**
     * mobile exchange 감사 로그 (login.failed 패턴과 대칭 — fire-and-forget)
     */
    private auditMobileExchange(req: Request, ok: boolean, userId: string | undefined, detail: string): void {
        void (async () => {
            try {
                const { getAuditService } = await import('../services/AuditService');
                await getAuditService().logAudit({
                    action: ok ? 'auth.mobile_exchange' : 'auth.mobile_exchange_failed',
                    userId,
                    resourceType: 'auth',
                    details: { detail },
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                });
            } catch (e) {
                log.warn('[audit] mobile_exchange 기록 실패:', e);
            }
        })();
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

        // 🔒 Phase 2 보안 패치: 암호학적으로 안전한 state 생성 (?client=ios 는 state 에 귀속 — 콜백 분기용)
        const state = await generateSecureState('google', this.resolveMobileClient(req));
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

        // 🔒 Phase 2 보안 패치: 암호학적으로 안전한 state 생성 (?client=ios 는 state 에 귀속 — 콜백 분기용)
        const state = await generateSecureState('github', this.resolveMobileClient(req));
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
        const stateResult = await validateAndConsumeState(state, 'google');
        if (!stateResult.valid) {
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
            // 계정 병합은 이메일 소유권을 신뢰하는 행위 — Google 이 명시적으로 미검증(email_verified===false)
            // 이라 표시한 이메일은 거부해 크로스-프로바이더 계정 병합 탈취를 막는다(카카오 콜백과 대칭).
            // (Google 은 통상 검증된 이메일만 릴리스하지만 방어적 하드닝.)
            if (userInfo.email_verified === false) throw new Error('이메일이 인증되지 않았습니다');

            const authService = getAuthService();
            const result = await authService.findOrCreateOAuthUser(userInfo.email, 'google');

            if (!result.success || !result.token || !result.user) throw new Error(result.error || '인증 실패');

            if (stateResult.client) {
                // 모바일: 쿠키 대신 일회성 exchange code 를 app scheme 으로 전달 (iOS 축 2)
                await issueMobileExchangeRedirect(res, String(result.user.id), 'google');
                return;
            }
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
        const stateResult = await validateAndConsumeState(state, 'github');
        if (!stateResult.valid) {
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
                // 🔒 verified 된 primary 이메일만 신뢰 — Google(email_verified)/Kakao(is_email_verified)
                //   와 대칭. 미검증 이메일로 기존 계정과 병합되는 계정 탈취를 차단한다.
                const primaryEmail = emails.find(e => e.primary && e.verified);
                // BUG-R3-003: 가짜 @github.local 도메인 대신 이메일 비공개 사용자는 로그인 거부
                // 검증된 primary 이메일이 없으면 거부(공개 이메일 없거나 미검증 포함)
                if (!primaryEmail?.email) {
                    log.warn(`[OAuth GitHub] 검증된 primary 이메일 없음 — 로그인 거부: login=${githubUser.login}`);
                    res.redirect('/login?error=email_required');
                    return;
                }
                email = primaryEmail.email;
            }

            const authService = getAuthService();
            const result = await authService.findOrCreateOAuthUser(email, 'github');

            if (!result.success || !result.token || !result.user) throw new Error(result.error || '인증 실패');

            if (stateResult.client) {
                // 모바일: 쿠키 대신 일회성 exchange code 를 app scheme 으로 전달 (iOS 축 2)
                await issueMobileExchangeRedirect(res, String(result.user.id), 'github');
                return;
            }
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

        // 🔒 암호학적으로 안전한 state 생성 (CSRF 방어, ?client=ios 는 state 에 귀속 — 콜백 분기용)
        const state = await generateSecureState('kakao', this.resolveMobileClient(req));
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
        const stateResult = await validateAndConsumeState(state, 'kakao');
        if (!stateResult.valid) {
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

            if (stateResult.client) {
                // 모바일: 쿠키 대신 일회성 exchange code 를 app scheme 으로 전달 (iOS 축 2)
                await issueMobileExchangeRedirect(res, String(result.user.id), 'kakao');
                return;
            }
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
