/**
 * responses-mapping 단위 테스트 — ChatMessage↔Responses 변환·스트리밍 수집기.
 * 네트워크/SDK 의존 없음 (순수 함수).
 */
import {
    toResponsesInput,
    toResponsesTools,
    toResponsesToolChoice,
    ResponsesStreamCollector,
    type ResponsesStreamEvent,
} from '../responses-mapping';
import type { ChatMessage, ToolDefinition } from '../../../llm';
import type { ChatStreamCallbacks } from '../../i-provider';

describe('toResponsesInput', () => {
    it('system 메시지를 instructions 로 분리 병합한다', () => {
        const messages: ChatMessage[] = [
            { role: 'system', content: '지시 A' },
            { role: 'system', content: '지시 B' },
            { role: 'user', content: '안녕' },
        ];
        const { instructions, input } = toResponsesInput(messages);
        expect(instructions).toBe('지시 A\n\n지시 B');
        expect(input).toEqual([
            {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: '안녕' }],
            },
        ]);
    });

    it('assistant tool_calls → function_call, tool 결과 → function_call_output', () => {
        const messages: ChatMessage[] = [
            { role: 'user', content: '날씨?' },
            {
                role: 'assistant',
                content: '',
                tool_calls: [
                    {
                        id: 'call_1',
                        type: 'function',
                        function: { name: 'get_weather', arguments: { city: 'Seoul' } },
                    },
                ],
            },
            { role: 'tool', content: '맑음', tool_call_id: 'call_1' },
        ];
        const { input } = toResponsesInput(messages);
        expect(input).toEqual([
            {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: '날씨?' }],
            },
            {
                type: 'function_call',
                call_id: 'call_1',
                name: 'get_weather',
                arguments: JSON.stringify({ city: 'Seoul' }),
            },
            { type: 'function_call_output', call_id: 'call_1', output: '맑음' },
        ]);
    });

    it('user 이미지는 input_image 파트로 변환한다 (dataURL 유지)', () => {
        const messages: ChatMessage[] = [
            { role: 'user', content: '이거 뭐야', images: ['data:image/png;base64,AAAA'] },
        ];
        const { input } = toResponsesInput(messages);
        expect(input[0]).toEqual({
            type: 'message',
            role: 'user',
            content: [
                { type: 'input_text', text: '이거 뭐야' },
                { type: 'input_image', image_url: 'data:image/png;base64,AAAA', detail: 'auto' },
            ],
        });
    });
});

describe('toResponsesTools / toResponsesToolChoice', () => {
    const tools: ToolDefinition[] = [
        {
            type: 'function',
            function: {
                name: 'search',
                description: '검색',
                parameters: { type: 'object', properties: {} },
            },
        },
    ];

    it('nested function 스키마를 flat Responses 형식으로 변환한다', () => {
        expect(toResponsesTools(tools)).toEqual([
            {
                type: 'function',
                name: 'search',
                description: '검색',
                parameters: { type: 'object', properties: {} },
                strict: false,
            },
        ]);
    });

    it('tool_choice 매핑 — 문자열 pass-through, function 지정은 flat', () => {
        expect(toResponsesToolChoice('auto')).toBe('auto');
        expect(toResponsesToolChoice('required')).toBe('required');
        expect(
            toResponsesToolChoice({ type: 'function', function: { name: 'search' } }),
        ).toEqual({ type: 'function', name: 'search' });
    });
});

