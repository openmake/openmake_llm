/**
 * 인증 관련 라우트 모듈
 * @module routes/AuthRoutes
 * 
 * 🔒 보안 강화: OAuth CSRF 방어를 위한 state 검증 추가
 */

import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { getUserManager, UserRole } from '../data/user-manager';
import { generateToken, requireAuth, requireAdmin, extractToken, blacklistToken } from '../auth';
import type { OAuthTokenResponse, GoogleUserInfo, GitHubUser, GitHubEmail } from '../auth/types';

// 로그 헬퍼
const log = {
    info: (msg: string, ...args: unknown[]) => console.log(`[INFO] ${msg}`, ...args),
    error: (msg: string, ...args: unknown[]) => console.error(`[ERROR] ${msg}`, ...args)
};

// 🔒 OAuth State 저장소 (CSRF 방어용)
// TTL이 있는 Map으로 구현 - 5분 후 자동 만료
const oauthStates = new Map<string, { provider: string; createdAt: number }>();
const STATE_TTL_MS = 5 * 60 * 1000; // 5분

// State 정리 스케줄러 (1분마다 만료된 state 제거)
setInterval(() => {
    const now = Date.now();
    for (const [state, data] of oauthStates.entries()) {
        if (now - data.createdAt > STATE_TTL_MS) {
            oauthStates.delete(state);
        }
    }
}, 60 * 1000);

/**
 * 🔒 보안 강화된 OAuth state 생성
 */
function generateSecureState(provider: string): string {
    const state = crypto.randomBytes(32).toString('hex');
    oauthStates.set(state, { provider, createdAt: Date.now() });
    return state;
}

/**
 * 🔒 OAuth state 검증 및 소비 (일회성)
 */
function validateAndConsumeState(state: string | undefined, expectedProvider: string): boolean {
    if (!state) return false;
    
    const data = oauthStates.get(state);
    if (!data) {
        log.error(`[OAuth] State not found: ${state?.substring(0, 10)}...`);
        return false;
    }
    
    // 일회성 사용을 위해 즉시 삭제
    oauthStates.delete(state);
    
    // 만료 체크
    if (Date.now() - data.createdAt > STATE_TTL_MS) {
        log.error('[OAuth] State expired');
        return false;
    }
    
    // Provider 일치 체크
    if (data.provider !== expectedProvider) {
        log.error(`[OAuth] Provider mismatch: expected ${expectedProvider}, got ${data.provider}`);
        return false;
    }
    
    return true;
}

