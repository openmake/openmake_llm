/**
 * 유효 정책 해석 (F22 Phase C-1) — 글로벌(system_settings/env) ⊕ 활성 조직 정책.
 *
 * 병합 규칙은 config/org-policy-registry.ts 머리말. 조직 정책 조회는 org 단위 60초 캐시(fail-open:
 * 실패 시 글로벌만). 소비처: provider-gate(외부 모델), agent-task execute(승인 하한), mcp from-catalog(허용 서버).
 *
 * @module services/org/effective-policy
 */
import { createLogger } from '../../utils/logger';
import { getConfig } from '../../config/env';
import { resolveExternalModelPolicy, type ExternalModelPolicy } from '../../config/external-model-policy';
import { APPROVAL_POLICY_STRICTNESS, ORG_POLICY_KEYS, ORG_POLICY_SCHEMAS, type OrgPolicyKey } from '../../config/org-policy-registry';
import { ORG_CONTEXT } from '../../config/runtime-limits';
import type { TaskSandboxApprovalPolicy } from '../../config/task-sandbox';
import { activeOrgFor } from './membership-cache';

const logger = createLogger('EffectivePolicy');

export interface OrgPolicySet {
    externalModel?: ExternalModelPolicy;
    approvalPolicyMin?: TaskSandboxApprovalPolicy;
    mcpAllowedServers?: string[];
    addonAllowlist?: string[];
}

export interface EffectivePolicy {
    externalModel: ExternalModelPolicy;
    /** undefined = 하한 없음 */
    approvalPolicyMin?: TaskSandboxApprovalPolicy;
    /** undefined = 제한 없음 */
    mcpAllowedServers?: string[];
    /** undefined = 제한 없음(전 add-on 사용 가능). 값이 있으면 그 목록만 사용권이 있다. */
    addonAllowlist?: string[];
    orgId: string | null;
}

/** PURE: 저장 행 → 검증된 조직 정책 집합(잘못된 값은 무시). */
export function parseOrgPolicyRows(rows: Array<{ key: string; value: unknown }>): OrgPolicySet {
    const out: OrgPolicySet = {};
    for (const row of rows) {
        const schema = ORG_POLICY_SCHEMAS[row.key as OrgPolicyKey];
        if (!schema) continue;
        const parsed = schema.safeParse(row.value);
        if (!parsed.success) continue;
        if (row.key === ORG_POLICY_KEYS.EXTERNAL_MODEL_POLICY) {
            const v = parsed.data as { allow?: string[]; deny?: string[] };
            out.externalModel = { allow: v.allow ?? [], deny: v.deny ?? [] };
        } else if (row.key === ORG_POLICY_KEYS.TOOL_APPROVAL_POLICY_MIN) {
            out.approvalPolicyMin = parsed.data as TaskSandboxApprovalPolicy;
        } else if (row.key === ORG_POLICY_KEYS.MCP_ALLOWED_SERVERS) {
            const list = parsed.data as string[];
            if (list.length > 0) out.mcpAllowedServers = list;
        } else if (row.key === ORG_POLICY_KEYS.ADDON_ALLOWLIST) {
            const list = parsed.data as string[];
            if (list.length > 0) out.addonAllowlist = list;
        }
    }
    return out;
}

/** PURE: deny 는 합집합, allow 는 둘 다 있으면 교집합·한쪽만 있으면 그쪽. */
export function mergeExternalModelPolicy(global: ExternalModelPolicy, org?: ExternalModelPolicy): ExternalModelPolicy {
    if (!org) return global;
    const deny = Array.from(new Set([...global.deny, ...org.deny]));
    let allow: string[];
    if (global.allow.length > 0 && org.allow.length > 0) {
        const g = new Set(global.allow.map((x) => x.toLowerCase()));
        allow = org.allow.filter((x) => g.has(x.toLowerCase()));
        // 교집합이 비면 "아무것도 허용 안 함" 이 돼야 한다 — 빈 allow 는 전부 허용이므로 불가능 패턴으로 대체
        if (allow.length === 0) allow = ['__none__'];
    } else {
        allow = global.allow.length > 0 ? global.allow : org.allow;
    }
    return { allow, deny };
}

/** PURE: 요청 승인 정책과 조직 하한 중 더 엄격한 쪽. */
export function strictestApprovalPolicy(
    requested: TaskSandboxApprovalPolicy | undefined,
    min: TaskSandboxApprovalPolicy | undefined,
): TaskSandboxApprovalPolicy | undefined {
    if (!min) return requested;
    if (!requested) return min;
    return APPROVAL_POLICY_STRICTNESS[requested] >= APPROVAL_POLICY_STRICTNESS[min] ? requested : min;
}

interface Entry { at: number; value: OrgPolicySet }
const orgPolicyCache = new Map<string, Entry>();

async function orgPolicySetFor(orgId: string, now: number): Promise<OrgPolicySet> {
    const hit = orgPolicyCache.get(orgId);
    if (hit && now - hit.at < ORG_CONTEXT.CACHE_TTL_MS) return hit.value;
    try {
        const { OrganizationPolicyRepository } = await import('../../data/repositories/organization-policy-repository');
        const { getPool } = await import('../../data/models/unified-database');
        const rows = await new OrganizationPolicyRepository(getPool()).list(orgId);
        const value = parseOrgPolicyRows(rows);
        orgPolicyCache.set(orgId, { at: now, value });
        return value;
    } catch (e) {
        logger.warn('조직 정책 조회 실패 (fail-open: 글로벌만 적용):', e);
        return {};
    }
}

/** 정책 변경 직후 무효화. orgId 생략 시 전체. */
export function clearOrgPolicyCache(orgId?: string): void {
    if (orgId === undefined) orgPolicyCache.clear(); else orgPolicyCache.delete(orgId);
}

/** 요청 사용자의 유효 정책 — 활성 조직이 없으면 글로벌 그대로. */
export async function resolveEffectivePolicy(userId: string | undefined, now: number = Date.now()): Promise<EffectivePolicy> {
    const global = resolveExternalModelPolicy(getConfig().externalModelPolicy);
    const org = await activeOrgFor(userId, now);
    if (!org) return { externalModel: global, orgId: null };
    const set = await orgPolicySetFor(org.orgId, now);
    return {
        externalModel: mergeExternalModelPolicy(global, set.externalModel),
        approvalPolicyMin: set.approvalPolicyMin,
        mcpAllowedServers: set.mcpAllowedServers,
        addonAllowlist: set.addonAllowlist,
        orgId: org.orgId,
    };
}
