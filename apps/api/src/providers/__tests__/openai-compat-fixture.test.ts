/**
 * 외부 provider 채팅 경로 — 가짜 LLM 서버(실제 HTTP·SSE) + 실제 openai SDK 로 OpenAICompatProvider 를 검증한다.
 * 채팅에서 외부(BYOK) 모델을 쓰면 이 어댑터가 LiteLLM 게이트웨이로 요청을 보낸다. jest.mock 으로는 지나가지 않는
 * 구간(게이트웨이 헤더 계약, SSE 파싱, 스트림 도중 끊김, HTTP 오류 분류)을 실제 전송으로 본다.
 */
import { OpenAICompatProvider } from '../openai-compat-provider';
import { ProviderError } from '../provider-errors';
import { startLlmFixture, sseChunk, type FixtureReply, type LlmFixture } from '../../__tests__/utils/llm-fixture-server';

let fixture: LlmFixture;
let reply: (index: number) => FixtureReply;
const messages = [{ role: 'user' as const, content: '안녕' }];

/** 게이트웨이 경유 어댑터 — baseUrl(직결 주소)은 쓰이지 않고, 추론은 fixture(게이트웨이 자리)로 간다. */
function provider(): OpenAICompatProvider {
    return new OpenAICompatProvider({
        providerId: 'hasa',
        apiKey: 'byok-user-key',
        baseUrl: 'https://open.hasa.re.kr/v1',
        gateway: { url: fixture.baseURL.replace(/\/v1$/, ''), masterKey: 'gateway-master', modelPrefix: 'hasa' },
    });
}

beforeAll(async () => { fixture = await startLlmFixture((i) => reply(i)); });
afterAll(async () => { await fixture.close(); });
beforeEach(() => { fixture.requests.length = 0; fixture.headers.length = 0; });

describe('게이트웨이 계약', () => {
    it('모델에 provider 접두사를 붙이고, 게이트웨이 키는 Authorization·사용자 BYOK 는 x-api-key 로 보낸다', async () => {
        reply = () => ({ kind: 'stream', chunks: [sseChunk({ content: 'ok' }, { finish_reason: 'stop' })] });
        await provider().streamChat({ messages, modelId: 'qwen3-coder' }, {});
        expect(fixture.requests[0]).toMatchObject({ model: 'hasa/qwen3-coder', stream: true });
        expect(fixture.headers[0].authorization).toBe('Bearer gateway-master');
        expect(fixture.headers[0]['x-api-key']).toBe('byok-user-key');
    });

    it('게이트웨이 재시도를 끈다 — x-litellm-num-retries: 0 (재시도가 provider 동시 요청 한도 경고를 쌓는다, 2026-11-11 hasa)', async () => {
        reply = () => ({ kind: 'stream', chunks: [sseChunk({ content: 'ok' }, { finish_reason: 'stop' })] });
        await provider().streamChat({ messages, modelId: 'qwen3-coder' }, {});
        expect(fixture.headers[0]['x-litellm-num-retries']).toBe('0');
    });

    // 앱 SDK 기본 재시도(2회)도 끈다 — 게이트웨이가 504·429 를 돌려줄 때마다 다시 보내면 upstream 에 한 번씩 더 간다
    it.each([504, 429])('게이트웨이 %i → 요청 1회(앱 SDK 재시도 없음)', async (status) => {
        reply = () => ({ kind: 'error', status });
        const err = await provider().streamChat({ messages, modelId: 'm' }, {}).then(() => null, (e) => e);
        expect(err).toBeInstanceOf(ProviderError);
        expect(fixture.requests).toHaveLength(1);
    }, 30_000);
});

