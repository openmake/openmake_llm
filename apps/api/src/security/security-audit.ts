/**
 * 보안 거부·자격 변경 감사 기록 (S10, 2026-10-22).
 *
 * 인가 실패·SSRF 차단·도구 인자 차단·승인 자동 거절, BYOK 키·MCP 서버 등록/삭제를 audit_logs 에 남긴다.
 * 거부 지점에서 부르는 헬퍼라 **절대 throw 하지 않는다** — 기록 실패는 warn 로그만 남기고 삼킨다(fail-open).
 *
 * - audit_logs.user_id 는 users FK — 게스트('guest')·빈값은 user_id 없이 넣는다. details.actorId 는 손님이면 'guest',
 *   userId 가 없으면(undefined·null·빈 문자열) 'anonymous' 로 구분한다
 *   (tool-contract/tool-execution-guard 의 auditToolCall 선례).
 * - AuditService 는 동적 import — security 모듈이 서비스 계층을 정적으로 끌어오지 않게 한다(순환 의존 방지).
 *
 * @module security/security-audit
 */
import { createLogger } from '../utils/logger';
import { capText } from '../utils/redact';

const logger = createLogger('SecurityAudit');

/** details 문자열 값 길이 상한 */
const DETAIL_TEXT_MAX_CHARS = 200;
/** details 키 개수 상한 — 넘는 키는 버린다 */
const DETAIL_MAX_KEYS = 20;

export type SecurityAuditAction =
    | 'security.authz_denied'
    | 'security.ssrf_blocked'
    | 'security.tool_args_blocked'
    | 'security.approval_auto_rejected'
    | 'external_key.set'
    | 'external_key.delete'
    | 'mcp_server.create'
    | 'mcp_server.delete'
    | 'mcp_server.register_denied'
    | 'mcp_server.spawn_refused';

export type SecurityAuditInput = {
    action: SecurityAuditAction;
    userId?: string | number | null;
    resourceType?: string;
    resourceId?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
};

/** PURE: undefined 값 제거, 문자열 값은 길이 캡, 키 20개 초과분은 버린다(앞에서부터 20개). */
export function securityAuditDetails(d: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(d)) {
        if (v === undefined) continue;
        if (Object.keys(out).length >= DETAIL_MAX_KEYS) break;
        out[k] = typeof v === 'string' ? capText(v, DETAIL_TEXT_MAX_CHARS) : v;
    }
    return out;
}

/** 보안 사건 한 건을 감사 기록으로 남긴다. 실패는 로그만 남기고 삼킨다 — 절대 throw 하지 않는다. */
export async function auditSecurityEvent(input: SecurityAuditInput): Promise<void> {
    try {
        const rawUid = input.userId !== undefined && input.userId !== null ? String(input.userId) : undefined;
        const hasUid = rawUid !== undefined && rawUid !== '';
        const isRealUser = hasUid && rawUid !== 'guest';
        // actorId 는 캡 뒤에 얹는다 — 호출부 details 가 덮어쓰거나 키 상한에 밀려 빠지지 않게.
        const details = { ...securityAuditDetails(input.details ?? {}), actorId: hasUid ? rawUid : 'anonymous' };
        const { getAuditService } = await import('../services/AuditService');
        await getAuditService().logAudit({
            action: input.action,
            userId: isRealUser ? rawUid : undefined,
            resourceType: input.resourceType,
            resourceId: input.resourceId !== undefined ? capText(input.resourceId, DETAIL_TEXT_MAX_CHARS) : undefined,
            details,
            ipAddress: input.ipAddress,
            userAgent: input.userAgent,
        });
    } catch (e) {
        logger.warn(`보안 감사 기록 실패(${input.action}): ${e instanceof Error ? e.message : String(e)}`);
    }
}

/** SSRF 가드(security/ssrf-guard)가 던진 차단 오류인지 — 오류 문구 접두로 판별한다. */
export function isSsrfBlockedError(e: unknown): boolean {
    return e instanceof Error && e.message.startsWith('SSRF blocked');
}