describe('ResponsesStreamCollector', () => {
    function makeCallbacks() {
        const tokens: string[] = [];
        const thinking: string[] = [];
        const toolCalls: Array<{ id: string; name: string; args: unknown }> = [];
        const usages: unknown[] = [];
        const callbacks: ChatStreamCallbacks = {
            onToken: (t) => tokens.push(t),
            onThinking: (t) => thinking.push(t),
            onToolCall: (c) => toolCalls.push(c),
            onUsage: (u) => usages.push(u),
        };
        return { callbacks, tokens, thinking, toolCalls, usages };
    }

    it('텍스트·reasoning 델타를 누적하고 usage 를 매핑한다', () => {
        const { callbacks, tokens, thinking, usages } = makeCallbacks();
        const collector = new ResponsesStreamCollector();
        const events: ResponsesStreamEvent[] = [
            { type: 'response.reasoning_summary_text.delta', delta: '생각중' },
            { type: 'response.output_text.delta', delta: '안녕' },
            { type: 'response.output_text.delta', delta: '하세요' },
            {
                type: 'response.completed',
                response: { status: 'completed', usage: { input_tokens: 10, output_tokens: 5 } },
            },
        ];
        for (const e of events) collector.handleEvent(e, callbacks);
        const result = collector.finalize(callbacks, false);

        expect(result.content).toBe('안녕하세요');
        expect(result.thinking).toBe('생각중');
        expect(result.finishReason).toBe('stop');
        expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5 });
        expect(tokens).toEqual(['안녕', '하세요']);
        expect(thinking).toEqual(['생각중']);
        expect(usages).toHaveLength(1);
    });

    it('function call 스트림(added→delta→done)을 tool_calls 로 조립한다', () => {
        const { callbacks, toolCalls } = makeCallbacks();
        const collector = new ResponsesStreamCollector();
        const events: ResponsesStreamEvent[] = [
            {
                type: 'response.output_item.added',
                item: { type: 'function_call', id: 'item_1', call_id: 'call_9', name: 'search' },
            },
            { type: 'response.function_call_arguments.delta', item_id: 'item_1', delta: '{"q":' },
            { type: 'response.function_call_arguments.delta', item_id: 'item_1', delta: '"seoul"}' },
            {
                type: 'response.output_item.done',
                item: { type: 'function_call', id: 'item_1', call_id: 'call_9', name: 'search' },
            },
            { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 2 } } },
        ];
        for (const e of events) collector.handleEvent(e, callbacks);
        const result = collector.finalize(callbacks, false);

        expect(result.finishReason).toBe('tool_calls');
        expect(result.toolCalls).toEqual([
            { id: 'call_9', name: 'search', args: { q: 'seoul' } },
        ]);
        expect(toolCalls).toHaveLength(1);
    });

    it('done 이벤트의 완성 arguments 가 델타 누적보다 우선한다', () => {
        const { callbacks } = makeCallbacks();
        const collector = new ResponsesStreamCollector();
        collector.handleEvent(
            { type: 'response.output_item.added', item: { type: 'function_call', id: 'i1', call_id: 'c1', name: 'f' } },
            callbacks,
        );
        collector.handleEvent(
            { type: 'response.function_call_arguments.delta', item_id: 'i1', delta: '{"partial' },
            callbacks,
        );
        collector.handleEvent(
            {
                type: 'response.output_item.done',
                item: { type: 'function_call', id: 'i1', call_id: 'c1', name: 'f', arguments: '{"full":true}' },
            },
            callbacks,
        );
        const result = collector.finalize(callbacks, false);
        expect(result.toolCalls?.[0].args).toEqual({ full: true });
    });

    it('max_output_tokens 도달 시 finishReason=length', () => {
        const { callbacks } = makeCallbacks();
        const collector = new ResponsesStreamCollector();
        collector.handleEvent(
            {
                type: 'response.incomplete',
                response: {
                    status: 'incomplete',
                    incomplete_details: { reason: 'max_output_tokens' },
                    usage: { input_tokens: 1, output_tokens: 2 },
                },
            },
            callbacks,
        );
        expect(collector.finalize(callbacks, false).finishReason).toBe('length');
    });

    it('실패 이벤트는 getFailure 로 노출된다', () => {
        const { callbacks } = makeCallbacks();
        const collector = new ResponsesStreamCollector();
        collector.handleEvent(
            { type: 'response.failed', response: { error: { message: 'upstream down' } } },
            callbacks,
        );
        expect(collector.getFailure()).toBe('upstream down');
    });
});

