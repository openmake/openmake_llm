/**
 * 채팅 서비스의 provider 흐름 — 가짜 LLM 서버 두 대(외부 게이트웨이 자리·로컬 자리)에 실제 어댑터(OpenAICompatProvider)와
 * 실제 openai SDK 를 붙여 본다. 종전 폴백 테스트(external-local-fallback.test.ts)는 streamChat 을 가짜 함수로 바꿔
 * HTTP 오류가 어떤 ProviderError 로 분류돼 폴백 판정에 닿는지는 지나가지 않았다. 여기서는 그 구간까지 실제 전송으로 돈다:
 * HTTP 상태·스트림 끊김 → 어댑터의 오류 분류 → streamFromExternalProvider 의 폴백 판정 → 로컬 재시도 → 사용자 고지.
 */
import { streamFromExternalProvider } from '../external-fallback';
import { OpenAICompatProvider } from '../../../providers/openai-compat-provider';
import type { ResolvedProvider } from '../../../providers/provider-router';
import { startLlmFixture, sseChunk, type FixtureReply, type LlmFixture } from '../../../__tests__/utils/llm-fixture-server';

let external: LlmFixture;
let local: LlmFixture;
let externalReply: (index: number) => FixtureReply;
const localReply = (): FixtureReply => ({ kind: 'stream', chunks: [sseChunk({ role: 'assistant', content: '로컬' }), sseChunk({ content: '응답' }, { finish_reason: 'stop' })] });

function resolved(providerId: string, modelId: string, fixture: LlmFixture): ResolvedProvider {
    return {
        providerId, modelId, fullId: `${providerId}:${modelId}`,
        provider: new OpenAICompatProvider({
            providerId, apiKey: 'user-key', baseUrl: 'https://unused.example/v1',
            gateway: { url: fixture.baseURL.replace(/\/v1$/, ''), masterKey: 'gateway-master', modelPrefix: providerId },
        }),
    } as unknown as ResolvedProvider;
}

function run(opts: { abortSignal?: AbortSignal } = {}) {
    const tokens: string[] = [];
    const events: Array<{ type: string; metadata?: Record<string, unknown> }> = [];
    const served: string[] = [];
    const deps = {
        currentUserContext: null,
        allowedTools: [],
        providerRouter: { resolve: jest.fn(async () => resolved('local-llm', 'qwen-test', local)), getExternalKeysRepo: () => undefined },
        onSystemEvent: (e: { type: string; metadata?: Record<string, unknown> }) => { events.push(e); },
    } as never;
    const req = { message: '안녕', userId: 'u1', userRole: 'user' as const, onServedModel: (m: string) => served.push(m), ...opts };
    const out = streamFromExternalProvider(deps, resolved('hasa', 'big-model', external), req as never, (t) => { if (t) tokens.push(t); });
    return { out, tokens, events, served };
}

beforeAll(async () => {
    external = await startLlmFixture((i) => externalReply(i));
    local = await startLlmFixture(() => localReply());
});
afterAll(async () => { await external.close(); await local.close(); });
beforeEach(() => { external.requests.length = 0; local.requests.length = 0; });

describe('채팅 provider 흐름 — 실제 전송', () => {
    it('외부 모델이 정상 응답하면 그대로 스트리밍하고 로컬은 부르지 않는다', async () => {
        externalReply = () => ({ kind: 'stream', chunks: [sseChunk({ role: 'assistant', content: '외부' }), sseChunk({ content: '응답' }, { finish_reason: 'stop' })] });
        const r = run();
        await expect(r.out).resolves.toContain('외부응답');
        expect(r.tokens.join('')).toBe('외부응답');
        expect(local.requests).toHaveLength(0);
        expect(r.events).toHaveLength(0);
    });

    it.each([
        [429, '한도 초과'],
        [401, '인증 실패'],
        [503, '업스트림 오류'],
    ])('외부가 HTTP %i(%s)이면 로컬로 한 번 폴백해 답을 완성하고, 폴백을 알린다', async (status) => {
        externalReply = () => ({ kind: 'error', status });
        const r = run();
        await expect(r.out).resolves.toContain('로컬응답');
        expect(r.tokens.join('')).toBe('로컬응답');
        expect(local.requests).toHaveLength(1);
        expect(local.requests[0]).toMatchObject({ model: 'local-llm/qwen-test', stream: true });
        expect(r.events.map((e) => e.type)).toEqual(['model_fallback']);
        expect(r.events[0].metadata).toMatchObject({ from: 'hasa:big-model' });
        expect(r.served).toHaveLength(1); // 실제 답한 모델(로컬)을 통지
    });

    // 폴백 판정의 "400 제외"는 우리 코드가 status 400 으로 던진 오류(vision 게이트 등)에만 걸린다. 업스트림이 돌려준 400 은
    // 어댑터가 status 없는 ProviderError(UPSTREAM_ERROR)로 감싸므로 폴백 대상이다 — 가짜 함수 테스트로는 보이지 않던 실제 동작.
    it('업스트림이 HTTP 400 을 돌려주면 UPSTREAM_ERROR 로 분류돼 로컬로 폴백한다', async () => {
        externalReply = () => ({ kind: 'error', status: 400 });
        const r = run();
        await expect(r.out).resolves.toContain('로컬응답');
        expect(local.requests).toHaveLength(1);
        expect(r.events[0].metadata).toMatchObject({ from: 'hasa:big-model', code: 'UPSTREAM_ERROR' });
    });

    it('첫 토큰 전에 연결이 끊기면 로컬로 폴백한다', async () => {
        externalReply = () => ({ kind: 'stream', chunks: [sseChunk({ content: '안 보임' })], dropAfter: 0 });
        const r = run();
        await expect(r.out).resolves.toContain('로컬응답');
        expect(r.tokens.join('')).toBe('로컬응답');
        expect(local.requests).toHaveLength(1);
    });

    it('토큰을 내보낸 뒤 연결이 끊기면 폴백하지 않는다 — 앞부분과 이어지지 않는 답이 섞이지 않게', async () => {
        externalReply = () => ({ kind: 'stream', chunks: [sseChunk({ role: 'assistant', content: '외부 일부' }), sseChunk({ content: ' 더' })], dropAfter: 1 });
        const r = run();
        await expect(r.out).rejects.toBeDefined();
        expect(r.tokens.join('')).toBe('외부 일부');
        expect(local.requests).toHaveLength(0);
        expect(r.events).toHaveLength(0);
    });

    it('사용자가 중단한 요청은 실패해도 폴백하지 않는다', async () => {
        externalReply = () => ({ kind: 'error', status: 503 });
        const ac = new AbortController();
        ac.abort();
        const r = run({ abortSignal: ac.signal });
        await r.out.catch(() => undefined);
        expect(local.requests).toHaveLength(0);
    });
});
