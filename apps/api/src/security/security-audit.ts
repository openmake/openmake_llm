/**
 * 보안 거부·자격 변경 감사 기록 (S10, 2026-10-22).
 *
 * 인가 실패·SSRF 차단·도구 인자 차단·승인 자동 거절, BYOK 키·MCP 서버 등록/삭제를 audit_logs 에 남긴다.
 * 거부 지점에서 부르는 헬퍼라 **절대 throw 하지 않는다** — 기록 실패는 warn 로그만 남기고 삼킨다(fail-open).
 *
 * - audit_logs.user_id 는 users FK — 게스트('guest')·빈값은 user_id 없이 넣는다. 이때 details.actorId 는
 *   'anonymous' 하나로 통일한다(#1476, 새 기록부터 — 과거 'guest' 기록은 바꾸지 않는다). 실제 사용자 id 는 그대로.
 *   tool-contract/tool-execution-guard 의 auditToolCall 도 같은 securityAuditActor 를 쓴다.
 * - details 상한(config/security-audit): 문자열·키·배열 원소 수·중첩 깊이, 순환은 고정 표식으로 끊는다.
 * - AuditService 는 동적 import — security 모듈이 서비스 계층을 정적으로 끌어오지 않게 한다(순환 의존 방지).
 *
 * @module security/security-audit
 */
import type { Request } from 'express';
import { createLogger } from '../utils/logger';
import { capText } from '../utils/redact';
import { SECURITY_AUDIT_DETAIL_LIMITS as LIMITS } from '../config/security-audit';

const logger = createLogger('SecurityAudit');

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

/** 감사 actor — 실제 사용자 id 만 user_id(users FK)로 싣고, 손님('guest')·없음·빈 문자열은 user_id 없이 'anonymous'. */
export function securityAuditActor(userId: string | number | null | undefined): { userId: string | undefined; actorId: string } {
    const raw = userId !== undefined && userId !== null ? String(userId) : '';
    return raw !== '' && raw !== 'guest' ? { userId: raw, actorId: raw } : { userId: undefined, actorId: 'anonymous' };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    if (v === null || typeof v !== 'object') return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
}

/** 객체 한 단계 — undefined 값 제거, 키 상한 초과분은 버린다(앞에서부터), 값은 boundValue 로. */
function boundObject(o: Record<string, unknown>, depth: number, ancestors: object[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
        if (v === undefined) continue;
        if (Object.keys(out).length >= LIMITS.MAX_KEYS) break;
        out[k] = boundValue(v, depth + 1, ancestors);
    }
    return out;
}

/**
 * 값 하나 — 문자열은 길이 캡, 일반 객체·배열은 깊이·순환을 확인해 재귀(배열은 앞에서부터 원소 상한).
 * 순환·깊이 초과 자리는 고정 표식만 남긴다(원문을 문자열로 바꾸지 않는다). Date 등 그 밖의 값은 종전처럼 그대로.
 */
function boundValue(v: unknown, depth: number, ancestors: object[]): unknown {
    if (typeof v === 'string') return capText(v, LIMITS.TEXT_MAX_CHARS);
    const isArray = Array.isArray(v);
    if (!isArray && !isPlainObject(v)) return v;
    if (ancestors.includes(v as object)) return LIMITS.CIRCULAR_MARKER;
    if (depth > LIMITS.MAX_DEPTH) return LIMITS.DEPTH_MARKER;
    ancestors.push(v as object);
    try {
        return isArray
            ? (v as unknown[]).slice(0, LIMITS.MAX_ARRAY_ITEMS).map((item) => boundValue(item, depth + 1, ancestors))
            : boundObject(v as Record<string, unknown>, depth, ancestors);
    } finally {
        ancestors.pop();
    }
}

/**
 * PURE: undefined 값 제거, 문자열 값은 길이 캡, 키 20개 초과분은 버린다(앞에서부터 20개).
 * 중첩 객체·배열에도 같은 상한, 배열은 앞 20개, 깊이 3(details 자신 = 1)을 넘거나 순환이면 표식으로 끊는다. 입력은 바꾸지 않는다.
 */
export function securityAuditDetails(d: Record<string, unknown>): Record<string, unknown> {
    return boundObject(d, 1, [d]);
}

/** 보안 사건 한 건을 감사 기록으로 남긴다. 실패는 로그만 남기고 삼킨다 — 절대 throw 하지 않는다. */
export async function auditSecurityEvent(input: SecurityAuditInput): Promise<void> {
    try {
        const actor = securityAuditActor(input.userId);
        // actorId 는 캡 뒤에 얹는다 — 호출부 details 가 덮어쓰거나 키 상한에 밀려 빠지지 않게.
        const details = { ...securityAuditDetails(input.details ?? {}), actorId: actor.actorId };
        const { getAuditService } = await import('../services/AuditService');
        await getAuditService().logAudit({
            action: input.action,
            userId: actor.userId,
            resourceType: input.resourceType,
            resourceId: input.resourceId !== undefined ? capText(input.resourceId, LIMITS.TEXT_MAX_CHARS) : undefined,
            details,
            ipAddress: input.ipAddress,
            userAgent: input.userAgent,
        });
    } catch (e) {
        logger.warn(`보안 감사 기록 실패(${input.action}): ${e instanceof Error ? e.message : String(e)}`);
    }
}

/**
 * 미들웨어가 AppError 를 거치지 않고 직접 응답하는 거부(requireAdmin·API key 스코프·CSRF·비활성 계정, #1475)를
 * security.authz_denied 로 남긴다 — fire-and-forget, 응답 코드·본문에 영향 없음. 자원은 `METHOD 경로`(쿼리 제외),
 * details 는 고정 사유·상태와 호출부가 준 식별자만 — 헤더·본문·토큰·키 값은 넣지 않는다.
 * userId 는 요청에 붙은 사용자가 기본이고, 아직 붙기 전(인증 미들웨어 안)이면 호출부가 넘긴다.
 */
export function auditHttpDenied(
    req: Request,
    reason: string,
    opts: { status?: number; userId?: string | number | null; details?: Record<string, unknown> } = {},
): void {
    void auditSecurityEvent({
        action: 'security.authz_denied',
        userId: opts.userId ?? req.user?.id,
        resourceType: 'http',
        resourceId: `${req.method} ${req.baseUrl ?? ''}${req.path ?? ''}`,
        details: { reason, status: opts.status ?? 403, ...opts.details },
        ipAddress: req.ip,
        userAgent: req.headers?.['user-agent'],
    }).catch(() => undefined);
}

/** SSRF 가드(security/ssrf-guard)가 던진 차단 오류인지 — 오류 문구 접두로 판별한다. */
export function isSsrfBlockedError(e: unknown): boolean {
    return e instanceof Error && e.message.startsWith('SSRF blocked');
}
