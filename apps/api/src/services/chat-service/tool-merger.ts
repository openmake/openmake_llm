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
 * 설치한 user MCP 서버 도구의 "설치=기본 ON" 자동 노출 목록 선정.
 *
 * - userPoolNames: 사용자 풀(설치 서버) 도구의 네임스페이스 이름 집합
 * - enabledTools[name]===false 면 제외(명시 차단), 그 외 user 풀 도구는 기본 노출
 * - tool-bloat(로컬 qwen 첫토큰 hang) 방지로 cap 개까지만 — 초과분 drop + 로그
 */
export function selectUserMcpAutoOn(
    allTools: ToolDefinition[],
    userPoolNames: Set<string>,
    enabledTools: Record<string, boolean>,
    cap: number,
): ToolDefinition[] {
    const eligible = allTools.filter(t =>
        userPoolNames.has(t.function.name) && enabledTools[t.function.name] !== false);
    const capped = eligible.slice(0, cap);
    if (eligible.length > capped.length) {
        logger.warn(
            `user MCP 자동 노출 cap 적용: ${eligible.length}개 중 ${capped.length}개만 노출 ` +
            `(cap=${cap}). 도구가 많으면 /mcp-servers 에서 일부 서버를 disable 하세요.`,
        );
    }
    return capped;
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
