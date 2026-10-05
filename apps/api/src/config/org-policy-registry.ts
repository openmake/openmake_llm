/**
 * 조직 정책 레지스트리 (F22 Phase C-1, 2026-09-17) — 조직 단위로 둘 수 있는 설정 키의 화이트리스트.
 *
 * 각 키는 값 검증(zod)과 글로벌 값과의 병합 방식을 갖는다. 병합은 조직이 **더 제한**하는 방향으로만
 * 작동한다(조직 정책이 글로벌 차단을 풀 수 없다):
 *   - EXTERNAL_MODEL_POLICY   deny = 글로벌 ∪ 조직, allow = 둘 다 있으면 교집합 · 한쪽만 있으면 그쪽
 *   - TOOL_APPROVAL_POLICY_MIN 에이전트 작업 승인 정책 하한 — 요청값과 하한 중 더 엄격한 쪽
 *   - MCP_ALLOWED_SERVERS     카탈로그 템플릿 id 허용 목록(빈 목록 = 제한 없음) — from-catalog 설치 시 검사
 *   - ADDON_ALLOWLIST         이 조직이 쓸 수 있는 add-on id 목록(빈 목록 = 제한 없음) — 조직 관리자의 통제 수단(add-on 은 전부 무료, 과금 아님)
 *   - BROWSER_SITE_POLICY     로컬 브라우저에서 승인 없이 입력을 허용할 사이트 — 병합은 EXTERNAL_MODEL_POLICY 와 같다
 *                             (deny 합집합, allow 는 둘 다 있으면 교집합 · 한쪽만 있으면 그쪽). 빈 allow = 모든 입력이 승인 대상
 *
 * @module config/org-policy-registry
 */
import { z } from 'zod';
import { browserSitePolicyProblems } from '@openmake/config';
import type { TaskSandboxApprovalPolicy } from './task-sandbox';

export const ORG_POLICY_KEYS = {
    EXTERNAL_MODEL_POLICY: 'EXTERNAL_MODEL_POLICY',
    TOOL_APPROVAL_POLICY_MIN: 'TOOL_APPROVAL_POLICY_MIN',
    MCP_ALLOWED_SERVERS: 'MCP_ALLOWED_SERVERS',
    ADDON_ALLOWLIST: 'ADDON_ALLOWLIST',
    BROWSER_SITE_POLICY: 'BROWSER_SITE_POLICY',
} as const;
export type OrgPolicyKey = typeof ORG_POLICY_KEYS[keyof typeof ORG_POLICY_KEYS];

const patternList = z.array(z.string().trim().min(1).max(200)).max(200);

export const ORG_POLICY_SCHEMAS: Record<OrgPolicyKey, z.ZodTypeAny> = {
    EXTERNAL_MODEL_POLICY: z.object({ allow: patternList.optional(), deny: patternList.optional() }).strict(),
    TOOL_APPROVAL_POLICY_MIN: z.enum(['none', 'high-risk', 'all']),
    MCP_ALLOWED_SERVERS: z.array(z.string().trim().min(1).max(64)).max(200),
    ADDON_ALLOWLIST: z.array(z.string().trim().min(1).max(120)).max(200),
    BROWSER_SITE_POLICY: z.object({ allow: patternList.optional(), deny: patternList.optional() }).strict(),
};

/**
 * 저장할 때만 보는 추가 검증 — ORG_POLICY_SCHEMAS 를 통과한 값(parsed.data)의 문제 목록(비면 저장해도 된다).
 * BROWSER_SITE_POLICY 는 전역 시스템 설정과 같은 패턴 검증(browserSitePolicyProblems)을 받는다.
 * 읽기(effective-policy parseOrgPolicyRows)는 스키마만 본다 — 이 검증 전에 저장된 행의 deny 가 조용히 사라지지 않게.
 */
export function orgPolicySaveProblems(key: OrgPolicyKey, value: unknown): string[] {
    if (key === ORG_POLICY_KEYS.BROWSER_SITE_POLICY) return browserSitePolicyProblems(JSON.stringify(value));
    return [];
}

export function isOrgPolicyKey(key: string): key is OrgPolicyKey {
    return Object.prototype.hasOwnProperty.call(ORG_POLICY_SCHEMAS, key);
}

/** 승인 정책 엄격도 — 클수록 엄격. 병합은 max. */
export const APPROVAL_POLICY_STRICTNESS: Record<TaskSandboxApprovalPolicy, number> = {
    none: 0,
    'high-risk': 1,
    all: 2,
};