export function createAuthRoutes(port: number): Router {
    const router = Router();
    const userManager = getUserManager();

    // 회원가입
    router.post('/register', async (req: Request, res: Response) => {
        try {
            const { email, password } = req.body;

            if (!email || !password) {
                res.status(400).json({ success: false, error: '이메일과 비밀번호를 입력하세요' });
                return;
            }

            if (password.length < 6) {
                res.status(400).json({ success: false, error: '비밀번호는 6자 이상이어야 합니다' });
                return;
            }

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                res.status(400).json({ success: false, error: '유효한 이메일 주소를 입력하세요' });
                return;
            }

             const user = await userManager.createUser({ email, password });

            if (!user) {
                res.status(409).json({ success: false, error: '이미 등록된 이메일입니다' });
                return;
            }

            log.info(`회원가입 완료: ${email}`);
            res.json({ success: true, user });
        } catch (error) {
            log.error('[Auth Register] 오류:', error);
            res.status(500).json({ success: false, error: '회원가입 처리 중 오류가 발생했습니다' });
        }
    });

    // 로그인
    router.post('/login', async (req: Request, res: Response) => {
        try {
            const { email, password } = req.body;

            if (!email || !password) {
                res.status(400).json({ success: false, error: '이메일과 비밀번호를 입력하세요' });
                return;
            }

             const user = await userManager.authenticate(email, password);

            if (!user) {
                res.status(401).json({ success: false, error: '이메일 또는 비밀번호가 올바르지 않습니다' });
                return;
            }

            const token = generateToken(user);
            log.info(`로그인 성공: ${email}`);
            res.json({ success: true, token, user });
        } catch (error) {
            log.error('[Auth Login] 오류:', error);
            res.status(500).json({ success: false, error: '로그인 처리 중 오류가 발생했습니다' });
        }
    });

    // 로그아웃 (#8 연동: 토큰 블랙리스트)
    router.post('/logout', (req: Request, res: Response) => {
        const authHeader = req.headers.authorization;
        if (authHeader) {
            const token = extractToken(authHeader);
            if (token) {
                blacklistToken(token);
            }
        }
        res.json({ success: true, message: '로그아웃되었습니다' });
    });

    // 현재 사용자 정보
    router.get('/me', requireAuth, (req: Request, res: Response) => {
        res.json({ success: true, user: req.user });
    });

     // 비밀번호 변경
     router.put('/password', requireAuth, async (req: Request, res: Response) => {
        try {
            const { currentPassword, newPassword } = req.body;
            const currentUser = req.user;
            
            if (!currentUser?.id || !currentUser?.email) {
                res.status(401).json({ success: false, error: '인증 정보가 불완전합니다' });
                return;
            }
            
            const userId = typeof currentUser.id === 'string' ? parseInt(currentUser.id, 10) : currentUser.id;

            if (!currentPassword || !newPassword) {
                res.status(400).json({ success: false, error: '현재 비밀번호와 새 비밀번호를 입력하세요' });
                return;
            }

            if (newPassword.length < 6) {
                res.status(400).json({ success: false, error: '새 비밀번호는 6자 이상이어야 합니다' });
                return;
            }

             const user = await userManager.authenticate(currentUser.email, currentPassword);
             if (!user) {
                 res.status(401).json({ success: false, error: '현재 비밀번호가 올바르지 않습니다' });
                 return;
             }

             const success = await userManager.changePassword(userId, newPassword);
            res.json({ success });
        } catch (error) {
            log.error('[Auth Password] 오류:', error);
            res.status(500).json({ success: false, error: '비밀번호 변경 중 오류가 발생했습니다' });
        }
    });

    // OAuth 프로바이더 목록
    router.get('/providers', (req: Request, res: Response) => {
        const providers: string[] = [];
        if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
            providers.push('google');
        }
        if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
            providers.push('github');
        }
        res.json({ providers });
    });

    // Google OAuth 로그인
    router.get('/login/google', (req: Request, res: Response) => {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const redirectUri = process.env.OAUTH_REDIRECT_URI || `http://localhost:${port}/api/auth/callback/google`;

        if (!clientId) {
            res.status(503).json({ error: 'Google OAuth가 설정되지 않았습니다' });
            return;
        }

        // 🔒 보안 강화: 암호학적으로 안전한 state 생성
        const state = generateSecureState('google');
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
    });

    // GitHub OAuth 로그인
    router.get('/login/github', (req: Request, res: Response) => {
        const clientId = process.env.GITHUB_CLIENT_ID;
        const redirectUri = process.env.OAUTH_REDIRECT_URI || `http://localhost:${port}/api/auth/callback/github`;

        if (!clientId) {
            res.status(503).json({ error: 'GitHub OAuth가 설정되지 않았습니다' });
            return;
        }

        // 🔒 보안 강화: 암호학적으로 안전한 state 생성
        const state = generateSecureState('github');
        const authUrl = new URL('https://github.com/login/oauth/authorize');
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('scope', 'read:user user:email');
        authUrl.searchParams.set('state', state);

        log.info('[OAuth] GitHub 로그인 리다이렉트');
        res.redirect(authUrl.toString());
    });

    // Google OAuth 콜백
    router.get('/callback/google', async (req: Request, res: Response) => {
        const { code, error: oauthError, state } = req.query;

        if (oauthError) {
            res.redirect(`/login.html?error=${encodeURIComponent(String(oauthError))}`);
            return;
        }

        // 🔒 CSRF 방어: state 검증
        if (!validateAndConsumeState(state as string | undefined, 'google')) {
            log.error('[OAuth] Google callback: Invalid or expired state');
            res.redirect('/login.html?error=invalid_state');
            return;
        }

        if (!code) {
            res.redirect('/login.html?error=no_code');
            return;
        }

        try {
            const clientId = process.env.GOOGLE_CLIENT_ID!;
            const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
            const redirectUri = process.env.OAUTH_REDIRECT_URI || `http://localhost:${port}/api/auth/callback/google`;

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

            if (!tokenData.access_token) {
                throw new Error('토큰 교환 실패');
            }

            const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${tokenData.access_token}` }
            });

            const userInfo = await userInfoRes.json() as GoogleUserInfo;
            const email = userInfo.email;

             if (!email) {
                 throw new Error('이메일 정보를 가져올 수 없습니다');
             }

             let user = await userManager.getUserByEmail(email);
             let publicUser = user ? await userManager.getUserById(user.id) : null;

             if (!publicUser) {
                 const randomPassword = Math.random().toString(36).substring(2, 15);
                 // 관리자 이메일 목록 (환경변수에서 가져오기)
                 const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.toLowerCase().trim()).filter(e => e);
                 const role = adminEmails.includes(email.toLowerCase()) ? 'admin' : 'user';
                 publicUser = await userManager.createUser({ email, password: randomPassword, role });
             } else {
                 // 기존 계정이 있지만 환경변수 관리자 목록에 포함된 경우 admin으로 승격
                 const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.toLowerCase().trim()).filter(e => e);
                 if (adminEmails.includes(email.toLowerCase()) && publicUser.role !== 'admin') {
                     await userManager.changeRole(publicUser.id, 'admin');
                     publicUser.role = 'admin';
                 }
             }

            if (!publicUser) {
                throw new Error('사용자 생성 실패');
            }

            const token = generateToken(publicUser);
            log.info(`[OAuth] Google 로그인 성공: ${email}`);
            res.redirect(`/?oauth_token=${token}`);
        } catch (error) {
            log.error('[OAuth Google Callback] 오류:', error);
            res.redirect(`/login.html?error=oauth_failed`);
        }
    });

    // GitHub OAuth 콜백
    router.get('/callback/github', async (req: Request, res: Response) => {
        const { code, error: oauthError, state } = req.query;

        if (oauthError) {
            res.redirect(`/login.html?error=${encodeURIComponent(String(oauthError))}`);
            return;
        }

        // 🔒 CSRF 방어: state 검증
        if (!validateAndConsumeState(state as string | undefined, 'github')) {
            log.error('[OAuth] GitHub callback: Invalid or expired state');
            res.redirect('/login.html?error=invalid_state');
            return;
        }

        if (!code) {
            res.redirect('/login.html?error=no_code');
            return;
        }

        try {
            const clientId = process.env.GITHUB_CLIENT_ID!;
            const clientSecret = process.env.GITHUB_CLIENT_SECRET!;

            const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({
                    client_id: clientId,
                    client_secret: clientSecret,
                    code: String(code)
                })
            });

            const tokenData = await tokenRes.json() as OAuthTokenResponse;

            if (!tokenData.access_token) {
                throw new Error('토큰 교환 실패');
            }

            const userRes = await fetch('https://api.github.com/user', {
                headers: {
                    Authorization: `Bearer ${tokenData.access_token}`,
                    'User-Agent': 'Ollama-Chat'
                }
            });

            const githubUser = await userRes.json() as GitHubUser;
            let email = githubUser.email;

            if (!email) {
                const emailRes = await fetch('https://api.github.com/user/emails', {
                    headers: {
                        Authorization: `Bearer ${tokenData.access_token}`,
                        'User-Agent': 'Ollama-Chat'
                    }
                });
                const emails = await emailRes.json() as GitHubEmail[];
                const primaryEmail = emails.find(e => e.primary);
                email = primaryEmail?.email || `${githubUser.login}@github.local`;
            }

             let user = await userManager.getUserByEmail(email);
             let publicUser = user ? await userManager.getUserById(user.id) : null;

             if (!publicUser) {
                 const randomPassword = Math.random().toString(36).substring(2, 15);
                 publicUser = await userManager.createUser({ email, password: randomPassword });
            }

            if (!publicUser) {
                throw new Error('사용자 생성 실패');
            }

            const token = generateToken(publicUser);
            log.info(`[OAuth] GitHub 로그인 성공: ${email}`);
            res.redirect(`/?oauth_token=${token}`);
        } catch (error) {
            log.error('[OAuth GitHub Callback] 오류:', error);
            res.redirect(`/login.html?error=oauth_failed`);
        }
    });

    return router;
}

export function createAdminRoutes(): Router {
    const router = Router();
    const userManager = getUserManager();

    const log = {
        info: (msg: string, ...args: unknown[]) => console.log(`[INFO] ${msg}`, ...args),
        error: (msg: string, ...args: unknown[]) => console.error(`[ERROR] ${msg}`, ...args)
    };

     // 사용자 목록
     router.get('/users', requireAuth, requireAdmin, async (req: Request, res: Response) => {
         try {
             const { page, limit, role, search } = req.query;
             const result = await userManager.getAllUsers({
                page: page ? parseInt(page as string) : undefined,
                limit: limit ? parseInt(limit as string) : undefined,
                role: role as UserRole,
                search: search as string
            });
            res.json({ success: true, ...result });
        } catch (error) {
            log.error('[Admin Users] 오류:', error);
            res.status(500).json({ success: false, error: String(error) });
        }
    });

     // 사용자 통계
     router.get('/users/stats', requireAuth, requireAdmin, async (req: Request, res: Response) => {
         try {
             const stats = await userManager.getStats();
            res.json({ success: true, ...stats });
        } catch (error) {
            log.error('[Admin Stats] 오류:', error);
            res.status(500).json({ success: false, error: String(error) });
        }
    });

     // 사용자 정보 수정
     router.put('/users/:id', requireAuth, requireAdmin, async (req: Request, res: Response) => {
         try {
             const userId = parseInt(req.params.id);
             const { email, role, is_active } = req.body;
             const user = await userManager.updateUser(userId, { email, role, is_active });

            if (!user) {
                res.status(404).json({ success: false, error: '사용자를 찾을 수 없습니다' });
                return;
            }

            log.info(`사용자 정보 수정: ${user.email}`);
            res.json({ success: true, user });
        } catch (error) {
            log.error('[Admin Update User] 오류:', error);
            res.status(500).json({ success: false, error: String(error) });
        }
    });

     // 사용자 역할 변경
     router.put('/users/:id/role', requireAuth, requireAdmin, async (req: Request, res: Response) => {
         try {
             const userId = parseInt(req.params.id);
             const { role } = req.body;

             if (!['admin', 'user', 'guest'].includes(role)) {
                 res.status(400).json({ success: false, error: '유효하지 않은 역할입니다' });
                 return;
             }

             const user = await userManager.changeRole(userId, role);

            if (!user) {
                res.status(404).json({ success: false, error: '사용자를 찾을 수 없습니다' });
                return;
            }

            log.info(`사용자 역할 변경: ${user.email} -> ${role}`);
            res.json({ success: true, user });
        } catch (error) {
            log.error('[Admin Change Role] 오류:', error);
            res.status(500).json({ success: false, error: String(error) });
        }
    });

     // 사용자 삭제
     router.delete('/users/:id', requireAuth, requireAdmin, async (req: Request, res: Response) => {
         try {
             const userId = parseInt(req.params.id);

             if (userId === req.user!.id) {
                 res.status(400).json({ success: false, error: '자기 자신은 삭제할 수 없습니다' });
                 return;
             }

             const success = await userManager.deleteUser(userId);

            if (!success) {
                res.status(400).json({ success: false, error: '삭제할 수 없습니다 (마지막 관리자이거나 존재하지 않음)' });
                return;
            }

            log.info(`사용자 삭제: ID ${userId}`);
            res.json({ success: true });
        } catch (error) {
            log.error('[Admin Delete User] 오류:', error);
            res.status(500).json({ success: false, error: String(error) });
        }
    });

    return router;
}
