/**
 * 외부 Tool Calling 경로 — 클라이언트 system 메시지 병합 회귀 테스트.
 *
 * OpenAI 호환 API 의 `convertMessages` 는 클라이언트가 보낸 role='system' 을 그대로
 * history 에 싣는다. 이를 배열에 두면 자체 system(index 0) 뒤 두 번째 system 이 되어
 * 수용 여부가 채팅 템플릿 구현에 달리고, 버리면 호출자의 지시 계약이 사라진다.
 * 맨 앞 system 에 병합(드롭 아님)하는 동작을 고정한다.
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
