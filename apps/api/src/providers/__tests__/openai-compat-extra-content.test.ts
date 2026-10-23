/**
 * openai-compat 경로 tool_calls[i].extra_content 보존 — Gemini 3 thought signature 왕복.
 *
 * 실측(2026-10-23): gemini:gemini-3.6-flash 가 도구를 부른 뒤 2턴째 요청이
 * "Function call is missing a thought_signature in functionCall parts" 400 으로 깨졌다.
 * Google OpenAI 호환 엔드포인트가 준 extra_content 를 어댑터가 버렸기 때문이다. 값은 불투명 — 그대로 되돌린다.
 */
import { OpenAICompatProvider } from '../openai-compat-provider';
import { toOpenAIMessages } from '../openai-compat-mapping';
import { ToolNameCodec } from '../tool-name-codec';
import type { ChatMessage } from '../../llm';

const EXTRA = { google: { thought_signature: 'c2lnbmF0dXJlLW9wYXF1ZQ==' } };

describe('openai-compat 매핑 — assistant.tool_calls[i].extra_content 재전송', () => {
    const history = (extra?: Record<string, unknown>): ChatMessage[] => [
        { role: 'assistant', content: '', tool_calls: [{ type: 'function', id: 'call_g', ...(extra && { extra_content: extra }), function: { name: 'mcp_call', arguments: { tool: 'x' } } }] },
        { role: 'tool', content: 'ok', tool_call_id: 'call_g' },
    ];

    it('extra_content 를 그 tool_call 에 그대로 싣는다', () => {
        const out = toOpenAIMessages(history(EXTRA), { codec: new ToolNameCodec() });
        expect(out[0].tool_calls?.[0]).toEqual({
            id: 'call_g', type: 'function', extra_content: EXTRA,
            function: { name: 'mcp_call', arguments: '{"tool":"x"}' },
        });
    });

    it('extra_content 가 없으면 키가 없다 — 종전 요청 바이트와 같다', () => {
        const out = toOpenAIMessages(history(), { codec: new ToolNameCodec() });
        expect(JSON.stringify(out[0].tool_calls)).toBe('[{"id":"call_g","type":"function","function":{"name":"mcp_call","arguments":"{\\"tool\\":\\"x\\"}"}}]');
    });
});

describe('OpenAICompatProvider.streamChat — 응답 tool_call 의 extra_content 보존', () => {
    function providerWith(chunks: unknown[]) {
        const provider = new OpenAICompatProvider({ providerId: 'gemini', apiKey: 'test', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' });
        const create = jest.fn(async () => {
            async function* gen() { for (const c of chunks) yield c; }
            return gen();
        });
        (provider as unknown as { client: { chat: { completions: { create: jest.Mock } } } }).client = { chat: { completions: { create } } };
        return provider;
    }
    const run = (provider: OpenAICompatProvider, onToolCall?: jest.Mock) =>
        provider.streamChat({ messages: [{ role: 'user', content: '도구 써' }], modelId: 'gemini-3.6-flash' }, onToolCall ? { onToolCall } : {});

    it('첫 청크의 extra_content 를 toolCalls·onToolCall 에 그대로 싣는다', async () => {
        const provider = providerWith([
            { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_g', type: 'function', extra_content: EXTRA, function: { name: 'mcp_call', arguments: '{"tool":"x"}' } }] } }] },
            { choices: [{ delta: {} }], usage: { prompt_tokens: 3, completion_tokens: 2 } },
        ]);
        const onToolCall = jest.fn();
        const result = await run(provider, onToolCall);
        expect(result.toolCalls).toEqual([{ id: 'call_g', name: 'mcp_call', args: { tool: 'x' }, extra_content: EXTRA }]);
        expect(onToolCall).toHaveBeenCalledWith(expect.objectContaining({ extra_content: EXTRA }));
    });

    it('extra_content 가 없으면 키가 없다', async () => {
        const provider = providerWith([
            { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'bash', arguments: '{}' } }] } }] },
        ]);
        const result = await run(provider);
        expect(result.toolCalls?.[0]).not.toHaveProperty('extra_content');
    });
});
