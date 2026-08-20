/**
 * 외부 Tool Calling 경로 — 클라이언트 system 메시지 병합 회귀 테스트.
 *
 * history 에 role='system' 이 섞여 오면 자체 system(index 0) 뒤에 두 번째 system 이
 * 중간 위치로 들어가 vLLM/qwen 템플릿이 400 "System message must be at the beginning"
 * 으로 거부했다. 병합(드롭 아님)으로 고친 동작을 고정한다.
 */

import { processExternalToolCalling } from '../external-tool-calling';
import type { ChatMessage, LLMClient, ToolDefinition } from '../../llm';

const TOOLS: ToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'noop',
            description: 'test tool',
            parameters: { type: 'object', properties: {} },
        },
    },
];

function createClient(capture: { messages?: ChatMessage[] }): LLMClient {
    return {
        chat: jest.fn(async (messages: ChatMessage[]) => {
            capture.messages = messages;
            return { content: 'ok' };
        }),
    } as unknown as LLMClient;
}

describe('processExternalToolCalling — system 메시지 위치', () => {
    it('history 의 system 을 맨 앞 system 에 병합하고 배열에는 남기지 않는다', async () => {
        const capture: { messages?: ChatMessage[] } = {};

        await processExternalToolCalling({
            message: 'hello',
            history: [
                { role: 'system', content: 'CLIENT_SYSTEM_INSTRUCTION' },
                { role: 'user', content: 'prev question' },
                { role: 'assistant', content: 'prev answer' },
            ],
            tools: TOOLS,
            client: createClient(capture),
            onToken: () => { /* noop */ },
        });

        const messages = capture.messages!;
        const systemMessages = messages.filter((m) => m.role === 'system');

        expect(systemMessages).toHaveLength(1);
        expect(messages[0].role).toBe('system');
        expect(messages[0].content).toContain('CLIENT_SYSTEM_INSTRUCTION');
        expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    });

    it('history 에 system 이 없으면 배열 구성이 그대로다', async () => {
        const capture: { messages?: ChatMessage[] } = {};

        await processExternalToolCalling({
            message: 'hello',
            history: [{ role: 'user', content: 'prev question' }],
            tools: TOOLS,
            client: createClient(capture),
            onToken: () => { /* noop */ },
        });

        expect(capture.messages!.map((m) => m.role)).toEqual(['system', 'user', 'user']);
    });
});
