/**
 * 성공 로그인 감사 기록 (login.succeeded — login.failed 와 짝).
 *
 * 새 세션(access + refresh 토큰)이 만들어지는 경로에서만 부른다: 비밀번호 로그인, OAuth 웹 콜백,
 * exchange code 교환(모바일·웹 SSO). 토큰 갱신(refresh)은 로그인이 아니므로 부르지 않는다.
 * 계정 탈취 조사에서 "언제·어느 IP 로 들어왔는지"를 보는 용도 — 비밀번호·토큰·코드는 넣지 않는다.
 * login.failed 와 같이 fire-and-forget: 기록이 실패해도 로그인을 막지 않는다.
 * 보존: data/db-retention.ts (AUDIT_LOGIN_SUCCESS_RETENTION_DAYS).
 *
 * @module controllers/auth-login-audit
 */
import type { Request } from 'express';
import { createLogger } from '../utils/logger';

const log = createLogger('AuthLoginAudit');

/** 로그인 방식 — password: 이메일·비밀번호, oauth: 프로바이더 콜백(쿠키), exchange: 일회성 코드 교환(모바일·웹 SSO) */
export interface LoginSuccessDetails {
    method: 'password' | 'oauth' | 'exchange';
    /** oauth·exchange 일 때 프로바이더 (exchange 는 코드에 묶인 값 — 예: 'google', 'sso:bench:session') */
    provider?: string;
}

export function auditLoginSucceeded(
    req: Request,
    user: { id: string | number; email?: string; role?: string },
    details: LoginSuccessDetails,
): void {
    void (async () => {
        try {
            const { getAuditService } = await import('../services/AuditService');
            await getAuditService().logAudit({
                action: 'login.succeeded',
                userId: String(user.id),
                resourceType: 'auth',
                details: { ...details },
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'],
                actor: { email: user.email, role: user.role },
            });
        } catch (e) { log.warn('[audit] login.succeeded 기록 실패:', e); }
    })();
}
