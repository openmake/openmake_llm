/**
 * ============================================================
 * Auth Controller
 * ============================================================
 * 인증 관련 API 라우트
 */

import { Request, Response, Router } from 'express';
import * as crypto from 'crypto';
import { getAuthService } from '../services/AuthService';
import { getUserManager } from '../data/user-manager';
import type { OAuthTokenResponse, GoogleUserInfo, GitHubUser, GitHubEmail } from '../auth/types';
import { requireAuth, requireAdmin, extractToken, blacklistToken, setTokenCookie, clearTokenCookie, setRefreshTokenCookie, generateRefreshToken, generateToken, verifyRefreshToken } from '../auth';
import { createLogger } from '../utils/logger';
import { success, badRequest, unauthorized, conflict, internalError, serviceUnavailable } from '../utils/api-response';
import { getConfig } from '../config/env';
import { APP_USER_AGENT } from '../config/constants';
import { validate } from '../middlewares/validation';
import { loginSchema, registerSchema, changePasswordSchema } from '../schemas';

const log = createLogger('AuthController');

// 🔒 Phase 2 보안 패치 2026-02-07: OAuth State 저장소 (CSRF 방어용)
// 🔒 Phase 3 패치 2026-02-13: 인메모리 Map → DB 저장으로 변경 (클러스터/재시작 안전)
// PostgreSQL을 사용하여 프로세스 간 공유 가능, 서버 재시작에도 유지됨
const STATE_TTL_MS = 5 * 60 * 1000; // 5분

// 인메모리 폴백: DB 연결 실패 시 임시 사용 (단일 프로세스 한정)
const oauthStatesFallback = new Map<string, { provider: string; createdAt: number }>();

/**
 * DB 기반 OAuth state 저장소 헬퍼 (안전 폴백)
 * 
 * 주 DDL은 services/database/init/002-schema.sql에서 관리합니다.
 * 이 함수는 스키마 마이그레이션 없이 서버를 시작한 경우를 위한 안전 폴백입니다.
 */
