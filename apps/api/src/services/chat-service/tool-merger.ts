/**
 * Skill tool_bindings ∪ profile.requiredTools ∪ userToggled 머지.
 *
 * 머지 시맨틱 (P5-D6 확정):
 *   final = (profileRequired ∪ skill.required ∪ userToggled ∪ skill.allowed) \ skill.denied
 *   단 required 는 denied 가 있어도 살아남음 (강제 의도 우선).
 *
 */
import type { ToolDefinition } from '../../llm/types';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ToolMerger');

/**
 * 설치한 user MCP 서버 도구의 "설치=기본 ON" 자동 노출 목록 선정 (서버별 round-robin).
 *
 * - toolGroups: 서버별 도구 이름 배열의 배열(네임스페이스 적용)
 * - enabledTools[name]===false 면 제외(명시 차단), 그 외 user 풀 도구는 기본 노출
 * - tool-bloat(로컬 qwen 첫토큰 hang) 방지로 cap 개까지만 노출
 * - round-robin: 각 서버에서 1개씩 돌아가며 채워, 무거운 서버가 cap 슬롯을 독점해
 *   가벼운 서버(예: duckduckgo 2개)가 통째로 잘리는 것을 막는다(각 서버 최소 1개 대표).
 */
export function selectUserMcpAutoOn(
    allTools: ToolDefinition[],
    toolGroups: string[][],
    enabledTools: Record<string, boolean>,
    cap: number,
): ToolDefinition[] {
    const lookup = new Map(allTools.map(t => [t.function.name, t]));
    const groups = toolGroups
        .map(names => names.filter(n => enabledTools[n] !== false))
        .filter(g => g.length > 0);
    const totalEligible = groups.reduce((n, g) => n + g.length, 0);
    const maxLen = groups.reduce((m, g) => Math.max(m, g.length), 0);

    const picked: ToolDefinition[] = [];
    for (let round = 0; round < maxLen && picked.length < cap; round++) {
        for (const g of groups) {
            if (round >= g.length || picked.length >= cap) continue;
            const t = lookup.get(g[round]);
            if (t) picked.push(t);
        }
    }
    if (totalEligible > picked.length) {
        logger.warn(
            `user MCP 자동 노출 cap: ${totalEligible}개 중 ${picked.length}개 노출 ` +
            `(cap=${cap}, 서버별 round-robin — 각 서버 우선 1개). 더 줄이려면 /mcp-servers 서버 disable.`,
        );
    }
    return picked;
}

export interface ActiveSkillBinding {
    skill_id: string;
    skill_version: string;
    tool_name: string;
    binding_mode: 'required' | 'allowed' | 'denied';
}

export interface MergeInput {
    allTools: ToolDefinition[];
    userToggled: ToolDefinition[];
    profileRequired: string[];
    skillBindings: ActiveSkillBinding[];
}

export function mergeToolsWithSkills(input: MergeInput): ToolDefinition[] {
    const lookup = new Map<string, ToolDefinition>();
    for (const t of input.allTools) lookup.set(t.function.name, t);

    const required = new Set<string>(input.profileRequired);
    const allowed = new Set<string>();
    const denied = new Set<string>();
    for (const b of input.skillBindings) {
        if (b.binding_mode === 'required') required.add(b.tool_name);
        else if (b.binding_mode === 'allowed') allowed.add(b.tool_name);
        else if (b.binding_mode === 'denied') denied.add(b.tool_name);
    }

    const result = new Map<string, ToolDefinition>();
    for (const t of input.userToggled) {
        if (!denied.has(t.function.name)) result.set(t.function.name, t);
    }
    for (const name of allowed) {
        if (denied.has(name)) continue;
        const tool = lookup.get(name);
        if (tool) result.set(name, tool);
    }
    // required 는 denied 도 무시
    for (const name of required) {
        const tool = lookup.get(name);
        if (tool) result.set(name, tool);
    }
    return [...result.values()];
}
