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

    it('thinking 을 지정해도 거절되는 필드는 없다', async () => {
        reply = () => ({ kind: 'stream', chunks: [sseChunk({ content: 'ok' }, { finish_reason: 'stop' })] });
        await gemini().streamChat({ messages, modelId: 'gemini-2.5-flash', thinking: true }, {});
        const body = fixture.requests[0];
        expect(body).not.toHaveProperty('reasoning');
        expect(body).not.toHaveProperty('extra_body');
    });

    it('다른 provider 를 거쳐 가는 gemini-* 모델은 종전대로 thinking 차단 필드를 보낸다', async () => {
        reply = () => ({ kind: 'stream', chunks: [sseChunk({ content: 'ok' }, { finish_reason: 'stop' })] });
        await provider().streamChat({ messages, modelId: 'gemini-2.5-flash' }, {});
        expect(fixture.requests[0]).toHaveProperty('reasoning');
    });
});
