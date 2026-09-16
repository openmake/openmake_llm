/**
 * 리소스 권한 판정 단일 진입점 (F22 Phase A-2, 2026-09-17).
 *
 * 판정 순서: 시스템 admin → 소유자 → 조직 역할(리소스 org_id = 요청자 활성 조직) → 인스턴스 공유.
 * 규칙표는 config/resource-policy.ts, 조직 컨텍스트는 services/org/membership-cache.activeOrgFor 가 만든다.
 * `auth/ownership.assertResourceOwnerOrAdmin` 은 이 함수의 얇은 래퍼(kind 'generic' — 소유자·관리자만)라
 * 기존 호출부 동작은 그대로다.
 *
 * ⚠️ 빈 id 끼리의 동등 비교('undefined' === 'undefined')로 통과하지 않도록 양쪽 모두 실값일 때만 소유자로 본다
 * (2026-09-02 보안 리뷰 L4).
 *
 * @module security/authorize
 */
import { AuthorizationError } from '../utils/error-handler';
import { policyFor, type AccessSubject, type ResourceAction, type ResourceKind } from '../config/resource-policy';
import type { OrgRole } from '../data/repositories/organization-repository';

export interface ResourceRef {
    /** 소유자 user_id (없는 시스템 자원은 null/undefined) */
    ownerId: string | null | undefined;
    /** 조직 공유 대상 org_id (NULL = 개인) */
    orgId?: string | null;
    /** 인스턴스 공유 축(080): 'shared' 면 인증 사용자 전원 읽기 */
    visibility?: string | null;
}

export interface AccessContext {
    userId: string | null | undefined;
    role: string | null | undefined;
    /** 요청자의 활성 조직 (membership-cache.activeOrgFor) */
    orgId?: string | null;
    orgRole?: OrgRole | null;
}

const EMPTY_ID_STRINGS = new Set(['', 'undefined', 'null']);
function isEmptyId(id: unknown): boolean {
    return id === null || id === undefined || EMPTY_ID_STRINGS.has(String(id).trim());
}

const ORG_ROLE_SUBJECT: Record<OrgRole, AccessSubject> = {
    owner: 'org_owner',
    admin: 'org_admin',
    member: 'org_member',
};

/** PURE: 요청자가 리소스에 대해 갖는 주체 집합. */
export function subjectsOf(resource: ResourceRef, ctx: AccessContext): Set<AccessSubject> {
    const s = new Set<AccessSubject>();
    if (ctx.role === 'admin') s.add('admin');
    if (!isEmptyId(resource.ownerId) && !isEmptyId(ctx.userId) && String(resource.ownerId) === String(ctx.userId)) s.add('owner');
    if (resource.orgId && ctx.orgId && ctx.orgRole && resource.orgId === ctx.orgId) s.add(ORG_ROLE_SUBJECT[ctx.orgRole]);
    if (resource.visibility === 'shared') s.add('shared');
    return s;
}

/** PURE: 접근 가능 여부. */
export function canAccess(kind: ResourceKind, action: ResourceAction, resource: ResourceRef, ctx: AccessContext): boolean {
    const allowed = policyFor(kind)[action];
    const subjects = subjectsOf(resource, ctx);
    return allowed.some((a) => subjects.has(a));
}

/** 접근 불가면 AuthorizationError(403). */
export function assertCanAccess(kind: ResourceKind, action: ResourceAction, resource: ResourceRef, ctx: AccessContext): void {
    if (!canAccess(kind, action, resource, ctx)) throw new AuthorizationError('접근 권한이 없습니다');
}
