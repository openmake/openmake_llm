/**
 * OpenAICompatService.test.ts
 * OpenAI 호환 API 서비스 정적 메서드 단위 테스트
 */

jest.mock('../chat/profile-resolver', () => ({
    listAvailableModels: jest.fn(() => [
        { id: 'llama3.2', name: 'LLaMA 3.2' },
        { id: 'gemma3', name: 'Gemma 3' }
    ])
}));

import { OpenAICompatService } from '../services/OpenAICompatService';

describe('OpenAICompatService.generateCompletionId', () => {
    test('chatcmpl- 접두사로 시작하는 ID 생성', () => {
        const id = OpenAICompatService.generateCompletionId();
        expect(id).toMatch(/^chatcmpl-[a-f0-9]{24}$/);
    });

    test('호출마다 고유한 ID 생성', () => {
        const id1 = OpenAICompatService.generateCompletionId();
        const id2 = OpenAICompatService.generateCompletionId();
        expect(id1).not.toBe(id2);
    });
});

describe('OpenAICompatService.convertMessages', () => {
    test('빈 배열이면 빈 message와 history 반환', () => {
        const result = OpenAICompatService.convertMessages([]);
        expect(result.message).toBe('');
        expect(result.history).toEqual([]);
    });

    test('마지막 user 메시지를 message로, 이전 메시지를 history로 추출', () => {
        const messages = [
            { role: 'system' as const, content: '시스템 프롬프트' },
            { role: 'user' as const, content: '첫 번째 질문' },
            { role: 'assistant' as const, content: '첫 번째 답변' },
            { role: 'user' as const, content: '두 번째 질문' }
        ];

        const result = OpenAICompatService.convertMessages(messages);
        expect(result.message).toBe('두 번째 질문');
        expect(result.history).toHaveLength(3);
        expect(result.history[0].role).toBe('system');
    });

    test('content가 null이면 빈 문자열로 처리', () => {
        const messages = [
            { role: 'user' as const, content: null }
        ];

        const result = OpenAICompatService.convertMessages(messages);
        expect(result.message).toBe('');
    });

    test('user 메시지가 없으면 마지막 메시지를 message로 사용', () => {
        const messages = [
            { role: 'system' as const, content: '시스템 프롬프트' },
            { role: 'assistant' as const, content: '어시스턴트 메시지' }
        ];

        const result = OpenAICompatService.convertMessages(messages);
        expect(result.message).toBe('어시스턴트 메시지');
        expect(result.history).toHaveLength(1);
    });
});

describe('OpenAICompatService.buildResponse', () => {
    test('올바른 응답 구조 반환', () => {
        const response = OpenAICompatService.buildResponse({
            id: 'chatcmpl-test',
            model: 'llama3.2',
            content: '안녕하세요',
            finishReason: 'stop',
            promptTokens: 10,
            completionTokens: 5
        });

        expect(response.id).toBe('chatcmpl-test');
        expect(response.object).toBe('chat.completion');
        expect(response.model).toBe('llama3.2');
        expect(response.choices[0].message.content).toBe('안녕하세요');
        expect(response.choices[0].finish_reason).toBe('stop');
        expect(response.usage.total_tokens).toBe(15);
    });

    test('tool_calls가 있으면 포함', () => {
        const toolCalls = [{
            id: 'call_1',
            type: 'function' as const,
            function: { name: 'search', arguments: '{}' }
        }];

        const response = OpenAICompatService.buildResponse({
            id: 'chatcmpl-tool',
            model: 'llama3.2',
            content: '',
            finishReason: 'tool_calls',
            promptTokens: 5,
            completionTokens: 0,
            toolCalls
        });

        expect(response.choices[0].message.tool_calls).toEqual(toolCalls);
    });

    test('tool_calls 빈 배열이면 포함 안 함', () => {
        const response = OpenAICompatService.buildResponse({
            id: 'chatcmpl-notool',
            model: 'llama3.2',
            content: '답변',
            finishReason: 'stop',
            promptTokens: 3,
            completionTokens: 2,
            toolCalls: []
        });

        expect(response.choices[0].message.tool_calls).toBeUndefined();
    });
});

describe('OpenAICompatService.buildStreamChunk', () => {
    test('스트림 청크 구조 반환', () => {
        const chunk = OpenAICompatService.buildStreamChunk({
            id: 'chatcmpl-stream',
            model: 'gemma3',
            delta: { content: '안' },
            finishReason: null
        });

        expect(chunk.object).toBe('chat.completion.chunk');
        expect(chunk.choices[0].delta.content).toBe('안');
        expect(chunk.choices[0].finish_reason).toBeNull();
    });
});

describe('OpenAICompatService.buildDoneEvent', () => {
    test('[DONE] 이벤트 반환', () => {
        expect(OpenAICompatService.buildDoneEvent()).toBe('data: [DONE]\n\n');
    });
});

describe('OpenAICompatService.estimateTokens', () => {
    test('빈 문자열 → 0', () => {
        expect(OpenAICompatService.estimateTokens('')).toBe(0);
        expect(OpenAICompatService.estimateTokens('   ')).toBe(0);
    });

    test('단어 수 기반 토큰 추정 (×1.3 올림)', () => {
        // 10단어 → Math.ceil(10 * 1.3) = 13
        const text = 'one two three four five six seven eight nine ten';
        expect(OpenAICompatService.estimateTokens(text)).toBe(13);
    });

    test('단일 단어 → Math.ceil(1 * 1.3) = 2', () => {
        expect(OpenAICompatService.estimateTokens('hello')).toBe(2);
    });
});

describe('OpenAICompatService.listModels', () => {
    test('모델 목록 반환', () => {
        const result = OpenAICompatService.listModels();
        expect(result.object).toBe('list');
        expect(Array.isArray(result.data)).toBe(true);
        expect(result.data.length).toBe(2);
        expect(result.data[0].id).toBe('llama3.2');
        expect(result.data[0].object).toBe('model');
        expect(result.data[0].owned_by).toBe('openmake');
    });
});
