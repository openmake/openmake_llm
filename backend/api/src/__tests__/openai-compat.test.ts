import {
    OpenAICompatService,
    OpenAIMessage,
} from '../services/OpenAICompatService';

describe('OpenAICompatService', () => {
    it('generateCompletionId returns prefixed completion id', () => {
        const id = OpenAICompatService.generateCompletionId();
        expect(id.startsWith('chatcmpl-')).toBe(true);
        expect(id.length).toBeGreaterThan('chatcmpl-'.length);
    });

    it('convertMessages extracts last user message and builds history', () => {
        const messages: OpenAIMessage[] = [
            { role: 'system', content: 'You are helpful' },
            { role: 'user', content: 'First question' },
            { role: 'assistant', content: 'First answer' },
            { role: 'user', content: 'Final question' },
        ];

        const converted = OpenAICompatService.convertMessages(messages);
        expect(converted.message).toBe('Final question');
        expect(converted.history).toHaveLength(3);
        expect(converted.history[0]).toEqual({ role: 'system', content: 'You are helpful' });
        expect(converted.history[2]).toEqual({ role: 'assistant', content: 'First answer' });
    });

    it('convertMessages keeps system messages in history', () => {
        const converted = OpenAICompatService.convertMessages([
            { role: 'system', content: 'System rule' },
            { role: 'user', content: 'Hello' },
        ]);

        expect(converted.history).toEqual([{ role: 'system', content: 'System rule' }]);
    });

    it('convertMessages handles empty messages array', () => {
        const converted = OpenAICompatService.convertMessages([]);
        expect(converted.message).toBe('');
        expect(converted.history).toEqual([]);
    });

    it('buildResponse returns correct base structure', () => {
        const response = OpenAICompatService.buildResponse({
            id: 'chatcmpl-test',
            model: 'openmake_llm',
            content: 'Hello world',
            finishReason: 'stop',
            promptTokens: 10,
            completionTokens: 5,
        });

        expect(response.id).toBe('chatcmpl-test');
        expect(response.object).toBe('chat.completion');
        expect(response.model).toBe('openmake_llm');
        expect(response.choices[0].message.role).toBe('assistant');
        expect(response.choices[0].message.content).toBe('Hello world');
        expect(response.usage.total_tokens).toBe(15);
    });

    it('buildResponse includes tool_calls when provided', () => {
        const toolCalls = [
            {
                id: 'call_1',
                type: 'function' as const,
                function: {
                    name: 'get_weather',
                    arguments: '{"city":"Seoul"}',
                },
            },
        ];

        const response = OpenAICompatService.buildResponse({
            id: 'chatcmpl-test',
            model: 'openmake_llm',
            content: '',
            finishReason: 'tool_calls',
            promptTokens: 12,
            completionTokens: 3,
            toolCalls,
        });

        expect(response.choices[0].message.tool_calls).toEqual(toolCalls);
        expect(response.choices[0].finish_reason).toBe('tool_calls');
    });

    it('buildStreamChunk returns correct chunk structure', () => {
        const chunk = OpenAICompatService.buildStreamChunk({
            id: 'chatcmpl-stream',
            model: 'openmake_llm',
            delta: { content: 'token' },
            finishReason: null,
        });

        expect(chunk.id).toBe('chatcmpl-stream');
        expect(chunk.object).toBe('chat.completion.chunk');
        expect(chunk.choices[0].delta.content).toBe('token');
        expect(chunk.choices[0].finish_reason).toBeNull();
    });

    it('buildDoneEvent returns OpenAI done sentinel', () => {
        expect(OpenAICompatService.buildDoneEvent()).toBe('data: [DONE]\n\n');
    });

    it('estimateTokens returns reasonable estimate', () => {
        const estimated = OpenAICompatService.estimateTokens('hello world from openmake llm');
        expect(estimated).toBeGreaterThan(0);
    });

    it('estimateTokens handles empty string', () => {
        expect(OpenAICompatService.estimateTokens('')).toBe(0);
        expect(OpenAICompatService.estimateTokens('   ')).toBe(0);
    });

    it('listModels returns object list with data array', () => {
        const response = OpenAICompatService.listModels();
        expect(response.object).toBe('list');
        expect(Array.isArray(response.data)).toBe(true);
        expect(response.data.length).toBeGreaterThan(0);
    });

    it('listModels items have id object created owned_by', () => {
        const response = OpenAICompatService.listModels();
        response.data.forEach((model) => {
            expect(typeof model.id).toBe('string');
            expect(model.object).toBe('model');
            expect(typeof model.created).toBe('number');
            expect(model.owned_by).toBe('openmake');
        });
    });

    it('response object validation uses chat.completion', () => {
        const response = OpenAICompatService.buildResponse({
            id: 'chatcmpl-test',
            model: 'openmake_llm',
            content: 'ok',
            finishReason: 'stop',
            promptTokens: 2,
            completionTokens: 2,
        });
        expect(response.object).toBe('chat.completion');
    });

    it('chunk object validation uses chat.completion.chunk', () => {
        const chunk = OpenAICompatService.buildStreamChunk({
            id: 'chatcmpl-stream',
            model: 'openmake_llm',
            delta: { role: 'assistant' },
            finishReason: null,
        });
        expect(chunk.object).toBe('chat.completion.chunk');
    });

    it('token estimation approximates word count times 1.3', () => {
        const text = 'one two three four five';
        const estimated = OpenAICompatService.estimateTokens(text);
        expect(estimated).toBe(Math.ceil(5 * 1.3));
    });

    it('convertMessages handles non-user terminal messages', () => {
        const converted = OpenAICompatService.convertMessages([
            { role: 'system', content: 'Policy' },
            { role: 'assistant', content: 'How can I help?' },
        ]);

        expect(converted.message).toBe('How can I help?');
        expect(converted.history).toEqual([{ role: 'system', content: 'Policy' }]);
    });
});
