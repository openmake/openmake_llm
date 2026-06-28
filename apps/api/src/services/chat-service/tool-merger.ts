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

export interface UserPoolToolGroup {
    displayName: string;
    tools: string[];      // 네임스페이스 적용 이름 (displayName::tool)
    shortNames: string[]; // 원본 도구 이름 (의도 매칭용)
}

/**
 * 메시지가 특정 서버를 언급했는지 판정 — displayName(mcp- prefix 무시) 또는 도구 short name
 * 이 메시지에 포함되면 그 서버를 "참조됨"으로 본다. 경량 substring 매칭(regex 철학).
 */
function isServerReferenced(group: UserPoolToolGroup, msg: string): boolean {
    if (!msg) return false;
    const m = msg.toLowerCase();
    const dn = group.displayName.toLowerCase();
    const dnCore = dn.replace(/^mcp[-_]/, ''); // "mcp-memory" → "memory"
    if (dnCore.length >= 3 && m.includes(dnCore)) return true;
    return group.shortNames.some(n => n.length >= 4 && m.includes(n.toLowerCase()));
}

/**
 * 설치한 user MCP 서버 도구의 "설치=기본 ON" 자동 노출 목록 선정.
 *
 * 하이브리드 정책 (tool-bloat hang 방지로 cap 개까지):
 *   1. 의도 인식 depth — 메시지가 언급한 서버는 도구를 전부(cap 한도) 우선 노출.
 *      → "memory MCP 의 search_nodes 로 ..." 같은 다중 도구 워크플로를 살린다.
 *   2. round-robin breadth — 남은 슬롯을 비참조 서버에 1개씩 돌아가며 채워, 무거운 서버가
 *      독점하지 않고 모든 서버가 최소 1개 대표되게 한다.
 * enabledTools[name]===false 는 제외(명시 차단).
 */
export function selectUserMcpAutoOn(
    allTools: ToolDefinition[],
    toolGroups: UserPoolToolGroup[],
    enabledTools: Record<string, boolean>,
    cap: number,
    message = '',
): ToolDefinition[] {
    const lookup = new Map(allTools.map(t => [t.function.name, t]));
    const groups = toolGroups
        .map(g => ({ ...g, tools: g.tools.filter(n => enabledTools[n] !== false) }))
        .filter(g => g.tools.length > 0);
    const totalEligible = groups.reduce((n, g) => n + g.tools.length, 0);

    const picked: ToolDefinition[] = [];
    const seen = new Set<string>();
    const add = (name: string): void => {
        if (picked.length >= cap || seen.has(name)) return;
        const t = lookup.get(name);
        if (t) { picked.push(t); seen.add(name); }
    };

    // 1. depth: 참조된 서버의 도구 전부 우선
    const referenced = groups.filter(g => isServerReferenced(g, message));
    for (const g of referenced) for (const n of g.tools) add(n);

    // 2. breadth: 남은 서버 round-robin (참조 서버는 이미 소진)
    const rest = groups.filter(g => !referenced.includes(g));
    const maxLen = rest.reduce((m, g) => Math.max(m, g.tools.length), 0);
    for (let round = 0; round < maxLen && picked.length < cap; round++) {
        for (const g of rest) if (round < g.tools.length) add(g.tools[round]);
    }

    if (totalEligible > picked.length) {
        const mode = referenced.length ? `의도 depth(${referenced.map(g => g.displayName).join(',')}) + round-robin` : 'round-robin';
        logger.warn(
            `user MCP 자동 노출 cap: ${totalEligible}개 중 ${picked.length}개 노출 (cap=${cap}, ${mode}). ` +
            `더 줄이려면 /mcp-servers 서버 disable.`,
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
