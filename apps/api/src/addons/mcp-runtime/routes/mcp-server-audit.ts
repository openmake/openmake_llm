/**
 * MCP 서버 등록·삭제·거부·URL 차단 감사 (S10, 2026-10-22).
 *
 * mcp.routes / mcp-catalog.routes 의 각 지점이 1줄로 부르는 래퍼 — 본문은 security/security-audit 의
 * auditSecurityEvent(절대 throw 안 함)이고 여기서는 await 하지 않는다(응답에 영향 없음).
 * env·url 전체·command 는 details 에 싣지 않는다 — 서버 id·이름·출처, URL 은 host 만.
 *
 * @module addons/mcp-runtime/routes/mcp-server-audit
 */
import type { Request } from 'express';
import { auditSecurityEvent, isSsrfBlockedError } from '../../../security/security-audit';

function actor(req: Request) {
    return { userId: req.user?.id, ipAddress: req.ip, userAgent: req.get('user-agent') };
}

/** URL 의 host(포트 포함)만 — 경로·쿼리·계정은 버린다. 파싱 실패는 'invalid'. */
function urlHost(raw: string): string {
    try { return new URL(raw).host; } catch { return 'invalid'; }
}

export function auditMcpServerCreated(req: Request, server: { id: string; name: string; source?: 'manual' | 'catalog' }): void {
    void auditSecurityEvent({
        action: 'mcp_server.create', ...actor(req), resourceType: 'mcp_server', resourceId: server.id,
        details: { name: server.name, source: server.source },
    });
}

export function auditMcpServerDeleted(req: Request, server: { id: string; name?: string }): void {
    void auditSecurityEvent({
        action: 'mcp_server.delete', ...actor(req), resourceType: 'mcp_server', resourceId: server.id,
        details: { name: server.name },
    });
}

/** 삭제 권한 없음(403) — 인가 실패로 남긴다(db-retention 이 AUDIT_AUTHZ_DENIED_RETENTION_DAYS 뒤 지운다). */
export function auditMcpDeleteDenied(req: Request, serverId: string): void {
    void auditSecurityEvent({
        action: 'security.authz_denied', ...actor(req), resourceType: 'mcp_server', resourceId: serverId,
    });
}

export function auditMcpRegisterDenied(req: Request, reason: string, details?: Record<string, unknown>): void {
    void auditSecurityEvent({
        action: 'mcp_server.register_denied', ...actor(req), resourceType: 'mcp_server',
        details: { reason, ...details },
    });
}

/** URL 거부 — SSRF 가드 차단만 남긴다(DNS 실패 등 다른 오류는 감사 안 함, web-scraper-tools 와 같은 기준). */
export function auditMcpUrlBlocked(req: Request, rawUrl: string, err: unknown): void {
    if (!isSsrfBlockedError(err)) return;
    void auditSecurityEvent({
        action: 'security.ssrf_blocked', ...actor(req), resourceType: 'url', resourceId: urlHost(rawUrl),
        details: { target: 'mcp_server', reason: (err as Error).message },
    });
}
