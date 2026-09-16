/**
 * 조직 정책 레지스트리 (F22 Phase C-1, 2026-09-17) — 조직 단위로 둘 수 있는 설정 키의 화이트리스트.
 *
 * 각 키는 값 검증(zod)과 글로벌 값과의 병합 방식을 갖는다. 병합은 조직이 **더 제한**하는 방향으로만
 * 작동한다(조직 정책이 글로벌 차단을 풀 수 없다):
 *   - EXTERNAL_MODEL_POLICY   deny = 글로벌 ∪ 조직, allow = 둘 다 있으면 교집합 · 한쪽만 있으면 그쪽
 *   - TOOL_APPROVAL_POLICY_MIN 에이전트 작업 승인 정책 하한 — 요청값과 하한 중 더 엄격한 쪽
 *   - MCP_ALLOWED_SERVERS     카탈로그 템플릿 id 허용 목록(빈 목록 = 제한 없음) — from-catalog 설치 시 검사
 *
 * @module config/org-policy-registry
 */
import { z } from 'zod';
import type { TaskSandboxApprovalPolicy } from './task-sandbox';

export const ORG_POLICY_KEYS = {
    EXTERNAL_MODEL_POLICY: 'EXTERNAL_MODEL_POLICY',
    TOOL_APPROVAL_POLICY_MIN: 'TOOL_APPROVAL_POLICY_MIN',
    MCP_ALLOWED_SERVERS: 'MCP_ALLOWED_SERVERS',
} as const;
export type OrgPolicyKey = typeof ORG_POLICY_KEYS[keyof typeof ORG_POLICY_KEYS];

const patternList = z.array(z.string().trim().min(1).max(200)).max(200);

export const ORG_POLICY_SCHEMAS: Record<OrgPolicyKey, z.ZodTypeAny> = {
    EXTERNAL_MODEL_POLICY: z.object({ allow: patternList.optional(), deny: patternList.optional() }).strict(),
    TOOL_APPROVAL_POLICY_MIN: z.enum(['none', 'high-risk', 'all']),
    MCP_ALLOWED_SERVERS: z.array(z.string().trim().min(1).max(64)).max(200),
};

export function isOrgPolicyKey(key: string): key is OrgPolicyKey {
    return Object.prototype.hasOwnProperty.call(ORG_POLICY_SCHEMAS, key);
}

/** 승인 정책 엄격도 — 클수록 엄격. 병합은 max. */
export const APPROVAL_POLICY_STRICTNESS: Record<TaskSandboxApprovalPolicy, number> = {
    none: 0,
    'high-risk': 1,
    all: 2,
};
