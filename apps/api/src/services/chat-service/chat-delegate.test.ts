import { CHAT_DELEGATE_TOOL_NAME, buildChatDelegateTool, buildSubagentTools } from './chat-delegate';
import type { ToolDefinition } from '../../llm/types';

function tool(name: string): ToolDefinition {
    return { type: 'function', function: { name, description: '', parameters: { type: 'object', properties: {} } } };
}

describe('chat-delegate', () => {
    it('도구 정의 — 이름·필수 파라미터', () => {
        const d = buildChatDelegateTool();
        expect(d.function.name).toBe(CHAT_DELEGATE_TOOL_NAME);
        expect(d.function.parameters.required).toContain('subgoal');
        // 남용 억제 문구 포함(단순 질문 금지)
        expect(d.function.description).toMatch(/직접 답하세요/);
    });

    it('서브 도구 = 부모 활성 도구에서 자기 자신만 제외 (권한 증분 0)', () => {
        const chatTools = [tool('web_search'), tool(CHAT_DELEGATE_TOOL_NAME), tool('generate_image')];
        const sub = buildSubagentTools(chatTools);
        expect(sub.map((t) => t.function.name)).toEqual(['web_search', 'generate_image']);
    });
});
