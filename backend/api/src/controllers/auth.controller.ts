/**
 * ============================================================
 * Auth Controller
 * ============================================================
 * 인증 관련 API 라우트
 */

import { Request, Response, Router } from 'express';
import { getAuthService } from '../services/AuthService';
import { getUserManager } from '../data/user-manager';
import { requireAuth, requireAdmin, extractToken, blacklistToken, setTokenCookie, clearTokenCookie } from '../auth';
import { createLogger } from '../utils/logger';
import { success, badRequest, unauthorized, conflict, internalError, serviceUnavailable } from '../utils/api-response';

const log = createLogger('AuthController');

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
     * @param serverPort - 서버 포트 번호 (기본값: 52416)
     */
    constructor(serverPort: number = 52416) {
        this.router = Router();
        this.serverPort = serverPort;
        this.setupRoutes();
    }

    private setupRoutes(): void {
        const authService = getAuthService();
        const userManager = getUserManager();

        // ===== 기본 인증 API =====
        this.router.post('/register', this.register.bind(this));
        this.router.post('/login', this.login.bind(this));
        this.router.post('/logout', this.logout.bind(this));
        this.router.get('/me', requireAuth, this.getCurrentUser.bind(this));
        this.router.put('/password', requireAuth, this.changePassword.bind(this));

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
                userId: typeof user.id === 'string' ? parseInt(user.id, 10) : user.id,
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
    private googleLogin(req: Request, res: Response): void {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const redirectUri = process.env.OAUTH_REDIRECT_URI ||
            `http://localhost:${this.serverPort}/api/auth/callback/google`;

        if (!clientId) {
            res.status(503).json(serviceUnavailable('Google OAuth가 설정되지 않았습니다'));
            return;
        }

        const state = Math.random().toString(36).substring(7) + Date.now();
        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', 'email profile');
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('access_type', 'offline');
        authUrl.searchParams.set('prompt', 'consent');

        log.info('[OAuth] Google 로그인 리다이렉트');
        res.redirect(authUrl.toString());
    }

    /**
     * GET /api/auth/login/github - GitHub OAuth 시작
     */
    private githubLogin(req: Request, res: Response): void {
        const clientId = process.env.GITHUB_CLIENT_ID;
        const redirectUri = process.env.OAUTH_REDIRECT_URI ||
            `http://localhost:${this.serverPort}/api/auth/callback/github`;

        if (!clientId) {
            res.status(503).json(serviceUnavailable('GitHub OAuth가 설정되지 않았습니다'));
            return;
        }

        const state = Math.random().toString(36).substring(7) + Date.now();
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
        const { code, error: oauthError } = req.query;

        if (oauthError) {
            res.redirect(`/login.html?error=${encodeURIComponent(String(oauthError))}`);
            return;
        }

        if (!code) {
            res.redirect('/login.html?error=no_code');
            return;
        }

        try {
            const clientId = process.env.GOOGLE_CLIENT_ID!;
            const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
            const redirectUri = process.env.OAUTH_REDIRECT_URI ||
                `http://localhost:${this.serverPort}/api/auth/callback/google`;

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

            const tokenData = await tokenRes.json() as any;
            if (!tokenData.access_token) throw new Error('토큰 교환 실패');

            // 사용자 정보 가져오기
            const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${tokenData.access_token}` }
            });

            const userInfo = await userInfoRes.json() as any;
            if (!userInfo.email) throw new Error('이메일 정보를 가져올 수 없습니다');

             const authService = getAuthService();
              const result = await authService.findOrCreateOAuthUser(userInfo.email, 'google');

              if (!result.success || !result.token) throw new Error(result.error || '인증 실패');

             setTokenCookie(res, result.token);
             res.redirect('/');
        } catch (error) {
            log.error('[OAuth Google Callback] 오류:', error);
            res.redirect(`/login.html?error=${encodeURIComponent(String(error))}`);
        }
    }

    /**
     * GET /api/auth/callback/github - GitHub OAuth 콜백
     */
    private async githubCallback(req: Request, res: Response): Promise<void> {
        const { code, error: oauthError } = req.query;

        if (oauthError) {
            res.redirect(`/login.html?error=${encodeURIComponent(String(oauthError))}`);
            return;
        }

        if (!code) {
            res.redirect('/login.html?error=no_code');
            return;
        }

        try {
            const clientId = process.env.GITHUB_CLIENT_ID!;
            const clientSecret = process.env.GITHUB_CLIENT_SECRET!;

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

            const tokenData = await tokenRes.json() as any;
            if (!tokenData.access_token) throw new Error('토큰 교환 실패');

            // 사용자 정보 가져오기
            const userRes = await fetch('https://api.github.com/user', {
                headers: {
                    Authorization: `Bearer ${tokenData.access_token}`,
                    'User-Agent': 'Ollama-Chat'
                }
            });

            const githubUser = await userRes.json() as any;
            let email = githubUser.email;

            // 이메일 없으면 별도 API 호출
            if (!email) {
                const emailRes = await fetch('https://api.github.com/user/emails', {
                    headers: {
                        Authorization: `Bearer ${tokenData.access_token}`,
                        'User-Agent': 'Ollama-Chat'
                    }
                });
                const emails = await emailRes.json() as any[];
                const primaryEmail = emails.find(e => e.primary);
                email = primaryEmail?.email || `${githubUser.login}@github.local`;
            }

             const authService = getAuthService();
              const result = await authService.findOrCreateOAuthUser(email, 'github');

              if (!result.success || !result.token) throw new Error(result.error || '인증 실패');

             setTokenCookie(res, result.token);
             res.redirect('/');
        } catch (error) {
            log.error('[OAuth GitHub Callback] 오류:', error);
            res.redirect(`/login.html?error=${encodeURIComponent(String(error))}`);
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
 * @param serverPort - 서버 포트 번호 (선택적, 기본값: 52416)
 * @returns 설정된 Express Router
 */
export function createAuthController(serverPort?: number): Router {
    return new AuthController(serverPort).getRouter();
}