describe('정상 스트림', () => {
    it('토큰을 순서대로 전달하고 사용량을 싣는다', async () => {
        reply = () => ({ kind: 'stream', chunks: [
            sseChunk({ role: 'assistant', content: '안녕' }),
            sseChunk({ content: '하세요' }, { finish_reason: 'stop' }),
            { ...sseChunk({}), choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } },
        ] });
        const tokens: string[] = [];
        let usage: unknown;
        const r = await provider().streamChat({ messages, modelId: 'm' }, { onToken: (t) => tokens.push(t), onUsage: (u) => { usage = u; } });
        expect(tokens.join('')).toBe('안녕하세요');
        expect(r.content).toBe('안녕하세요');
        expect(r.finishReason).toBe('stop');
        expect(r.usage).toMatchObject({ prompt_tokens: 7, completion_tokens: 3 });
        expect(usage).toMatchObject({ prompt_tokens: 7, completion_tokens: 3 });
    });

    it('사용량에 캐시 적중 토큰을 싣는다 — provider 가 주지 않으면 필드가 없다', async () => {
        reply = () => ({ kind: 'stream', chunks: [
            sseChunk({ content: '답' }, { finish_reason: 'stop' }),
            { ...sseChunk({}), choices: [], usage: { prompt_tokens: 70, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 0 } } },
        ] });
        const zero = await provider().streamChat({ messages, modelId: 'm' }, {});
        expect(zero.usage?.cached_prompt_tokens).toBe(0);

        reply = () => ({ kind: 'stream', chunks: [
            sseChunk({ content: '답' }, { finish_reason: 'stop' }),
            { ...sseChunk({}), choices: [], usage: { prompt_tokens: 70, completion_tokens: 3 } },
        ] });
        const none = await provider().streamChat({ messages, modelId: 'm' }, {});
        expect(none.usage).not.toHaveProperty('cached_prompt_tokens');
    });

    it('reasoning 델타는 본문이 아니라 thinking 으로 전달한다', async () => {
        reply = () => ({ kind: 'stream', chunks: [
            sseChunk({ reasoning: '생각 중' }),
            sseChunk({ content: '답' }, { finish_reason: 'stop' }),
        ] });
        const tokens: string[] = [];
        const thinking: string[] = [];
        const r = await provider().streamChat({ messages, modelId: 'm' }, { onToken: (t) => tokens.push(t), onThinking: (t) => thinking.push(t) });
        expect(thinking.join('')).toBe('생각 중');
        expect(tokens.join('')).toBe('답');
        expect(r.content).toBe('답');
    });

    // 외부 provider(DeepSeek·Qwen 계열 등)는 reasoning 대신 reasoning_content 로 추론을 보낸다 — 로컬 stream-parser 와 같게 읽는다
    it('reasoning_content 델타만 와도 thinking 으로 전달한다', async () => {
        reply = () => ({ kind: 'stream', chunks: [
            sseChunk({ reasoning_content: '생각 중' }),
            sseChunk({ content: '답' }, { finish_reason: 'stop' }),
        ] });
        const tokens: string[] = [];
        const thinking: string[] = [];
        const r = await provider().streamChat({ messages, modelId: 'm' }, { onToken: (t) => tokens.push(t), onThinking: (t) => thinking.push(t) });
        expect(thinking).toEqual(['생각 중']);
        expect(tokens.join('')).toBe('답');
        expect(r.content).toBe('답');
    });

    it('reasoning 과 reasoning_content 가 함께 오면 reasoning 만 한 번 전달한다', async () => {
        reply = () => ({ kind: 'stream', chunks: [
            sseChunk({ reasoning: '생각 중', reasoning_content: '생각 중' }),
            sseChunk({ content: '답' }, { finish_reason: 'stop' }),
        ] });
        const thinking: string[] = [];
        await provider().streamChat({ messages, modelId: 'm' }, { onThinking: (t) => thinking.push(t) });
        expect(thinking).toEqual(['생각 중']);
    });

    it('여러 청크로 쪼개진 tool_call 인자를 이어 붙여 한 번 알린다', async () => {
        reply = () => ({ kind: 'stream', chunks: [
            sseChunk({ tool_calls: [{ index: 0, id: 'call_a', function: { name: 'web_search', arguments: '{"que' } }] }),
            sseChunk({ tool_calls: [{ index: 0, function: { arguments: 'ry":"날씨"}' } }] }, { finish_reason: 'tool_calls' }),
        ] });
        const calls: unknown[] = [];
        const r = await provider().streamChat({ messages, modelId: 'm' }, { onToolCall: (c) => calls.push(c) });
        expect(calls).toEqual([{ id: 'call_a', name: 'web_search', args: { query: '날씨' } }]);
        expect(r.finishReason).toBe('tool_calls');
    });
});

describe('스트림 도중 끊김', () => {
    it('이미 받은 토큰은 전달됐고, 호출은 UPSTREAM_ERROR 로 실패한다(조용히 성공으로 끝나지 않는다)', async () => {
        reply = () => ({ kind: 'stream', dropAfter: 1, chunks: [
            sseChunk({ content: '절반만' }),
            sseChunk({ content: ' 나머지' }, { finish_reason: 'stop' }),
        ] });
        const tokens: string[] = [];
        const err = await provider().streamChat({ messages, modelId: 'm' }, { onToken: (t) => tokens.push(t) }).then(() => null, (e) => e);
        expect(tokens.join('')).toBe('절반만');
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).code).toBe('UPSTREAM_ERROR');
    });
});

