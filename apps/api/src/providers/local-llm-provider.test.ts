import { LocalLLMProvider } from './local-llm-provider';

describe('LocalLlmProvider.getCapabilities', () => {
    // getCapabilities 는 client 를 사용하지 않으므로 스텁으로 충분
    const provider = new LocalLLMProvider({} as any);

    it('qwen3.6-35b-a3b → vision:true (라이브 검증된 vision 보존)', () => {
        const caps = provider.getCapabilities('qwen3.6-35b-a3b');
        expect(caps.vision).toBe(true);
        expect(caps.toolCalling).toBe(true);
        expect(caps.thinking).toBe(true);
    });

    it('qwen3.6-35b-a3b:cloud (suffixed variant) → vision:true', () => {
        expect(provider.getCapabilities('qwen3.6-35b-a3b:cloud').vision).toBe(true);
    });

    it('미등록 모델 → 보수적 FALLBACK (vision:false, toolCalling:false)', () => {
        const caps = provider.getCapabilities('totally-unknown-model');
        expect(caps.vision).toBe(false);
        expect(caps.toolCalling).toBe(false);
        expect(caps.streaming).toBe(true);
    });
});

describe('LocalLLMProvider.streamChat fast-fail', () => {
    const OLD_ENV = process.env.LLM_FAST_FAIL_TIMEOUT_MS;
    afterEach(() => {
        if (OLD_ENV === undefined) delete process.env.LLM_FAST_FAIL_TIMEOUT_MS;
        else process.env.LLM_FAST_FAIL_TIMEOUT_MS = OLD_ENV;
    });

    /** onActivity 발화 시점과 완료 지연을 제어할 수 있는 LLMClient 스텁 */
    function makeClientStub(opts: {
        activityDelayMs?: number;   // onActivity 발화 시점 (undefined = 미발화)
        completeAfterMs: number;    // chat resolve 시점
        signalAware?: boolean;      // abort 시 즉시 reject
    }) {
        return {
            model: 'stub-model',
            setModel: jest.fn(),
            chat: jest.fn().mockImplementation(
                (_msgs: unknown, _o: unknown, _onToken: unknown, advanced?: {
                    onActivity?: () => void; signal?: AbortSignal;
                }) => new Promise((resolve, reject) => {
                    if (opts.activityDelayMs !== undefined) {
                        setTimeout(() => advanced?.onActivity?.(), opts.activityDelayMs);
                    }
                    const done = setTimeout(() => resolve({
                        role: 'assistant', content: '',
                        tool_calls: [{ type: 'function', id: 'c1', function: { name: 't', arguments: {} } }],
                        metrics: { prompt_tokens: 10, completion_tokens: 5 },
                    }), opts.completeAfterMs);
                    if (opts.signalAware) {
                        advanced?.signal?.addEventListener('abort', () => {
                            clearTimeout(done);
                            reject(new Error('aborted'));
                        });
                    }
                }),
            ),
        } as never;
    }

    it('tool-call-only 응답: 첫 SSE 청크(onActivity)가 fast-fail 을 취소해 완료까지 생존', async () => {
        process.env.LLM_FAST_FAIL_TIMEOUT_MS = '100';
        const provider = new LocalLLMProvider(makeClientStub({
            activityDelayMs: 20,     // 100ms 한도 이전에 활동 신호
            completeAfterMs: 300,    // 완료는 한도(100ms) 이후 — 구 코드라면 fast-fail 로 사망
        }));
        const result = await provider.streamChat(
            { modelId: 'stub-model', messages: [{ role: 'user', content: 'x' }] } as never,
            {},
        );
        expect(result.toolCalls).toHaveLength(1);
    });

    it('활동 신호 전무: fast-fail 발동 → fallback 재시도(2회 호출, 재시도는 fast-fail 미적용)', async () => {
        process.env.LLM_FAST_FAIL_TIMEOUT_MS = '100';
        const client = makeClientStub({
            completeAfterMs: 500,    // 활동 신호 없음 — 첫 시도는 100ms fast-fail 로 사망
            signalAware: true,
        });
        const provider = new LocalLLMProvider(client);
        const result = await provider.streamChat(
            { modelId: 'stub-model', messages: [{ role: 'user', content: 'x' }] } as never,
            {},
        );
        // 첫 시도 fast-fail → retried=true 재호출 (fast-fail 0) → 완료
        expect((client as { chat: jest.Mock }).chat).toHaveBeenCalledTimes(2);
        expect(result.toolCalls).toHaveLength(1);
    });

    it('대형 프롬프트: prefill 보정으로 base 한도를 넘겨도 fast-fail 미발동 (2026-07-14 회귀)', async () => {
        process.env.LLM_FAST_FAIL_TIMEOUT_MS = '100';
        const client = makeClientStub({
            completeAfterMs: 400,    // base(100ms) 초과 — 고정 한도였다면 fast-fail 로 사망
            signalAware: true,
        });
        const provider = new LocalLLMProvider(client);
        // 한글 1000자 ≈ 1050 토큰 → prefill 보정 약 +1s → 유효 한도가 완료 시점(400ms)을 덮음
        const result = await provider.streamChat(
            { modelId: 'stub-model', messages: [{ role: 'user', content: '가'.repeat(1000) }] } as never,
            {},
        );
        expect((client as { chat: jest.Mock }).chat).toHaveBeenCalledTimes(1);
        expect(result.toolCalls).toHaveLength(1);
    });
});
