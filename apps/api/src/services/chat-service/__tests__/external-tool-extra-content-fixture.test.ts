/**
 * 채팅 외부 provider 도구 루프 — 응답 tool_call 의 extra_content 가 다음 턴 요청에 그대로 돌아가는지(실제 전송).
 *
 * 실측(2026-10-23): gemini:gemini-3.6-flash 가 mcp_call 을 부른 뒤 2턴째 요청이
 * "Function call is missing a thought_signature in functionCall parts" 400 으로 깨졌다. Google OpenAI 호환 엔드포인트는
 * thought signature 를 tool_calls[i].extra_content 에 담아 주는데, 도구 루프가 assistant 메시지를 다시 만들며 버렸다.
 * 가짜 게이트웨이(실제 HTTP·SSE) + 실제 OpenAICompatProvider + 실제 openai SDK 로 1턴 응답 → 2턴 요청 본문을 본다.
 */
import { streamFromExternalProvider } from '../external-fallback';
import { OpenAICompatProvider } from '../../../providers/openai-compat-provider';
import type { ResolvedProvider } from '../../../providers/provider-router';
import { startLlmFixture, sseChunk, type FixtureReply, type LlmFixture } from '../../../__tests__/utils/llm-fixture-server';

const EXTRA = { google: { thought_signature: 'c2lnbmF0dXJlLW9wYXF1ZQ==' } };

let external: LlmFixture;
let externalReply: (index: number) => FixtureReply;

function resolved(fixture: LlmFixture): ResolvedProvider {
    return {
        providerId: 'gemini', modelId: 'gemini-3.6-flash', fullId: 'gemini:gemini-3.6-flash',
        provider: new OpenAICompatProvider({
            providerId: 'gemini', apiKey: 'user-key', baseUrl: 'https://unused.example/v1',
            gateway: { url: fixture.baseURL.replace(/\/v1$/, ''), masterKey: 'gateway-master', modelPrefix: 'gemini' },
        }),
    } as unknown as ResolvedProvider;
}

function run() {
    const deps = {
        currentUserContext: null,
        allowedTools: [],
        providerRouter: { resolve: jest.fn(), getExternalKeysRepo: () => undefined },
        onSystemEvent: () => undefined,
    } as never;
    // 도구는 실행하지 않고(dry-run) 관찰만 — 루프가 assistant(tool_calls)+tool 결과를 쌓고 다음 턴을 부르는 이음새만 본다.
    const req = { message: '도구를 써서 알려줘', userId: 'u1', userRole: 'user' as const, evalToolObserver: { dryRun: true, onToolCalls: jest.fn() } };
    return streamFromExternalProvider(deps, resolved(external), req as never, () => undefined);
}

type WireMessage = { role: string; tool_calls?: Array<Record<string, unknown>> };

beforeAll(async () => { external = await startLlmFixture((i) => externalReply(i)); });
afterAll(async () => { await external.close(); });
beforeEach(() => { external.requests.length = 0; });

describe('외부 provider 도구 루프 — extra_content 왕복', () => {
    it('1턴 응답 tool_call 의 extra_content 가 2턴 요청 assistant.tool_calls 에 그대로 실린다', async () => {
        externalReply = (i) => i === 0
            ? { kind: 'stream', chunks: [
                sseChunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_g', type: 'function', extra_content: EXTRA, function: { name: 'mcp_call', arguments: '{"tool":"x"}' } }] }, { finish_reason: 'tool_calls' }),
            ] }
            : { kind: 'stream', chunks: [sseChunk({ role: 'assistant', content: '완료' }, { finish_reason: 'stop' })] };

        await expect(run()).resolves.toContain('완료');

        expect(external.requests).toHaveLength(2);
        const assistant = (external.requests[1].messages as WireMessage[]).find((m) => m.role === 'assistant' && m.tool_calls);
        expect(assistant?.tool_calls?.[0]).toMatchObject({ id: 'call_g', extra_content: EXTRA, function: { name: 'mcp_call' } });
    });

    it('extra_content 가 없는 응답이면 2턴 요청 tool_call 에도 키가 없다', async () => {
        externalReply = (i) => i === 0
            ? { kind: 'stream', chunks: [
                sseChunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'mcp_call', arguments: '{}' } }] }, { finish_reason: 'tool_calls' }),
            ] }
            : { kind: 'stream', chunks: [sseChunk({ role: 'assistant', content: '완료' }, { finish_reason: 'stop' })] };

        await expect(run()).resolves.toContain('완료');

        const assistant = (external.requests[1].messages as WireMessage[]).find((m) => m.role === 'assistant' && m.tool_calls);
        expect(assistant?.tool_calls?.[0]).not.toHaveProperty('extra_content');
    });
});
