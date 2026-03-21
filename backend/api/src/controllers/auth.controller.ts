/**
 * ============================================================
 * Auth Controller
 * ============================================================
 * 인증 관련 API 라우트 (로컬 인증)
 *
 * OAuth 관련 핸들러는 auth-oauth.controller.ts로 분리되었습니다.
 */

import { Request, Response, Router } from 'express';
import { getAuthService } from '../services/AuthService';
import { getUserManager } from '../data/user-manager';
import { requireAuth, extractToken, blacklistToken, setTokenCookie, clearTokenCookie, setRefreshTokenCookie, generateRefreshToken, generateToken, verifyRefreshToken } from '../auth';
import { createLogger } from '../utils/logger';
import { success, badRequest, unauthorized, conflict, internalError } from '../utils/api-response';
import { getConfig } from '../config/env';
import { validate } from '../middlewares/validation';
import { loginSchema, registerSchema, changePasswordSchema, tierChangeSchema } from '../schemas';
import { createAuthOAuthController } from './auth-oauth.controller';

// OAuth cleanup 재수출 (server.ts에서 import하는 경로 유지)
export { stopOAuthCleanup } from './auth-oauth.controller';

const log = createLogger('AuthController');

/**
 * 인증 관련 API 컨트롤러
 *
 * @class AuthController
 * @description
 * - 기본 인증 (register, login, logout)
 * - 비밀번호 변경
 * - 사용자 정보 조회
 * - 토큰 갱신
 *
 * OAuth 인증은 AuthOAuthController (auth-oauth.controller.ts)에서 처리합니다.
 */
export class AuthController {
    /** Express 라우터 인스턴스 */
    private router: Router;

    /**
     * AuthController 인스턴스를 생성합니다.
     * @param serverPort - 서버 포트 번호 (OAuth 컨트롤러에 전달, 기본값: .env PORT)
     */
    constructor(serverPort: number = getConfig().port) {
        this.router = Router();
        this.setupRoutes(serverPort);
    }

    private setupRoutes(serverPort: number): void {
        // ===== 기본 인증 API =====
        this.router.post('/register', validate(registerSchema), this.register.bind(this));
        this.router.post('/login', validate(loginSchema), this.login.bind(this));
        this.router.post('/logout', this.logout.bind(this));
        this.router.get('/me', requireAuth, this.getCurrentUser.bind(this));
        this.router.put('/password', requireAuth, validate(changePasswordSchema), this.changePassword.bind(this));
        this.router.put('/tier', requireAuth, validate(tierChangeSchema), this.changeTier.bind(this));

        // ===== Token Refresh =====
        this.router.post('/refresh', this.refresh.bind(this));

        // ===== OAuth API (auth-oauth.controller.ts에서 분리된 라우트) =====
        this.router.use('/', createAuthOAuthController(serverPort));
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
     * PUT /api/auth/tier - 사용자 등급 변경 (셀프 서비스)
     * 인증된 사용자가 자신의 등급을 free/pro/enterprise로 변경합니다.
     */
    private async changeTier(req: Request, res: Response): Promise<void> {
        try {
            const user = req.user;
            if (!user?.id) {
                res.status(401).json(unauthorized('인증 정보가 불완전합니다'));
                return;
            }

            const { tier } = req.body;
            const userManager = getUserManager();
            const updated = await userManager.changeTier(String(user.id), tier);

            if (!updated) {
                res.status(404).json(badRequest('사용자를 찾을 수 없습니다'));
                return;
            }

            log.info(`사용자 등급 변경: ${updated.email} -> ${tier}`);
            res.json(success({ user: updated }));
        } catch (error) {
            log.error('[ChangeTier] 오류:', error);
            res.status(500).json(internalError('등급 변경 중 오류가 발생했습니다'));
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
