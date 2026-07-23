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
import * as crypto from 'crypto';
import { getAuthService } from '../services/AuthService';
import type { OAuthTokenResponse, GoogleUserInfo, GitHubUser, GitHubEmail, KakaoUserInfo } from '../auth/types';
import { setTokenCookie, setRefreshTokenCookie, generateRefreshToken } from '../auth';
import { createLogger } from '../utils/logger';
import { success, badRequest, serviceUnavailable } from '../utils/api-response';
import { getConfig } from '../config/env';
import { APP_USER_AGENT } from '../config/constants';
import { GOOGLE_OAUTH, GITHUB_OAUTH, GITHUB_API, KAKAO_OAUTH } from '../config/external-services';

const log = createLogger('AuthOAuthController');

// 🔒 Phase 2 보안 패치 2026-02-07: OAuth State 저장소 (CSRF 방어용)
// 🔒 Phase 3 패치 2026-02-13: 인메모리 Map → DB 저장으로 변경 (클러스터/재시작 안전)
// PostgreSQL을 사용하여 프로세스 간 공유 가능, 서버 재시작에도 유지됨
const STATE_TTL_MS = Number(process.env.OAUTH_STATE_TTL_MS) || 5 * 60 * 1000; // 기본 5분
const STATE_CLEANUP_INTERVAL_MS = Number(process.env.OAUTH_STATE_CLEANUP_INTERVAL_MS) || 60 * 1000; // 기본 60초

// 인메모리 폴백: DB 연결 실패 시 임시 사용 (단일 프로세스 한정)
const oauthStatesFallback = new Map<string, { provider: string; createdAt: number }>();

/**
 * DB 기반 OAuth state 저장소 헬퍼 (안전 폴백)
 *
 * 주 DDL은 db/init/002-schema.sql에서 관리합니다.
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
let oauthCleanupInFlight = false;
const oauthCleanupTimer = setInterval(() => {
    if (oauthCleanupInFlight) {
        return;
    }

    oauthCleanupInFlight = true;

    void (async () => {
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
        } finally {
            oauthCleanupInFlight = false;
        }
    })();
}, STATE_CLEANUP_INTERVAL_MS);
// BUG-R3-002: unref() - 타이머가 프로세스 종료를 막지 않도록 설정
if ((oauthCleanupTimer as NodeJS.Timeout & { unref?: () => void }).unref) {
    (oauthCleanupTimer as NodeJS.Timeout & { unref: () => void }).unref();
}

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
 * 1. OAUTH_REDIRECT_URI 환경변수 (명시적 설정 시) -- 요청 host 와 무관하게 이 canonical
 *    URI 로 항상 고정 (외부 접속을 openmake.cc 단일 origin 으로 수렴)
 * 2. 요청의 Host/Origin 기반 동적 생성 (개발 환경 localhost 폴백)
 *
 * OAUTH_REDIRECT_URI는 Google용으로 설정되어 있어도 provider 부분을 자동 교체합니다.
 */
function buildRedirectUri(req: Request, provider: 'google' | 'github' | 'kakao', serverPort: number): string {
    const configuredUri = getConfig().oauthRedirectUri;
    // 외부 접속은 리버스 프록시(Next.js rewrites / Nginx)를 거치므로 req.get('host') 는
    // 프록시 destination(예: localhost:52416)이 되어 redirect_uri 가 외부 주소로 생성되지 않는다.
    // 원본 Host(예: rasplay.tplinkdns.com:33000)는 x-forwarded-host 에 담기므로 이를 우선 사용해
    // Google Console 등록 URI 와 일치시켜 redirect_uri_mismatch 를 방지한다. (trust proxy 신뢰 + Google 승인목록 2차검증)
    const forwardedHost = req.get('x-forwarded-host');
    const requestHost = (forwardedHost ? forwardedHost.split(',')[0].trim() : req.get('host')) || `localhost:${serverPort}`;
    const forwardedProto = req.get('x-forwarded-proto');
    const requestProtocol = (forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol) || 'http';

    const dynamicRedirectUri = `${requestProtocol}://${requestHost}/api/auth/callback/${provider}`;
    log.info(`[OAuth] host 해석: x-forwarded-host=${forwardedHost ?? '(none)'}, raw-host=${req.get('host') ?? '(none)'}, 사용=${requestHost}`);

    // OAUTH_REDIRECT_URI가 명시적으로 설정된 경우(프로덕션), 요청 host 와 무관하게 항상 이
    // canonical URI 로 고정한다. ts.net(Funnel)·rasplay 등 다른 host 로 진입하면 리버스 프록시가
    // 평문이라 proto=http 로 동적 URI 가 만들어져 Google redirect_uri_mismatch 로 실패하던 문제를
    // 차단한다. 어느 진입점이든 로그인 완료는 openmake.cc 단일 origin 으로 착지한다.
    // (redirect_uri 를 요청 host 가 아닌 신뢰된 상수로 고정 → open-redirect 관점에서도 더 안전)
    if (configuredUri && !configuredUri.includes('localhost')) {
        try {
            const configured = new URL(configuredUri);
            const redirectUri = configuredUri.replace(/\/callback\/\w+$/, `/callback/${provider}`);
            if (configured.host !== requestHost) {
                log.info(`[OAuth] host(${requestHost}) → canonical redirect 고정: ${redirectUri}`);
            } else {
                log.info(`[OAuth] Redirect URI (config): ${redirectUri}`);
            }
            return redirectUri;
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
 * OAuth 로그인 성공 후 리다이렉트 (Set-Cookie 동반).
 *
 * 302 redirect 대신 200 HTML(meta refresh)로 응답한다 — Next.js dev rewrites(프록시)가
 * 3xx 응답의 Set-Cookie 헤더를 브라우저로 전파하지 못해 외부 접속 시 로그인 세션이
 * 게스트로 떨어지던 문제를 우회한다. 200 응답의 Set-Cookie 는 정상 전파됨.
 * path 는 내부 고정 경로만 전달 (open redirect / XSS 불가).
 */
function sendOAuthSuccessRedirect(res: Response, path: string): void {
    res.status(200).type('html').send(
        '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">' +
        `<meta http-equiv="refresh" content="0;url=${path}">` +
        '<title>로그인 완료</title></head>' +
        `<body style="font-family:sans-serif">로그인 완료. 이동 중…<br><a href="${path}">계속하기</a></body></html>`,
    );
}

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
        // 이메일(account_email)은 비즈앱 검수가 필요해 '권한 없음' 상태 → 닉네임(profile_nickname,
        // 필수 동의)으로 대체. 사용자 식별은 콜백에서 카카오 회원번호(id)로 처리한다.
        authUrl.searchParams.set('scope', 'profile_nickname');
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

            // 카카오 이메일 동의항목은 비즈앱 검수 전이라 '권한 없음' → 회원번호(id)로 식별한다.
            // 회원번호는 '사용자 아이디 고정'(기본 ON)으로 안정적이며, 기존 email 기반 계정 모델에
            // 합성 이메일(kakao_<id>@kakao.local)로 매핑한다. 이메일 동의가 열리면 이 매핑만 교체.
            const kakaoId = kakaoUser.id;
            if (!kakaoId) throw new Error('카카오 사용자 정보를 가져올 수 없습니다');
            const email = `kakao_${kakaoId}@kakao.local`;

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
