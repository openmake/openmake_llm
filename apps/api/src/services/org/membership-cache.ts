/**
 * 조직 멤버십·활성 조직 캐시 (F22 Phase A, 2026-09-17).
 *
 * LLM 호출·권한 판정마다 DB 를 치지 않도록 사용자별 60초 캐시. 종전 `llm/user-quota.ts` 의
 * 예산 조직 캐시를 이곳으로 옮겨 쿼터·권한·조직 스위처가 같은 무효화 지점을 쓴다.
 * 실패는 fail-open(빈 목록 / 활성 조직 없음) — 조직은 선택 구조라 조회 실패가 채팅을 막으면 안 된다.
 *
 * 활성 조직은 `users.preferences.activeOrgId` 가 가리키되 **멤버십이 DB 에 실재할 때만** 인정한다
 * (preferences 값만 믿으면 탈퇴 뒤에도 조직 자원이 보이는 IDOR 가 된다).
 *
 * @module services/org/membership-cache
 */
import { createLogger } from '../../utils/logger';
import type { OrgMembership, OrgRole } from '../../data/repositories/organization-repository';
import { ORG_CONTEXT } from '../../config/runtime-limits';

const logger = createLogger('OrgMembershipCache');

export interface BudgetedOrg { orgId: string; budget: number; memberIds: string[] }
export interface OrgContext { orgId: string; orgRole: OrgRole }

interface Entry<T> { at: number; value: T }
const memberships = new Map<string, Entry<OrgMembership[]>>();
const budgeted = new Map<string, Entry<BudgetedOrg[]>>();
const active = new Map<string, Entry<OrgContext | null>>();

function fresh<T>(e: Entry<T> | undefined, now: number): e is Entry<T> {
    return !!e && now - e.at < ORG_CONTEXT.CACHE_TTL_MS;
}

async function repo() {
    const { OrganizationRepository } = await import('../../data/repositories/organization-repository');
    const { getPool } = await import('../../data/models/unified-database');
    return new OrganizationRepository(getPool());
}

/** 사용자가 속한 조직 목록 (60초 캐시, 실패 시 빈 목록). */
export async function membershipsFor(userId: string, now: number = Date.now()): Promise<OrgMembership[]> {
    const hit = memberships.get(userId);
    if (fresh(hit, now)) return hit.value;
    try {
        const value = await (await repo()).listMembershipsForUser(userId);
        memberships.set(userId, { at: now, value });
        return value;
    } catch (e) {
        logger.warn('조직 멤버십 조회 실패 (fail-open):', e);
        return [];
    }
}

/** 예산이 설정된 조직과 멤버 id — 쿼터 검사 재료 (60초 캐시, 실패 시 빈 목록). */
export async function budgetedOrgsFor(userId: string, now: number = Date.now()): Promise<BudgetedOrg[]> {
    const hit = budgeted.get(userId);
    if (fresh(hit, now)) return hit.value;
    try {
        const value = await (await repo()).listBudgetedOrgsForUser(userId);
        budgeted.set(userId, { at: now, value });
        return value;
    } catch (e) {
        logger.warn('조직 예산 조회 실패 (fail-open):', e);
        return [];
    }
}

/** PURE: preferences.activeOrgId 와 실제 멤버십으로 활성 조직을 결정. 멤버가 아니면 null. */
export function resolveActiveOrg(activeOrgId: unknown, list: OrgMembership[]): OrgContext | null {
    if (typeof activeOrgId !== 'string' || !activeOrgId) return null;
    const m = list.find((x) => x.orgId === activeOrgId);
    return m ? { orgId: m.orgId, orgRole: m.role } : null;
}

/** 요청 사용자의 활성 조직 컨텍스트 (60초 캐시). guest·미인증은 null. */
export async function activeOrgFor(userId: string | undefined, now: number = Date.now()): Promise<OrgContext | null> {
    if (!userId || userId === 'guest') return null;
    const hit = active.get(userId);
    if (fresh(hit, now)) return hit.value;
    try {
        const { UserRepository } = await import('../../data/repositories/user-repository');
        const { getPool } = await import('../../data/models/unified-database');
        const prefs = await new UserRepository(getPool()).getPreferences(userId);
        const value = resolveActiveOrg(prefs.activeOrgId, await membershipsFor(userId, now));
        if (prefs.activeOrgId && !value) logger.info(`activeOrgId 무시(멤버 아님): userId=${userId}`);
        active.set(userId, { at: now, value });
        return value;
    } catch (e) {
        logger.warn('활성 조직 조회 실패 (fail-open):', e);
        return null;
    }
}

/** 멤버십·예산·활성 조직 변경 직후 무효화. userId 생략 시 전체. */
export function clearOrgMembershipCache(userId?: string): void {
    if (userId === undefined) { memberships.clear(); budgeted.clear(); active.clear(); return; }
    memberships.delete(userId); budgeted.delete(userId); active.delete(userId);
}
