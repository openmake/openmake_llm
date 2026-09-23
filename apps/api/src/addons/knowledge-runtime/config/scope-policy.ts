/**
 * Space 접근 권한 — scope 종류별 규칙 표. 서비스 코드는 scope 종류로 분기하지 않고 이 표만 쓴다.
 * 검색·목록·상세 모두 이 술어를 **SQL 조건으로** 넣는다(결과를 가져온 뒤 거르지 않는다).
 *
 * 조직 scope 는 활성 조직(`activeOrgFor`, 멤버십 검증됨)만 본다 — 요청의 조직 ID 를 신뢰하지 않는다.
 *
 * @module addons/knowledge-runtime/config/scope-policy
 */
import type { KnowledgeScopeType } from '@openmake/shared-types';
import { activeOrgFor, type OrgContext } from '../../../services/org/membership-cache';
import { getDefaultLimits } from './profiles';

export interface KnowledgeActor {
    userId: string;
    activeOrg: OrgContext | null;
    orgWriteRoles: readonly string[];
}

interface ScopeRule {
    /** 이 사용자가 이 scope 로 볼 수 있는 scope_id — 없으면 null */
    scopeIdFor(actor: KnowledgeActor): string | null;
    /** 이 scope 의 Space 를 바꿀 수 있는가 */
    canWrite(actor: KnowledgeActor): boolean;
}

export const SCOPE_POLICY: Readonly<Record<KnowledgeScopeType, ScopeRule>> = {
    user: {
        scopeIdFor: (a) => a.userId,
        canWrite: () => true,
    },
    organization: {
        scopeIdFor: (a) => a.activeOrg?.orgId ?? null,
        canWrite: (a) => !!a.activeOrg && a.orgWriteRoles.includes(a.activeOrg.orgRole),
    },
};

export const SCOPE_TYPES = Object.keys(SCOPE_POLICY) as KnowledgeScopeType[];

export async function actorFor(userId: string): Promise<KnowledgeActor> {
    const [activeOrg, limits] = await Promise.all([activeOrgFor(userId), getDefaultLimits()]);
    return { userId, activeOrg, orgWriteRoles: limits.orgWriteRoles ?? [] };
}

/**
 * 접근 가능한 Space 의 SQL 술어 — `(alias.scope_type, alias.scope_id) IN (...)` 와 파라미터.
 * mode='write' 면 쓰기 가능한 scope 만. 접근 가능한 scope 가 없으면 항상 거짓인 술어를 돌려준다.
 * startIndex 는 이어 붙일 파라미터 번호($n)의 시작값이다.
 */
export function accessPredicate(actor: KnowledgeActor, mode: 'read' | 'write', alias: string, startIndex: number): { sql: string; params: string[] } {
    const pairs: string[] = [];
    const params: string[] = [];
    for (const type of SCOPE_TYPES) {
        const rule = SCOPE_POLICY[type];
        const scopeId = rule.scopeIdFor(actor);
        if (!scopeId || (mode === 'write' && !rule.canWrite(actor))) continue;
        params.push(type, scopeId);
        pairs.push(`($${startIndex + params.length - 2}, $${startIndex + params.length - 1})`);
    }
    if (pairs.length === 0) return { sql: 'FALSE', params: [] };
    return { sql: `(${alias}.scope_type, ${alias}.scope_id) IN (${pairs.join(', ')}) AND ${alias}.deleted_at IS NULL AND ${alias}.status = 'active'`, params };
}

/** 새 Space 를 이 scope 로 만들 수 있으면 scope_id, 아니면 null */
export function creatableScopeId(actor: KnowledgeActor, type: KnowledgeScopeType): string | null {
    const rule = SCOPE_POLICY[type];
    return rule && rule.canWrite(actor) ? rule.scopeIdFor(actor) : null;
}