describe('ToolNameCodec (라이브 E2E 회귀: Codex 도구명 패턴)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ToolNameCodec } = require('../responses-mapping');
    const CODEX_PATTERN = /^[a-zA-Z0-9_-]+$/;

    it('비허용 문자를 치환하고 왕복 복원한다', () => {
        const codec = new ToolNameCodec();
        for (const bad of ['kakao.map:find-route', 'tool with space', '검색도구', 'a/b\\c']) {
            const safe = codec.register(bad);
            expect(safe).toMatch(CODEX_PATTERN);
            expect(codec.restore(safe)).toBe(bad);
        }
    });

    it('멱등 — 같은 이름은 같은 결과', () => {
        const codec = new ToolNameCodec();
        expect(codec.register('a.b')).toBe(codec.register('a.b'));
    });

    it('충돌하는 서로 다른 원본을 다른 이름으로 분리한다', () => {
        const codec = new ToolNameCodec();
        const first = codec.register('a.b');
        const second = codec.register('a:b');
        expect(first).not.toBe(second);
        expect(codec.restore(first)).toBe('a.b');
        expect(codec.restore(second)).toBe('a:b');
    });

    it('허용 문자만 있는 이름은 그대로 두고 미등록 이름은 통과시킨다', () => {
        const codec = new ToolNameCodec();
        expect(codec.register('web_search')).toBe('web_search');
        expect(codec.restore('never_registered')).toBe('never_registered');
        expect(codec.renamed()).toEqual([]);
    });

    it('길이 상한(64)을 넘지 않는다', () => {
        const codec = new ToolNameCodec();
        const safe = codec.register('x'.repeat(200) + '.tool');
        expect(safe.length).toBeLessThanOrEqual(64);
        expect(safe).toMatch(CODEX_PATTERN);
    });

    it('tools/history/tool_choice 가 같은 코덱으로 일관 정규화되고 응답은 복원된다', () => {
        const codec = new ToolNameCodec();
        const tools = toResponsesTools(
            [{ type: 'function', function: { name: 'ns.tool', description: 'd', parameters: { type: 'object', properties: {} } } }],
            codec,
        );
        const safeName = tools[0].name;
        expect(safeName).toMatch(CODEX_PATTERN);

        const { input } = toResponsesInput(
            [{ role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'ns.tool', arguments: {} } }] }],
            codec,
        );
        expect((input[0] as { name: string }).name).toBe(safeName);
        expect(toResponsesToolChoice({ type: 'function', function: { name: 'ns.tool' } }, codec))
            .toEqual({ type: 'function', name: safeName });

        const collector = new ResponsesStreamCollector(codec);
        collector.handleEvent(
            { type: 'response.output_item.done', item: { type: 'function_call', id: 'i1', call_id: 'c1', name: safeName, arguments: '{}' } },
            {},
        );
        expect(collector.finalize({}, false).toolCalls?.[0].name).toBe('ns.tool');
    });
});

describe('ProviderRoleClient (라이브 E2E 회귀: role 경로 403 폴백)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createProviderRoleClient } = require('../role-client');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ProviderError } = require('../../provider-errors');

    const makeProvider = (impl: unknown) => ({
        id: 'chatgpt',
        sdkType: 'openai-compatible',
        displayName: 'ChatGPT',
        getCapabilities: () => ({ streaming: true, toolCalling: true, vision: true, thinking: true }),
        listModels: async () => [],
        validateCredentials: async () => ({ ok: true }),
        streamChat: impl,
    });

    it('provider 응답을 LLMClient chat 반환 형태로 변환한다', async () => {
        const provider = makeProvider(async (opts: { modelId: string }, cb: { onToken?: (t: string) => void }) => {
            cb.onToken?.('안녕');
            return {
                content: '안녕하세요',
                thinking: '생각',
                toolCalls: [{ id: 'c1', name: 'web_search', args: { q: 'x' } }],
                usage: { prompt_tokens: 10, completion_tokens: 3 },
                finishReason: 'tool_calls',
                modelEcho: opts.modelId,
            };
        });
        const tokens: string[] = [];
        const client = createProviderRoleClient({ provider, modelId: 'gpt-5.5' });
        const r = await client.chat([{ role: 'user', content: 'hi' }], undefined, (t: string) => { if (t) tokens.push(t); });

        expect(r.role).toBe('assistant');
        expect(r.content).toBe('안녕하세요');
        expect(r.thinking).toBe('생각');
        expect(r.tool_calls).toEqual([
            { id: 'c1', type: 'function', function: { name: 'web_search', arguments: { q: 'x' } } },
        ]);
        expect(r.metrics).toEqual({ prompt_tokens: 10, completion_tokens: 3 });
        expect(tokens).toEqual(['안녕']);
    });

    it('ProviderError 에 status 를 부착해 기존 4xx 로컬 폴백 규약과 맞물린다', async () => {
        const provider = makeProvider(async () => {
            throw new ProviderError('INVALID_API_KEY', '인증 실패');
        });
        const client = createProviderRoleClient({ provider, modelId: 'gpt-5.5' });
        await expect(client.chat([{ role: 'user', content: 'hi' }]))
            .rejects.toMatchObject({ status: 401 });
    });

    it('QUOTA_EXCEEDED 는 429 로 매핑된다 (구독 한도 → 폴백 대상)', async () => {
        const provider = makeProvider(async () => {
            throw new ProviderError('QUOTA_EXCEEDED', '한도 초과');
        });
        const client = createProviderRoleClient({ provider, modelId: 'gpt-5.5' });
        await expect(client.chat([{ role: 'user', content: 'hi' }]))
            .rejects.toMatchObject({ status: 429 });
    });

    it('tools/tool_choice/abort 를 provider 옵션으로 전달한다', async () => {
        let captured: Record<string, unknown> = {};
        const provider = makeProvider(async (opts: Record<string, unknown>) => {
            captured = opts;
            return { content: 'ok', usage: {}, finishReason: 'stop' };
        });
        const ac = new AbortController();
        const client = createProviderRoleClient({ provider, modelId: 'gpt-5.5' });
        await client.chat(
            [{ role: 'user', content: 'hi' }],
            { num_predict: 128 },
            undefined,
            {
                tools: [{ type: 'function', function: { name: 'f', description: 'd', parameters: { type: 'object', properties: {} } } }],
                tool_choice: 'required',
                signal: ac.signal,
            },
        );
        expect(captured.modelId).toBe('gpt-5.5');
        expect(captured.maxTokens).toBe(128);
        expect(captured.tool_choice).toBe('required');
        expect((captured.tools as unknown[]).length).toBe(1);
        expect(captured.abortSignal).toBe(ac.signal);
    });
});