describe('HTTP 오류 분류', () => {
    const cases: Array<[number, string]> = [
        [401, 'INVALID_API_KEY'],
        [402, 'INSUFFICIENT_CREDIT'],
        [404, 'MODEL_NOT_FOUND'],
        [429, 'QUOTA_EXCEEDED'],
        [500, 'UPSTREAM_ERROR'],
    ];
    it.each(cases)('HTTP %i → %s', async (status, code) => {
        reply = () => ({ kind: 'error', status });
        const err = await provider().streamChat({ messages, modelId: 'm' }, {}).then(() => null, (e) => e);
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).code).toBe(code);
    }, 30_000);
});

describe('사용자 중단', () => {
    it('호출 전에 이미 중단된 신호면 요청을 보내지 않고 끝난다', async () => {
        reply = () => ({ kind: 'stream', chunks: [sseChunk({ content: 'x' }, { finish_reason: 'stop' })] });
        const ac = new AbortController();
        ac.abort();
        const out = await provider().streamChat({ messages, modelId: 'm', abortSignal: ac.signal }, {}).then((r) => r.finishReason, (e) => (e as Error).name || 'error');
        expect(['aborted', 'ProviderError', 'APIUserAbortError']).toContain(out);
        expect(fixture.requests).toHaveLength(0);
    });
});

/**
 * Google AI(Gemini API) 직결 — Google 의 OpenAI 호환 주소는 모르는 필드를 무시하지 않고 400 으로 거절한다.
 * (2026-10-02 라이브: `Unknown name "reasoning"`, `Unknown name "generation_config" at 'extra_body'`, `Unknown name "thinking" at 'extra_body'`)
 * 종전의 Gemini thinking 차단 필드는 OpenRouter·LiteLLM 경유용이라 provider id 가 `gemini` 일 때는 보내면 안 된다.
 */
describe('Google AI(gemini) 요청 본문', () => {
    function gemini(): OpenAICompatProvider {
        return new OpenAICompatProvider({
            providerId: 'gemini', apiKey: 'AIza-test', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
            gateway: { url: fixture.baseURL.replace(/\/v1$/, ''), masterKey: 'gateway-master', modelPrefix: 'gemini' },
        });
    }

    it('Google 이 거절하는 필드(reasoning·extra_body)를 보내지 않는다', async () => {
        reply = () => ({ kind: 'stream', chunks: [sseChunk({ content: 'ok' }, { finish_reason: 'stop' })] });
        await gemini().streamChat({ messages, modelId: 'gemini-2.5-flash' }, {});
        const body = fixture.requests[0];
        expect(body).toMatchObject({ model: 'gemini/gemini-2.5-flash', stream: true });
        expect(body).not.toHaveProperty('reasoning');
        expect(body).not.toHaveProperty('extra_body');
        expect(body).not.toHaveProperty('generation_config');
        expect(body).not.toHaveProperty('thinking');
    });

    // 2026-11-15 실측: LiteLLM 은 extra_body 를 한 겹 풀어 올린다 — 한 겹 더 감싸야 Google 에 extra_body.google 로 닿는다
    it('게이트웨이 + thinking 켬 → 사고 요약 요청을 이중 중첩으로만 보낸다(거절되는 필드·reasoning_effort 없음)', async () => {
        reply = () => ({ kind: 'stream', chunks: [sseChunk({ content: 'ok' }, { finish_reason: 'stop' })] });
        await gemini().streamChat({ messages, modelId: 'gemini-2.5-flash', thinking: 'high' }, {});
        const body = fixture.requests[0];
        expect(body.extra_body).toEqual({ extra_body: { google: { thinking_config: { include_thoughts: true } } } });
        expect(body).not.toHaveProperty('reasoning');
        expect(body).not.toHaveProperty('reasoning_effort');
        expect(body).not.toHaveProperty('allowed_openai_params');
    });

    it('다른 provider 를 거쳐 가는 gemini-* 모델은 종전대로 thinking 차단 필드를 보낸다', async () => {
        reply = () => ({ kind: 'stream', chunks: [sseChunk({ content: 'ok' }, { finish_reason: 'stop' })] });
        await provider().streamChat({ messages, modelId: 'gemini-2.5-flash' }, {});
        expect(fixture.requests[0]).toHaveProperty('reasoning');
    });

    it('다른 provider 를 거쳐 가는 gemini-* 모델은 thinking 을 켜도 종전 차단 필드 그대로(사고 요약 요청 없음)', async () => {
        reply = () => ({ kind: 'stream', chunks: [sseChunk({ content: 'ok' }, { finish_reason: 'stop' })] });
        await provider().streamChat({ messages, modelId: 'gemini-2.5-flash', thinking: true }, {});
        expect(fixture.requests[0]).toMatchObject({
            reasoning: { exclude: true, max_tokens: 0 },
            extra_body: { google: { thinking_config: { thinking_budget: 0, include_thoughts: false } } },
        });
    });
});

