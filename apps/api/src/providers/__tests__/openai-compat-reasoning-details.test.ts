/**
 * openai-compat 경로 reasoning_details 보존(#1657) — OpenRouter 가 스트림 delta 에 실어 준 추론 블록을 이어 붙여 결과에 남기고,
 * 다음 요청의 assistant 메시지에 그대로 되돌린다. 값은 불투명. 응답에 없으면 키도 없다. 되돌리는 것은 대상이 openrouter 일 때뿐이다.
 */
import { OpenAICompatProvider } from '../openai-compat-provider';
import { toOpenAIMessages } from '../openai-compat-mapping';
import { ToolNameCodec } from '../tool-name-codec';
import type { ChatMessage } from '../../llm';

const D1 = { type: 'reasoning.text', text: '먼저 ', id: 'r1', format: 'anthropic-claude-v1', index: 0 };
const ENC = { type: 'reasoning.encrypted', id: 'enc', format: 'openai-responses-v1', data: 'b3BhcXVl', index: 1 };

describe('openai-compat 매핑 — assistant.reasoning_details 재전송', () => {
    it('openrouter 면 도구 호출 assistant 와 본문만 있는 assistant 모두에 그대로 싣는다', () => {
        const out = toOpenAIMessages([
            { role: 'assistant', content: '', reasoning_details: [ENC], tool_calls: [{ type: 'function', id: 'call_a', function: { name: 'bash', arguments: {} } }] },
            { role: 'tool', content: 'ok', tool_call_id: 'call_a' },
            { role: 'assistant', content: '답', reasoning_details: [D1] },
        ] as ChatMessage[], { codec: new ToolNameCodec(), providerId: 'openrouter' });
        expect(out[0].reasoning_details).toEqual([ENC]);
        expect(out[2].reasoning_details).toEqual([D1]);
    });

    it('다른 공급자(gemini·hasa)나 공급자 미지정이면 값이 있어도 싣지 않는다', () => {
        const msgs = [{ role: 'assistant', content: '답', reasoning_details: [D1] }] as ChatMessage[];
        for (const providerId of ['gemini', 'hasa', undefined]) {
            expect(toOpenAIMessages(msgs, { codec: new ToolNameCodec(), providerId })[0]).not.toHaveProperty('reasoning_details');
        }
    });

    it('streamChat 은 자기 공급자 id 로 정한다 — openrouter 만 보내고 gemini 는 보내지 않는다', async () => {
        const history = [{ role: 'user', content: '안녕' }, { role: 'assistant', content: '답', reasoning_details: [ENC] }, { role: 'user', content: '또' }] as ChatMessage[];
        const sent = async (providerId: string) => {
            const provider = new OpenAICompatProvider({ providerId, apiKey: 'test', baseUrl: 'https://example.invalid/v1' });
            const create = jest.fn(async (_body: { messages: Array<Record<string, unknown>> }) => { async function* gen() { yield { choices: [{ delta: { content: 'ok' } }] }; } return gen(); });
            (provider as unknown as { client: { chat: { completions: { create: jest.Mock } } } }).client = { chat: { completions: { create } } };
            await provider.streamChat({ messages: history, modelId: 'm' }, {});
            return (create.mock.calls[0][0] as { messages: Array<Record<string, unknown>> }).messages[1];
        };
        expect((await sent('openrouter')).reasoning_details).toEqual([ENC]);
        expect(await sent('gemini')).not.toHaveProperty('reasoning_details');
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
