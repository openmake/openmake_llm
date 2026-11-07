/**
 * openai-compat 경로 reasoning_details 보존(#1657) — OpenRouter 가 스트림 delta 에 실어 준 추론 블록을 이어 붙여 결과에 남기고,
 * 다음 요청의 assistant 메시지에 그대로 되돌린다. 값은 불투명. 응답에 없으면 키도 없다.
 */
import { OpenAICompatProvider } from '../openai-compat-provider';
import { toOpenAIMessages } from '../openai-compat-mapping';
import { ToolNameCodec } from '../tool-name-codec';
import type { ChatMessage } from '../../llm';

const D1 = { type: 'reasoning.text', text: '먼저 ', id: 'r1', format: 'anthropic-claude-v1', index: 0 };
const ENC = { type: 'reasoning.encrypted', id: 'enc', format: 'openai-responses-v1', data: 'b3BhcXVl', index: 1 };

describe('openai-compat 매핑 — assistant.reasoning_details 재전송', () => {
    it('도구 호출 assistant 와 본문만 있는 assistant 모두에 그대로 싣는다', () => {
        const out = toOpenAIMessages([
            { role: 'assistant', content: '', reasoning_details: [ENC], tool_calls: [{ type: 'function', id: 'call_a', function: { name: 'bash', arguments: {} } }] },
            { role: 'tool', content: 'ok', tool_call_id: 'call_a' },
            { role: 'assistant', content: '답', reasoning_details: [D1] },
        ] as ChatMessage[], { codec: new ToolNameCodec() });
        expect(out[0].reasoning_details).toEqual([ENC]);
        expect(out[2].reasoning_details).toEqual([D1]);
    });

    it('없으면 키가 없다 — 종전 요청 바이트와 같다', () => {
        const out = toOpenAIMessages([
            { role: 'assistant', content: '', tool_calls: [{ type: 'function', id: 'call_a', function: { name: 'bash', arguments: {} } }] },
            { role: 'assistant', content: '답' },
        ], { codec: new ToolNameCodec() });
        expect(JSON.stringify(out)).toBe('[{"role":"assistant","content":"","tool_calls":[{"id":"call_a","type":"function","function":{"name":"bash","arguments":"{}"}}]},{"role":"assistant","content":"답"}]');
    });
});

describe('OpenAICompatProvider.streamChat — delta.reasoning_details 보존', () => {
    function providerWith(chunks: unknown[]) {
        const provider = new OpenAICompatProvider({ providerId: 'openrouter', apiKey: 'test', baseUrl: 'https://openrouter.ai/api/v1' });
        const create = jest.fn(async () => {
            async function* gen() { for (const c of chunks) yield c; }
            return gen();
        });
        (provider as unknown as { client: { chat: { completions: { create: jest.Mock } } } }).client = { chat: { completions: { create } } };
        return provider;
    }
    const run = (provider: OpenAICompatProvider) =>
        provider.streamChat({ messages: [{ role: 'user', content: '도구 써' }], modelId: 'anthropic/claude-sonnet' }, {});

    it('청크마다 온 조각을 받은 순서대로 이어 붙여 reasoningDetails 에 남긴다', async () => {
        const result = await run(providerWith([
            { choices: [{ delta: { reasoning_details: [D1] } }] },
            { choices: [{ delta: { reasoning_details: [ENC], tool_calls: [{ index: 0, id: 'call_a', function: { name: 'bash', arguments: '{}' } }] } }] },
        ]));
        expect(result.reasoningDetails).toEqual([D1, ENC]);
    });

    it('없으면 키가 없다', async () => {
        const result = await run(providerWith([{ choices: [{ delta: { content: '안녕' } }] }]));
        expect(result).not.toHaveProperty('reasoningDetails');
    });
});
