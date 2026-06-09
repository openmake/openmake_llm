/**
 * Skill tool_bindings ∪ profile.requiredTools ∪ userToggled 머지.
 *
 * 머지 시맨틱 (P5-D6 확정):
 *   final = (profileRequired ∪ skill.required ∪ userToggled ∪ skill.allowed) \ skill.denied
 *   단 required 는 denied 가 있어도 살아남음 (강제 의도 우선).
 *
 */
import type { ToolDefinition } from '../../llm/types';

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