/**
 * Google 직접 provider 사고 요약 — 실측(2026-11-15) 스트림 모양: 사고는 delta.content 맨 앞 `<thought>…</thought>`,
 * 사고 조각마다 extra_content.google.thought:true(게이트웨이는 지움), 답의 첫 조각이 `</thought>` 로 시작.
 */
describe('Google AI(gemini) 사고 요약 스트림', () => {
    const ORIGINAL_ALLOWED = process.env.SSRF_ALLOWED_HOSTS;
    beforeAll(() => { process.env.SSRF_ALLOWED_HOSTS = new URL(fixture.baseURL).host; });
    afterAll(() => {
        if (ORIGINAL_ALLOWED === undefined) delete process.env.SSRF_ALLOWED_HOSTS;
        else process.env.SSRF_ALLOWED_HOSTS = ORIGINAL_ALLOWED;
    });

    /** 직접 경로 — 게이트웨이 없이 baseUrl(fixture 가 Google 자리)로 바로 간다 */
    function direct(): OpenAICompatProvider {
        return new OpenAICompatProvider({ providerId: 'gemini', apiKey: 'AIza-test', baseUrl: fixture.baseURL });
    }
    const thought = { extra_content: { google: { thought: true } } };
    const measuredChunks = [
        sseChunk({ role: 'assistant', content: '<thought>**덧셈 계획**\n', ...thought }),
        sseChunk({ content: '2와 3을 더한다.', ...thought }),
        sseChunk({ content: '</thought>2 더하기 3은 ' }),
        sseChunk({ content: '5입니다.' }, { finish_reason: 'stop' }),
        sseChunk({ extra_content: { google: { thought_signature: 'sig' } } }),
        { ...sseChunk({}), choices: [], usage: { prompt_tokens: 9, completion_tokens: 20 } },
    ];

    async function collect(p: OpenAICompatProvider, thinking: boolean | undefined) {
        const tokens: string[] = [];
        const thinkingParts: string[] = [];
        const r = await p.streamChat(
            { messages, modelId: 'gemini-2.5-flash', ...(thinking !== undefined ? { thinking } : {}) },
            { onToken: (t) => tokens.push(t), onThinking: (t) => thinkingParts.push(t) },
        );
        return { r, tokens: tokens.join(''), thinking: thinkingParts.join('') };
    }

    it('직접 + thinking 켬 → extra_body.google 요청, 사고는 onThinking·본문엔 태그·사고 없음', async () => {
        reply = () => ({ kind: 'stream', chunks: measuredChunks });
        const { r, tokens, thinking } = await collect(direct(), true);
        const body = fixture.requests[0];
        expect(body).toMatchObject({ model: 'gemini-2.5-flash' });
        expect(body.extra_body).toEqual({ google: { thinking_config: { include_thoughts: true } } });
        expect(body).not.toHaveProperty('reasoning_effort');
        expect(body).not.toHaveProperty('reasoning');
        expect(thinking).toBe('**덧셈 계획**\n2와 3을 더한다.');
        expect(tokens).toBe('2 더하기 3은 5입니다.');
        expect(r.content).toBe('2 더하기 3은 5입니다.');
        expect(r.finishReason).toBe('stop');
    });

    it('게이트웨이 + thinking 켬 → 표시 없이 태그만 와도 가른다', async () => {
        const gw = new OpenAICompatProvider({
            providerId: 'gemini', apiKey: 'AIza-test', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
            gateway: { url: fixture.baseURL.replace(/\/v1$/, ''), masterKey: 'gateway-master', modelPrefix: 'gemini' },
        });
        reply = () => ({ kind: 'stream', chunks: [
            sseChunk({ role: 'assistant', content: '<thought>생각' }),
            sseChunk({ content: '</thou' }),
            sseChunk({ content: 'ght>답' }, { finish_reason: 'stop' }),
        ] });
        const { r, tokens, thinking } = await collect(gw, true);
        expect(fixture.requests[0].extra_body).toEqual({ extra_body: { google: { thinking_config: { include_thoughts: true } } } });
        expect(thinking).toBe('생각');
        expect(tokens).toBe('답');
        expect(r.content).toBe('답');
    });

    it('직접 + thinking 꺼짐 → extra_body 없음, 본문의 <thought> 도 그대로', async () => {
        reply = () => ({ kind: 'stream', chunks: [
            sseChunk({ content: '<thought>태그</thought>' }),
            sseChunk({ content: ' 그대로' }, { finish_reason: 'stop' }),
        ] });
        for (const off of [false, undefined]) {
            fixture.requests.length = 0;
            const { r, tokens, thinking } = await collect(direct(), off);
            expect(fixture.requests[0]).not.toHaveProperty('extra_body');
            expect(thinking).toBe('');
            expect(tokens).toBe('<thought>태그</thought> 그대로');
            expect(r.content).toBe('<thought>태그</thought> 그대로');
        }
    });

    it('직접 + thinking 켬 + 닫힘 없이 끝 → 전부 사고, 본문 빈 값', async () => {
        reply = () => ({ kind: 'stream', chunks: [sseChunk({ content: '<thought>생각 중</th' }, { finish_reason: 'length' })] });
        const { r, tokens, thinking } = await collect(direct(), true);
        expect(thinking).toBe('생각 중</th');
        expect(tokens).toBe('');
        expect(r.content).toBe('');
    });

    it('직접 + thinking 켬 + 미완 여는 태그 접두로 끝 → 본문으로 낸다', async () => {
        reply = () => ({ kind: 'stream', chunks: [sseChunk({ content: '<thou' }, { finish_reason: 'stop' })] });
        const { r, tokens, thinking } = await collect(direct(), true);
        expect(thinking).toBe('');
        expect(tokens).toBe('<thou');
        expect(r.content).toBe('<thou');
    });

    it('가른 본문만 가짜 도구 호출 게이트로 넘긴다 — 사고 안의 <tool_call> 은 도구 호출이 아니다', async () => {
        reply = () => ({ kind: 'stream', chunks: [
            sseChunk({ content: '<thought><tool_call>{"name":"web_search","arguments":{}}</tool_call> 는 쓰지 않는다' }),
            sseChunk({ content: '</thought>답' }, { finish_reason: 'stop' }),
        ] });
        const { r, tokens, thinking } = await collect(direct(), true);
        expect(thinking).toContain('<tool_call>');
        expect(tokens).toBe('답');
        expect(r.toolCalls).toBeUndefined();
    });

    // 리뷰 R1 N-3 — 도구 호출만 하고 끝나는 턴: 사고가 닫히지 않은 채 네이티브 tool_calls 로 끝나도 사고·도구 호출이 섞이지 않는다
    it('직접 + thinking 켬 + tools → 닫힘 없는 사고 뒤 네이티브 tool_calls 로 끝 → 전부 사고, 본문 빈 값, 도구 호출 1건', async () => {
        reply = () => ({ kind: 'stream', chunks: [
            sseChunk({ role: 'assistant', content: '<thought>사고: 날씨는 ', ...thought }),
            sseChunk({ content: '검색해야 한다.', ...thought }),
            sseChunk({ tool_calls: [{ index: 0, id: 'call_g', function: { name: 'web_search', arguments: '{"query":' } }] }),
            sseChunk({ tool_calls: [{ index: 0, function: { arguments: '"서울 날씨"}' } }] }, { finish_reason: 'tool_calls' }),
        ] });
        const tokens: string[] = [];
        const thinkingParts: string[] = [];
        const r = await direct().streamChat(
            {
                messages, modelId: 'gemini-2.5-flash', thinking: true,
                tools: [{ type: 'function', function: { name: 'web_search', description: 'search', parameters: { type: 'object', properties: {} } } }],
            },
            { onToken: (t) => tokens.push(t), onThinking: (t) => thinkingParts.push(t) },
        );
        const thinking = thinkingParts.join('');
        expect(thinking).toBe('사고: 날씨는 검색해야 한다.');
        expect(tokens).toEqual([]);
        expect(r.content).toBe('');
        expect(r.toolCalls).toHaveLength(1);
        expect(r.toolCalls?.[0]).toMatchObject({ name: 'web_search', args: { query: '서울 날씨' } });
        expect(r.finishReason).toBe('tool_calls');
        expect(thinking).not.toContain('<thought');
        expect(r.content).not.toContain('<thought');
    });
});