describe('ProviderRoleClient 사용량 기록·쿼터 면제 (2026-07-26 정책)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createProviderRoleClient } = require('../role-client');

    const makeProvider = (usage: unknown) => ({
        id: 'chatgpt',
        sdkType: 'openai-compatible',
        displayName: 'ChatGPT',
        getCapabilities: () => ({ streaming: true, toolCalling: true, vision: true, thinking: true }),
        listModels: async () => [],
        validateCredentials: async () => ({ ok: true }),
        streamChat: async () => ({ content: 'ok', usage, finishReason: 'stop' }),
    });

    it('토큰이 있으면 onUsage 로 BYOK 귀속 정보를 발화한다', async () => {
        const seen: Array<{ model: string; promptTokens: number; completionTokens: number }> = [];
        const client = createProviderRoleClient({
            provider: makeProvider({ prompt_tokens: 120, completion_tokens: 30 }),
            modelId: 'gpt-5.5',
            userId: 'u1',
            onUsage: (u: { model: string; promptTokens: number; completionTokens: number }) => seen.push(u),
        });
        await client.chat([{ role: 'user', content: 'hi' }]);

        expect(seen).toEqual([{ model: 'gpt-5.5', promptTokens: 120, completionTokens: 30 }]);
    });

    it('토큰이 0이면 발화하지 않는다 (빈 기록 방지)', async () => {
        const seen: unknown[] = [];
        const client = createProviderRoleClient({
            provider: makeProvider({}),
            modelId: 'gpt-5.5',
            userId: 'u1',
            onUsage: (u: unknown) => seen.push(u),
        });
        await client.chat([{ role: 'user', content: 'hi' }]);
        expect(seen).toEqual([]);
    });

    it('onUsage 가 throw 해도 호출 결과에 영향이 없다 (관측 훅 격리)', async () => {
        const client = createProviderRoleClient({
            provider: makeProvider({ prompt_tokens: 5, completion_tokens: 5 }),
            modelId: 'gpt-5.5',
            userId: 'u1',
            onUsage: () => { throw new Error('sink down'); },
        });
        const r = await client.chat([{ role: 'user', content: 'hi' }]);
        expect(r.content).toBe('ok');
    });

    it('로컬 토큰 쿼터를 검사하지 않는다 (외부 BYOK 면제 정책)', async () => {
        // 쿼터 모듈을 타면 KVStore 접근이 필요하다 — 면제라면 호출 자체가 없어야 한다.
        const quota = require('../../../llm/user-quota');
        const spy = jest.spyOn(quota, 'checkUserQuota');
        const client = createProviderRoleClient({
            provider: makeProvider({ prompt_tokens: 10, completion_tokens: 10 }),
            modelId: 'gpt-5.5',
            userId: 'u1',
        });
        await client.chat([{ role: 'user', content: 'hi' }]);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});