async function ensureOauthStateTable(): Promise<void> {
    try {
        const { getPool } = await import('../data/models/unified-database');
        const pool = getPool();
        await pool.query(`
            CREATE TABLE IF NOT EXISTS oauth_states (
                state TEXT PRIMARY KEY,
                provider TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
    } catch (e) {
        log.warn('[OAuth] oauth_states 테이블 생성 실패 (폴백 사용):', e);
    }
}

// 서버 시작 시 테이블 생성 + 만료 state 정리 스케줄러
ensureOauthStateTable();
const oauthCleanupTimer = setInterval(async () => {
    try {
        const { getPool } = await import('../data/models/unified-database');
        const pool = getPool();
        await pool.query(
            `DELETE FROM oauth_states WHERE created_at < NOW() - INTERVAL '5 minutes'`
        );
    } catch {
        // DB 연결 실패 시 폴백 정리
        const now = Date.now();
        for (const [state, data] of oauthStatesFallback.entries()) {
            if (now - data.createdAt > STATE_TTL_MS) {
                oauthStatesFallback.delete(state);
            }
        }
    }
}, 60 * 1000);

/**
 * OAuth state 정리 스케줄러 중지 (서버 종료 시)
 */
export function stopOAuthCleanup(): void {
    clearInterval(oauthCleanupTimer);
}

/**
 * 🔒 보안 강화된 OAuth state 생성 (DB 저장)
 */
async function generateSecureState(provider: string): Promise<string> {
    const state = crypto.randomBytes(32).toString('hex');
    try {
        const { getPool } = await import('../data/models/unified-database');
        const pool = getPool();
        await pool.query(
            'INSERT INTO oauth_states (state, provider) VALUES ($1, $2)',
            [state, provider]
        );
    } catch (e) {
        log.warn('[OAuth] DB state 저장 실패, 인메모리 폴백 사용:', e);
        oauthStatesFallback.set(state, { provider, createdAt: Date.now() });
    }
    return state;
}

/**
 * 🔒 OAuth state 검증 및 소비 (일회성, DB 기반)
 */
async function validateAndConsumeState(state: string | undefined, expectedProvider: string): Promise<boolean> {
    if (!state) return false;

    try {
        const { getPool } = await import('../data/models/unified-database');
        const pool = getPool();
        // 일회성: DELETE ... RETURNING으로 조회 + 삭제 원자적 처리
        const result = await pool.query(
            'DELETE FROM oauth_states WHERE state = $1 RETURNING provider, created_at',
            [state]
        );

        if (result.rows.length === 0) {
            // DB에 없으면 폴백에서 시도
            return validateAndConsumeStateFallback(state, expectedProvider);
        }

        const row = result.rows[0];

        // 만료 체크
        if (Date.now() - new Date(row.created_at).getTime() > STATE_TTL_MS) {
            log.error('[OAuth] State expired');
            return false;
        }

        // Provider 일치 체크
        if (row.provider !== expectedProvider) {
            log.error(`[OAuth] Provider mismatch: expected ${expectedProvider}, got ${row.provider}`);
            return false;
        }

        return true;
    } catch (e) {
        log.warn('[OAuth] DB state 검증 실패, 인메모리 폴백 사용:', e);
        return validateAndConsumeStateFallback(state, expectedProvider);
    }
}

/**
 * 인메모리 폴백 state 검증 (DB 장애 시)
 */
function validateAndConsumeStateFallback(state: string, expectedProvider: string): boolean {
    const data = oauthStatesFallback.get(state);
    if (!data) {
        log.error(`[OAuth] State not found: ${state?.substring(0, 10)}...`);
        return false;
    }

    oauthStatesFallback.delete(state);

    if (Date.now() - data.createdAt > STATE_TTL_MS) {
        log.error('[OAuth] State expired (fallback)');
        return false;
    }

    if (data.provider !== expectedProvider) {
        log.error(`[OAuth] Provider mismatch (fallback): expected ${expectedProvider}, got ${data.provider}`);
        return false;
    }

    return true;
}

/**
 * OAuth redirect URI를 생성합니다.
 * 
 * 우선순위:
 * 1. OAUTH_REDIRECT_URI 환경변수 (명시적 설정 시) — Google Console 등록 URI와 일치 보장
 * 2. 요청의 Host/Origin 기반 동적 생성 (폴백)
 * 
 * OAUTH_REDIRECT_URI는 Google용으로 설정되어 있어도 provider 부분을 자동 교체합니다.
 */
function buildRedirectUri(req: Request, provider: 'google' | 'github', serverPort: number): string {
    const configuredUri = getConfig().oauthRedirectUri;
    const requestHost = req.get('host') || `localhost:${serverPort}`;
    const forwardedProto = req.get('x-forwarded-proto');
    const requestProtocol = (forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol) || 'http';

    const dynamicRedirectUri = `${requestProtocol}://${requestHost}/api/auth/callback/${provider}`;

    // OAUTH_REDIRECT_URI가 명시적으로 설정된 경우 우선 사용하되,
    // 현재 요청 Host와 불일치하면 동적 URI를 사용해 redirect_uri_mismatch를 방지합니다.
    if (configuredUri && !configuredUri.includes('localhost')) {
        try {
            const configured = new URL(configuredUri);
            if (configured.host === requestHost) {
                const redirectUri = configuredUri.replace(/\/callback\/\w+$/, `/callback/${provider}`);
                log.info(`[OAuth] Redirect URI (config): ${redirectUri}`);
                return redirectUri;
            }

            log.warn(`[OAuth] OAUTH_REDIRECT_URI host mismatch (configured=${configured.host}, request=${requestHost}), using dynamic URI`);
            log.info(`[OAuth] Redirect URI (dynamic): ${dynamicRedirectUri}`);
            return dynamicRedirectUri;
        } catch {
            log.warn('[OAuth] Invalid OAUTH_REDIRECT_URI format, using dynamic URI');
            log.info(`[OAuth] Redirect URI (dynamic): ${dynamicRedirectUri}`);
            return dynamicRedirectUri;
        }
    }

    // 동적 감지 폴백 (개발 환경 등)
    log.info(`[OAuth] Redirect URI (dynamic): ${dynamicRedirectUri}`);
    return dynamicRedirectUri;
}

/**
 * 인증 관련 API 컨트롤러
 * 
 * @class AuthController
 * @description
 * - 기본 인증 (register, login, logout)
 * - OAuth 인증 (Google, GitHub)
 * - 비밀번호 변경
 * - 사용자 정보 조회
 */
export class AuthController {
    /** Express 라우터 인스턴스 */
    private router: Router;
    /** 서버 포트 (OAuth 리다이렉트 URI 생성용) */
    private serverPort: number;

    /**
     * AuthController 인스턴스를 생성합니다.
     * @param serverPort - 서버 포트 번호 (기본값: .env PORT)
     */
    constructor(serverPort: number = getConfig().port) {
        this.router = Router();
        this.serverPort = serverPort;
        this.setupRoutes();
    }

    private setupRoutes(): void {
        const authService = getAuthService();
        const userManager = getUserManager();

        // ===== 기본 인증 API =====
        this.router.post('/register', validate(registerSchema), this.register.bind(this));
        this.router.post('/login', validate(loginSchema), this.login.bind(this));
        this.router.post('/logout', this.logout.bind(this));
        this.router.get('/me', requireAuth, this.getCurrentUser.bind(this));
        this.router.put('/password', requireAuth, validate(changePasswordSchema), this.changePassword.bind(this));

        // ===== Token Refresh =====
        this.router.post('/refresh', this.refresh.bind(this));

        // ===== OAuth API =====
        this.router.get('/providers', this.getProviders.bind(this));
        this.router.get('/login/google', this.googleLogin.bind(this));
        this.router.get('/login/github', this.githubLogin.bind(this));
        this.router.get('/callback/google', this.googleCallback.bind(this));
        this.router.get('/callback/github', this.githubCallback.bind(this));
    }

    /**
     * POST /api/auth/register - 회원가입
     * #24 연동: 표준 API 응답 형식
     */
    private async register(req: Request, res: Response): Promise<void> {
        try {
            const authService = getAuthService();
            const result = await authService.register(req.body);

            if (!result.success) {
                const isConflict = result.error?.includes('이미 등록된');
                res.status(isConflict ? 409 : 400).json(
                    isConflict 
                        ? conflict(result.error || '이미 등록된 사용자입니다')
                        : badRequest(result.error || '회원가입 요청이 올바르지 않습니다')
                );
                return;
            }

            res.json(success(result));
        } catch (error) {
            log.error('[Register] 오류:', error);
            res.status(500).json(internalError('회원가입 처리 중 오류가 발생했습니다'));
        }
    }

     /**
      * POST /api/auth/login - 로그인
      * #24 연동: 표준 API 응답 형식
      */
     private async login(req: Request, res: Response): Promise<void> {
         try {
             const authService = getAuthService();
              const result = await authService.login(req.body);

              if (!result.success) {
                 res.status(401).json(unauthorized(result.error || '로그인에 실패했습니다'));
                 return;
             }

             if (result.token) {
                 setTokenCookie(res, result.token);
                 if (result.user) {
                     setRefreshTokenCookie(res, generateRefreshToken(result.user));
                 }
             }
             res.json(success(result));
         } catch (error) {
             log.error('[Login] 오류:', error);
             res.status(500).json(internalError('로그인 처리 중 오류가 발생했습니다'));
         }
     }

     /**
      * POST /api/auth/logout - 로그아웃
      * #8 연동: 토큰 블랙리스트에 추가하여 재사용 방지
      * #24 연동: 표준 API 응답 형식
      */
     private logout(req: Request, res: Response): void {
         const authHeader = req.headers.authorization;
         if (authHeader) {
             const token = extractToken(authHeader);
             if (token) {
                 blacklistToken(token);
             }
         }
         // 쿠키 토큰도 블랙리스트에 추가
         const cookieToken = req.cookies?.auth_token;
         if (cookieToken) {
             blacklistToken(cookieToken);
         }
         clearTokenCookie(res);
         res.json(success({ message: '로그아웃되었습니다' }));
     }

    /**
     * GET /api/auth/me - 현재 사용자 정보
     * #24 연동: 표준 API 응답 형식
     */
    private getCurrentUser(req: Request, res: Response): void {
        res.json(success({ user: req.user }));
    }

    /**
     * PUT /api/auth/password - 비밀번호 변경
     * #24 연동: 표준 API 응답 형식
     */
    private async changePassword(req: Request, res: Response): Promise<void> {
        try {
            const authService = getAuthService();
            const { currentPassword, newPassword } = req.body;
            
            const user = req.user;
            if (!user?.id || !user?.email) {
                res.status(401).json(unauthorized('인증 정보가 불완전합니다'));
                return;
            }

            const result = await authService.changePassword({
                userId: String(user.id),
                currentEmail: user.email,
                currentPassword,
                newPassword
            });

            if (!result.success) {
                const isAuthFail = result.error?.includes('현재 비밀번호');
                res.status(isAuthFail ? 401 : 400).json(
                    isAuthFail 
                        ? unauthorized(result.error || '현재 비밀번호가 일치하지 않습니다')
                        : badRequest(result.error || '비밀번호 변경 요청이 올바르지 않습니다')
                );
                return;
            }

            res.json(success(result));
        } catch (error) {
            log.error('[ChangePassword] 오류:', error);
            res.status(500).json(internalError('비밀번호 변경 중 오류가 발생했습니다'));
        }
    }

    /**
     * POST /api/auth/refresh - 토큰 갱신
     * httpOnly 쿠키의 리프레시 토큰으로 새 액세스 + 리프레시 토큰 발급
     * 리프레시 토큰 로테이션: 사용된 리프레시 토큰은 블랙리스트 처리
     */
    private async refresh(req: Request, res: Response): Promise<void> {
        const refreshToken = req.cookies?.refresh_token;

        if (!refreshToken) {
            res.status(401).json(unauthorized('리프레시 토큰이 없습니다'));
            return;
        }

        try {
            const payload = await verifyRefreshToken(refreshToken);
            if (!payload) {
                clearTokenCookie(res);
                res.status(401).json(unauthorized('유효하지 않은 리프레시 토큰입니다'));
                return;
            }

            const userManager = getUserManager();
            const user = await userManager.getUserById(payload.userId);

            if (!user || !user.is_active) {
                clearTokenCookie(res);
                res.status(401).json(unauthorized('사용자를 찾을 수 없습니다'));
                return;
            }

            // 사용된 리프레시 토큰 블랙리스트 (토큰 로테이션)
            await blacklistToken(refreshToken);

            // 새 액세스 + 리프레시 토큰 발급
            const newAccessToken = generateToken(user);
            const newRefreshToken = generateRefreshToken(user);

            setTokenCookie(res, newAccessToken);
            setRefreshTokenCookie(res, newRefreshToken);

            log.info(`[Auth] 토큰 갱신 성공: ${user.email}`);
            res.json(success({ token: newAccessToken, user }));
        } catch (error) {
            log.error('[Auth] 토큰 갱신 오류:', error);
            clearTokenCookie(res);
            res.status(500).json(internalError('토큰 갱신 중 오류가 발생했습니다'));
        }
    }

    /**
     * GET /api/auth/providers - OAuth 프로바이더 목록
     * #24 연동: 표준 API 응답 형식
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
        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
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
        const authUrl = new URL('https://github.com/login/oauth/authorize');
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
            res.redirect(`/login.html?error=${encodeURIComponent(String(oauthError))}`);
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
            res.redirect('/login.html?error=invalid_state');
            return;
        }

        if (!code) {
            res.redirect('/login.html?error=no_code');
            return;
        }

        try {
            const clientId = getConfig().googleClientId;
            const clientSecret = getConfig().googleClientSecret;
            const redirectUri = buildRedirectUri(req, 'google', this.serverPort);

            // 토큰 교환
            const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
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
            const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${tokenData.access_token}` }
            });

            const userInfo = await userInfoRes.json() as GoogleUserInfo;
            if (!userInfo.email) throw new Error('이메일 정보를 가져올 수 없습니다');

             const authService = getAuthService();
              const result = await authService.findOrCreateOAuthUser(userInfo.email, 'google');

              if (!result.success || !result.token || !result.user) throw new Error(result.error || '인증 실패');

             setTokenCookie(res, result.token);
             setRefreshTokenCookie(res, generateRefreshToken(result.user));
             res.redirect('/');
        } catch (error) {
            log.error('[OAuth Google Callback] 오류:', error);
            res.redirect('/login.html?error=oauth_failed');
        }
    }

    /**
     * GET /api/auth/callback/github - GitHub OAuth 콜백
     */
    private async githubCallback(req: Request, res: Response): Promise<void> {
        const { code, error: oauthError, state } = req.query;

        if (oauthError) {
            res.redirect(`/login.html?error=${encodeURIComponent(String(oauthError))}`);
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
            res.redirect('/login.html?error=invalid_state');
            return;
        }

        if (!code) {
            res.redirect('/login.html?error=no_code');
            return;
        }

        try {
            const clientId = getConfig().githubClientId;
            const clientSecret = getConfig().githubClientSecret;

            // 토큰 교환
            const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
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
            const userRes = await fetch('https://api.github.com/user', {
                headers: {
                    Authorization: `Bearer ${tokenData.access_token}`,
                    'User-Agent': APP_USER_AGENT
                }
            });

            const githubUser = await userRes.json() as GitHubUser;
            let email = githubUser.email;

            // 이메일 없으면 별도 API 호출
            if (!email) {
                const emailRes = await fetch('https://api.github.com/user/emails', {
                    headers: {
                        Authorization: `Bearer ${tokenData.access_token}`,
                        'User-Agent': APP_USER_AGENT
                    }
                });
                const emails = await emailRes.json() as GitHubEmail[];
                const primaryEmail = emails.find(e => e.primary);
                email = primaryEmail?.email || `${githubUser.login}@github.local`;
            }

             const authService = getAuthService();
              const result = await authService.findOrCreateOAuthUser(email, 'github');

              if (!result.success || !result.token || !result.user) throw new Error(result.error || '인증 실패');

             setTokenCookie(res, result.token);
             setRefreshTokenCookie(res, generateRefreshToken(result.user));
             res.redirect('/');
        } catch (error) {
            log.error('[OAuth GitHub Callback] 오류:', error);
            res.redirect('/login.html?error=oauth_failed');
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
 * AuthController 인스턴스를 생성하는 팩토리 함수
 * 
 * @param serverPort - 서버 포트 번호 (선택적, 기본값: .env PORT)
 * @returns 설정된 Express Router
 */
export function createAuthController(serverPort?: number): Router {
    return new AuthController(serverPort).getRouter();
}
