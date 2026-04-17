/**
 * CSRF Double-Submit Cookie 미들웨어
 *
 * 기존 `sameSite=lax` 쿠키 방어 위에 defense-in-depth로 CSRF 토큰 검증을 추가합니다.
 * 공격자가 서브도메인 탈취 등으로 same-site가 되어도 토큰은 탈취 불가.
 *
 * 3단 모드 (additive):
 *   - off     : 비활성
 *   - warn    : 불일치 로깅만 (기본값, 배포 후 즉시 모니터링)
 *   - enforce : 불일치 시 403
 *
 * Skip 규칙 (의도적 예외):
 *   - safe methods (GET/HEAD/OPTIONS)      — 토큰 없어도 상태 변경 안 함
 *   - API-key 인증 요청                      — 비브라우저 클라이언트, 쿠키 없음
 *   - OAuth 콜백 (/api/auth/callback/*)     — 제3자 redirect, 자체 state로 보호
 *   - 토큰 발급 엔드포인트 (/api/csrf-token) — 자기 참조 방지
 *
 * @module middlewares/csrf-protection
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { getConfig } from '../config';
import { CSRF_POLICY } from '../config/security';
import { createLogger } from '../utils/logger';

const logger = createLogger('CsrfProtection');

function generateToken(): string {
    return crypto.randomBytes(CSRF_POLICY.TOKEN_BYTES).toString('base64url');
}

function tokensMatch(a: unknown, b: unknown): boolean {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length === 0 || a.length !== b.length) return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return crypto.timingSafeEqual(bufA, bufB);
}

function shouldSkip(req: Request): boolean {
    if (CSRF_POLICY.SAFE_METHODS.has(req.method)) return true;
    // app.use('/api', mw) 마운트 시 req.path는 prefix가 벗겨지므로 originalUrl로 비교
    const fullPath = (req.originalUrl || req.url).split('?')[0];
    for (const prefix of CSRF_POLICY.SKIP_PATHS) {
        if (fullPath.startsWith(prefix)) return true;
    }
    // 비-쿠키 인증 요청은 CSRF 무관 (공격자가 Authorization 헤더를 cross-origin으로 설정 불가)
    if (req.get('X-API-Key')) return true;
    const auth = req.get('Authorization');
    if (auth && auth.toLowerCase().startsWith('bearer ')) return true;
    return false;
}

/**
 * CSRF 검증 미들웨어 — /api/* 스코프에 등록.
 * mode=off이면 no-op, warn이면 불일치 로그만, enforce면 403.
 */
export function csrfProtectionMiddleware(req: Request, res: Response, next: NextFunction): void {
    const mode = getConfig().csrfProtection;
    if (mode === 'off') return next();
    if (shouldSkip(req)) return next();

    const cookieToken = req.cookies?.[CSRF_POLICY.COOKIE_NAME];
    const headerToken = req.get(CSRF_POLICY.HEADER_NAME);

    if (tokensMatch(cookieToken, headerToken)) return next();

    const meta = {
        method: req.method,
        path: req.path,
        hasCookie: typeof cookieToken === 'string' && cookieToken.length > 0,
        hasHeader: typeof headerToken === 'string' && headerToken.length > 0,
        requestId: req.requestId,
    };

    if (mode === 'warn') {
        logger.warn('CSRF token mismatch (warn mode, request allowed)', meta);
        return next();
    }

    // mode === 'enforce'
    logger.warn('CSRF token mismatch (rejected)', meta);
    res.status(403).json({
        error: 'CSRF validation failed',
        code: 'CSRF_TOKEN_MISMATCH',
    });
}

/**
 * GET /api/csrf-token 핸들러 — non-HttpOnly 쿠키로 토큰 발급.
 * 프론트엔드 JS가 쿠키를 읽어 이후 mutating 요청의 X-CSRF-Token 헤더에 복사.
 */
export function csrfTokenIssuer(_req: Request, res: Response): void {
    const token = generateToken();
    res.cookie(CSRF_POLICY.COOKIE_NAME, token, {
        httpOnly: false,
        secure: getConfig().cookieSecure,
        sameSite: CSRF_POLICY.COOKIE_OPTIONS.SAME_SITE,
        maxAge: CSRF_POLICY.COOKIE_MAX_AGE_MS,
        path: CSRF_POLICY.COOKIE_OPTIONS.PATH,
    });
    res.json({ token });
}
