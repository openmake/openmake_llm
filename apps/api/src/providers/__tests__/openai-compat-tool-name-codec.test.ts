/**
 * openai-compat 경로 도구 이름 코덱 — `server::tool` 네임스페이스를 provider 경계에서 인코딩/복원.
 *
 * 실측(2026-09-04·06): NVIDIA NIM 이 `Function at index 1 has an invalid name` 으로 요청 전체를
 * 400 거절 → UPSTREAM_ERROR 로 뭉개져 로컬 폴백(사용자가 고른 모델이 조용히 바뀜). 코덱 부재가 원인.
 */
import { OpenAICompatProvider, mapOpenAIError } from '../openai-compat-provider';
import { toOpenAIMessages, toOpenAITools } from '../openai-compat-mapping';
import { OPENAI_TOOL_NAME_PATTERN, ToolNameCodec } from '../tool-name-codec';
import { EXTERNAL_CHAT_FALLBACK } from '../../config/runtime-limits';
import type { ChatMessage, ToolDefinition } from '../../llm';

const tool = (name: string): ToolDefinition => ({
    type: 'function',
    function: { name, description: `desc ${name}`, parameters: { type: 'object', properties: {} } },
});

describe('openai-compat 매핑 — 도구 이름 인코딩', () => {
    it('tools 의 `server::tool`·공백·괄호 이름이 전부 OpenAI 규약을 만족하고 원본은 복원된다', () => {
        const codec = new ToolNameCodec();
        const names = ['context7::query-docs', 'Python REPL (abc123)::repl_run_code', 'web_search'];
        const out = toOpenAITools(names.map(tool), codec);
        for (const t of out) expect(t.function.name).toMatch(OPENAI_TOOL_NAME_PATTERN);
        expect(out.map((t) => codec.restore(t.function.name))).toEqual(names);
        expect(out[2].function.name).toBe('web_search'); // 규약 안 이름은 그대로
    });

    it('히스토리 assistant.tool_calls 도 tools 와 같은 이름으로 인코딩된다', () => {
        const codec = new ToolNameCodec();
        const [encoded] = toOpenAITools([tool('tavily::tavily_search')], codec);
        const history: ChatMessage[] = [
            { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'tavily::tavily_search', arguments: { q: 'x' } } }] },
            { role: 'tool', content: 'ok', tool_call_id: 'call_1' },
        ];
        const msgs = toOpenAIMessages(history, { codec }) as Array<{ tool_calls?: Array<{ function: { name: string } }> }>;
        expect(msgs[0].tool_calls?.[0].function.name).toBe(encoded.function.name);
    });

    it('codec 미전달이면 종전과 동일하게 이름을 그대로 둔다 (로컬 경로 호환)', () => {
        expect(toOpenAITools([tool('a::b')])[0].function.name).toBe('a::b');
    });
});

describe('OpenAICompatProvider.streamChat — 요청 인코딩·응답 복원 왕복', () => {
    function makeProvider() {
        return new OpenAICompatProvider({ providerId: 'nvidia', apiKey: 'nvapi-test', baseUrl: 'https://integrate.api.nvidia.com/v1' });
    }

    it('요청 tools 는 규약 이름으로 나가고, 응답 tool_call 은 `::` 원본 이름으로 돌아온다', async () => {
        const provider = makeProvider();
        const create = jest.fn(async (params: { tools?: Array<{ function: { name: string } }> }) => {
            const sent = params.tools?.[0].function.name ?? '';
            async function* gen() {
                yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_x', function: { name: sent, arguments: '{"q":"기준금리"}' } }] } }] };
                yield { choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
            }
            return gen();
        });
        (provider as unknown as { client: { chat: { completions: { create: jest.Mock } } } }).client = { chat: { completions: { create } } };

        const result = await provider.streamChat(
            { messages: [{ role: 'user', content: '금리' }], modelId: 'moonshotai/kimi-k3', tools: [tool('tavily::tavily_search'), tool('web_search')] },
            {},
        );
        const sentTools = create.mock.calls[0][0].tools as Array<{ function: { name: string } }>;
        expect(sentTools.map((t) => t.function.name)).toEqual(['tavily__tavily_search', 'web_search']);
        expect(result.toolCalls?.[0]).toMatchObject({ id: 'call_x', name: 'tavily::tavily_search', args: { q: '기준금리' } });
    });
});

describe('mapOpenAIError — provider 의 도구 정의 거절(400)', () => {
    const httpErr = (status: number, message: string) => Object.assign(new Error(message), { status });

    it('NVIDIA NIM "Function at index N has an invalid name" → NOT_SUPPORTED (UPSTREAM_ERROR 아님)', () => {
        const e = mapOpenAIError(httpErr(400, 'litellm.BadRequestError: Nvidia_nimException - Validation: Function at index 1 has an invalid name:'));
        expect(e.code).toBe('NOT_SUPPORTED');
    });

    it('OpenAI 원본 "Invalid \'tools[0].function.name\': string does not match pattern" → NOT_SUPPORTED', () => {
        const e = mapOpenAIError(httpErr(400, "Invalid 'tools[0].function.name': string does not match pattern. Expected a string that matches the pattern '^[a-zA-Z0-9_-]+$'."));
        expect(e.code).toBe('NOT_SUPPORTED');
    });

    it('그 코드는 로컬 폴백 대상(RETRYABLE_CODES)에 들어 있지 않다 — 조용한 모델 교체 차단', () => {
        expect(EXTERNAL_CHAT_FALLBACK.RETRYABLE_CODES).not.toContain('NOT_SUPPORTED');
    });
});
