/**
 * manifest 스킬 주입 필터 (순수) — skill-manager.buildManifestPrompt 가 사용.
 *
 * 규칙 (2026-08-29 정정):
 *   - triggers 를 선언한 스킬은 질의가 트리거에 맞을 때만 (종전 동작)
 *   - **에이전트에 명시 배정**(assigned_to = 이 agentId) 또는 **개인 배정**(user:<id>) 스킬은
 *     카테고리와 무관하게 주입 — 배정 자체가 의도다. 종전엔 `__global__` 용 카테고리 필터가
 *     명시 배정까지 걸러 user 3 의 ecc 스킬 14건이 배정돼 있어도 한 번도 주입되지 않았다
 *     (skill_audit_log 첫 기록에서 inject 누락으로 드러남)
 *   - `__global__` 배정은 종전대로: manifest category 가 에이전트 category 와 같거나
 *     `user-` 접두 id(개인 manifest)일 때만 — 무관한 스킬의 프롬프트 오염 방지
 *
 * @module agents/manifest-injection-filter
 */
import { matchesSkillTriggers, parseManifestTriggers } from './skill-triggers';

export const GLOBAL_ASSIGNMENT_ID = '__global__';

export interface InjectionCandidate {
    id: string;
    manifestYaml: string;
    /** agent_skill_assignments.agent_id — 이 행이 어느 배정으로 조회됐는지 */
    assignedTo: string;
}

export function manifestCategory(manifestYaml: string): string | undefined {
    const m = /^category:\s*([^\n]+)/m.exec(manifestYaml);
    return m?.[1]?.trim().replace(/^['"]|['"]$/g, '') || undefined;
}

export function shouldInjectManifestSkill(
    c: InjectionCandidate,
    ctx: { agentId: string; agentCategory?: string; query?: string },
): boolean {
    if (!matchesSkillTriggers(parseManifestTriggers(c.manifestYaml), ctx.query)) return false;
    if (c.assignedTo !== GLOBAL_ASSIGNMENT_ID) return true;   // 명시 배정(에이전트/개인)은 카테고리 무관
    if (!ctx.agentCategory) return true;
    if (c.id.startsWith('user-')) return true;
    const cat = manifestCategory(c.manifestYaml);
    return !cat || cat === ctx.agentCategory;
}
