import { mergeToolsWithSkills } from '../services/chat-service/tool-merger';
import type { ActiveSkillBinding } from '../services/chat-service/tool-merger';
import type { ToolDefinition } from '../llm/types';

const mkTool = (name: string): ToolDefinition => ({
    type: 'function',
    function: { name, description: name, parameters: { type: 'object', properties: {} } },
});

const allTools = [
    mkTool('web_search'),
    mkTool('fs_read_file'),
    mkTool('deep_research'),
    mkTool('sequential_thinking'),
];

describe('mergeToolsWithSkills', () => {
    test('required 는 사용자 토글 무관 강제 포함', () => {
        const result = mergeToolsWithSkills({
            allTools,
            userToggled: [],
            profileRequired: [],
            skillBindings: [{ skill_id: 's1', skill_version: '1.0.0', tool_name: 'fs_read_file', binding_mode: 'required' }],
        });
        expect(result.map(t => t.function.name)).toContain('fs_read_file');
    });

    test('denied 는 userToggled 에서 제거', () => {
        const result = mergeToolsWithSkills({
            allTools,
            userToggled: [mkTool('web_search')],
            profileRequired: [],
            skillBindings: [{ skill_id: 's1', skill_version: '1.0.0', tool_name: 'web_search', binding_mode: 'denied' }],
        });
        expect(result.map(t => t.function.name)).not.toContain('web_search');
    });

    test('required 가 denied 를 이긴다 (다른 skill 간 충돌)', () => {
        const result = mergeToolsWithSkills({
            allTools,
            userToggled: [],
            profileRequired: [],
            skillBindings: [
                { skill_id: 's1', skill_version: '1.0.0', tool_name: 'web_search', binding_mode: 'required' },
                { skill_id: 's2', skill_version: '1.0.0', tool_name: 'web_search', binding_mode: 'denied' },
            ],
        });
        expect(result.map(t => t.function.name)).toContain('web_search');
    });

    test('allowed 는 userToggled 와 union', () => {
        const result = mergeToolsWithSkills({
            allTools,
            userToggled: [mkTool('sequential_thinking')],
            profileRequired: [],
            skillBindings: [{ skill_id: 's1', skill_version: '1.0.0', tool_name: 'deep_research', binding_mode: 'allowed' }],
        });
        const names = result.map(t => t.function.name);
        expect(names).toContain('sequential_thinking');
        expect(names).toContain('deep_research');
    });

    test('profileRequired 도 합집합', () => {
        const result = mergeToolsWithSkills({
            allTools,
            userToggled: [],
            profileRequired: ['fs_read_file'],
            skillBindings: [],
        });
        expect(result.map(t => t.function.name)).toContain('fs_read_file');
    });

    test('전체 시나리오: profileRequired ∪ required ∪ userToggled ∪ allowed - denied', () => {
        const bindings: ActiveSkillBinding[] = [
            { skill_id: 's1', skill_version: '1.0.0', tool_name: 'deep_research', binding_mode: 'allowed' },
            { skill_id: 's1', skill_version: '1.0.0', tool_name: 'sequential_thinking', binding_mode: 'denied' },
        ];
        const result = mergeToolsWithSkills({
            allTools,
            userToggled: [mkTool('web_search'), mkTool('sequential_thinking')],
            profileRequired: ['fs_read_file'],
            skillBindings: bindings,
        });
        const names = new Set(result.map(t => t.function.name));
        expect(names.has('fs_read_file')).toBe(true);
        expect(names.has('web_search')).toBe(true);
        expect(names.has('deep_research')).toBe(true);
        expect(names.has('sequential_thinking')).toBe(false);
    });
});
