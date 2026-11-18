/**
 * 채팅 경로 로컬 폴백 회귀 테스트.
 *
 * 배경(2026-07-26 점검): 역할 경로엔 4xx 로컬 강등이 있었지만 채팅에는 없어,
 * 기본 모델을 외부로 둔 사용자가 구독 한도(429)·세션 만료(401)를 만나면 대화가
 * 통째로 실패했다. 폴백은 "첫 토큰 이전"에만 수행해야 답변이 섞이지 않는다.
 */
import { streamFromExternalProvider } from '../external-fallback';
import { servedModelLabel } from '../provider-gate';
import type { ResolvedProvider } from '../../../providers/provider-router';
import { ProviderError } from '../../../providers/provider-errors';

type StreamImpl = (
    opts: unknown,
    cb: { onToken?: (t: string) => void; onUsage?: (u: unknown) => void },
) => Promise<unknown>;

function makeResolved(providerId: string, modelId: string, streamChat: StreamImpl): ResolvedProvider {
    return {
        providerId,
        modelId,
        fullId: `${providerId}:${modelId}`,
        provider: {
            id: providerId,
            sdkType: providerId === 'local-llm' ? 'local-llm' : 'openai-compatible',
            displayName: providerId,
            getCapabilities: () => ({ streaming: true, toolCalling: false, vision: true, thinking: false }),
            listModels: async () => [],
            validateCredentials: async () => ({ ok: true }),
            streamChat,
        },
    } as unknown as ResolvedProvider;
}

const okStream: StreamImpl = async (_opts, cb) => {
    cb.onToken?.('로컬응답');
    return { content: '로컬응답', usage: {}, finishReason: 'stop' };
};

function makeDeps(localResolved: ResolvedProvider) {
    return {
        currentUserContext: null,
        allowedTools: [],
        providerRouter: {
            resolve: jest.fn().mockResolvedValue(localResolved),
            getExternalKeysRepo: () => undefined,
        },
    } as never;
}

const baseReq = { message: '안녕', userId: 'u1', userRole: 'user' as const };

describe('streamFromExternalProvider — 외부 실패 시 로컬 폴백', () => {
    it('429(한도 초과)면 로컬로 1회 폴백해 답변을 완성한다', async () => {
        const failing = makeResolved('chatgpt', 'gpt-5.5', async () => {
            throw new ProviderError('QUOTA_EXCEEDED', '한도 초과');
        });
        const local = makeResolved('local-llm', 'qwen3.6-35b-a3b', okStream);
        const tokens: string[] = [];

        const out = await streamFromExternalProvider(
            makeDeps(local), failing, baseReq as never, (t) => { if (t) tokens.push(t); },
        );

        expect(out).toContain('로컬응답');
        expect(tokens).toEqual(['로컬응답']);
    });

    it('인증 실패(401 계열)도 폴백 대상', async () => {
        const failing = makeResolved('chatgpt', 'gpt-5.5', async () => {
            throw new ProviderError('INVALID_API_KEY', '세션 만료');
        });
        const local = makeResolved('local-llm', 'qwen3.6-35b-a3b', okStream);
        const out = await streamFromExternalProvider(makeDeps(local), failing, baseReq as never, () => {});
        expect(out).toContain('로컬응답');
    });

    it('이미 토큰을 내보낸 뒤 실패하면 폴백하지 않는다 (답변 섞임 방지)', async () => {
        const failing = makeResolved('chatgpt', 'gpt-5.5', async (_o, cb) => {
            cb.onToken?.('외부일부');
            throw new ProviderError('UPSTREAM_ERROR', '중간 끊김');
        });
        const local = makeResolved('local-llm', 'qwen3.6-35b-a3b', okStream);
        const tokens: string[] = [];

        await expect(
            streamFromExternalProvider(makeDeps(local), failing, baseReq as never, (t) => { if (t) tokens.push(t); }),
        ).rejects.toBeInstanceOf(ProviderError);
        expect(tokens).toEqual(['외부일부']); // 로컬 응답이 이어붙지 않아야 한다
    });

    // 무응답 시한(providers/stream-stall-watchdog) — 첫 청크 전 시한이면 보이는 토큰이 0 이라 폴백, 고지 사유 코드도 남는다.
    it('무응답 시한(UPSTREAM_TIMEOUT)이 첫 토큰 전이면 로컬로 폴백하고 고지 코드에 남긴다', async () => {
        const failing = makeResolved('gemini', 'gemini-3.8-flash', async () => {
            throw new ProviderError('UPSTREAM_TIMEOUT', '외부 모델 무응답 시한 초과 (first_chunk, 120000ms)');
        });
        const local = makeResolved('local-llm', 'qwen3.6-35b-a3b', okStream);
        const events: Array<{ type: string; metadata?: { code?: string } }> = [];
        const deps = { ...(makeDeps(local) as object), onSystemEvent: (e: { type: string; metadata?: { code?: string } }) => events.push(e) };

        const out = await streamFromExternalProvider(deps as never, failing, baseReq as never, () => {});

        expect(out).toContain('로컬응답');
        expect(events.find((e) => e.type === 'model_fallback')?.metadata?.code).toBe('UPSTREAM_TIMEOUT');
    });

    it('토큰이 나간 뒤 무응답 시한(유휴)이면 폴백하지 않고 전파한다', async () => {
        const failing = makeResolved('gemini', 'gemini-3.8-flash', async (_o, cb) => {
            cb.onToken?.('외부일부');
            throw new ProviderError('UPSTREAM_TIMEOUT', '외부 모델 무응답 시한 초과 (idle, 120000ms)');
        });
        const local = makeResolved('local-llm', 'qwen3.6-35b-a3b', okStream);
        const tokens: string[] = [];

        const err = await streamFromExternalProvider(makeDeps(local), failing, baseReq as never, (t) => { if (t) tokens.push(t); })
            .then(() => null, (e: unknown) => e);
        expect((err as ProviderError).code).toBe('UPSTREAM_TIMEOUT');
        expect(tokens).toEqual(['외부일부']);
    });

    it('로컬 provider 실패는 폴백하지 않고 그대로 전파', async () => {
        const failing = makeResolved('local-llm', 'qwen3.6-35b-a3b', async () => {
            throw new ProviderError('UPSTREAM_ERROR', '로컬 다운');
        });
        const local = makeResolved('local-llm', 'qwen3.6-35b-a3b', okStream);
        await expect(
            streamFromExternalProvider(makeDeps(local), failing, baseReq as never, () => {}),
        ).rejects.toBeInstanceOf(ProviderError);
    });

    it('사용자 중단(abort)은 폴백하지 않는다', async () => {
        const ac = new AbortController();
        // 호출 도중 중단 — 이미 중단된 요청은 LLM 을 부르기 전에 'ABORTED' 로 끝난다(external-provider).
        const failing = makeResolved('chatgpt', 'gpt-5.5', async () => {
            ac.abort();
            throw new ProviderError('UPSTREAM_ERROR', '중단');
        });
        const local = makeResolved('local-llm', 'qwen3.6-35b-a3b', okStream);
        await expect(
            streamFromExternalProvider(
                makeDeps(local), failing, { ...baseReq, abortSignal: ac.signal } as never, () => {},
            ),
        ).rejects.toBeInstanceOf(ProviderError);
    });

    it('요청 자체 문제(400)는 재시도 무의미 — 폴백하지 않는다', async () => {
        const failing = makeResolved('chatgpt', 'gpt-5.5', async () => {
            const e = new Error('bad request') as Error & { status?: number };
            e.status = 400;
            throw e;
        });
        const local = makeResolved('local-llm', 'qwen3.6-35b-a3b', okStream);
        await expect(
            streamFromExternalProvider(makeDeps(local), failing, baseReq as never, () => {}),
        ).rejects.toThrow('bad request');
    });

    // 폴백은 배지로 고지되지만 응답의 model 이 그대로면 "선택한 모델이 답했다" 는
    // 기록이 남는다 — 실제 답한 모델로 갱신되는지 확인한다.
    it('폴백하면 실제 답한 모델(로컬)을 통지한다', async () => {
        const failing = makeResolved('chatgpt', 'gpt-5.5', async () => {
            throw new ProviderError('QUOTA_EXCEEDED', '한도 초과');
        });
        const local = makeResolved('local-llm', 'qwen3.6-35b-a3b', okStream);
        const served: string[] = [];

        await streamFromExternalProvider(
            makeDeps(local), failing,
            { ...baseReq, onServedModel: (m: string) => served.push(m) } as never,
            () => {},
        );

        expect(served).toEqual(['qwen3.6-35b-a3b']);
    });

    it('폴백이 없으면 통지하지 않는다 (gate 가 이미 알린 값 유지)', async () => {
        const ok = makeResolved('chatgpt', 'gpt-5.5', okStream);
        const local = makeResolved('local-llm', 'qwen3.6-35b-a3b', okStream);
        const served: string[] = [];

        await streamFromExternalProvider(
            makeDeps(local), ok,
            { ...baseReq, onServedModel: (m: string) => served.push(m) } as never,
            () => {},
        );

        expect(served).toEqual([]);
    });
});

describe('streamFromExternalProvider — 오케스트레이터 출처 발행', () => {
    const orchSources = [[{ n: 11, title: '날씨', url: 'https://w.x/11', snippet: 's' }]];

    it('폴백으로 스트림을 다시 돌려도 오케스트레이터 출처는 턴에 한 번만 발행하고, 답 끝 목록에는 그대로 쓴다', async () => {
        const failing = makeResolved('chatgpt', 'gpt-5.5', async () => {
            throw new ProviderError('QUOTA_EXCEEDED', '한도 초과');
        });
        const cited: StreamImpl = async (_opts, cb) => {
            cb.onToken?.('맑음 [출처 11]');
            return { content: '맑음 [출처 11]', usage: {}, finishReason: 'stop' };
        };
        const local = makeResolved('local-llm', 'qwen3.6-35b-a3b', cited);
        const deps = makeDeps(local) as unknown as { mcpToolResultCallback?: jest.Mock };
        deps.mcpToolResultCallback = jest.fn();

        const out = await streamFromExternalProvider(
            deps as never, failing, baseReq as never, () => {},
            { orchestratorSources: orchSources, orchestratorBlockInjected: true, sourceContextText: '질문' },
        );

        expect(deps.mcpToolResultCallback).toHaveBeenCalledTimes(1);
        expect(deps.mcpToolResultCallback).toHaveBeenCalledWith({ toolName: 'web.search', resources: [], sources: orchSources[0] });
        expect(out).toContain('(https://w.x/11)');
    });
});

describe('servedModelLabel — 표기 규약', () => {
    it('로컬은 bare model id (기존 응답 표기 유지)', () => {
        expect(servedModelLabel(makeResolved('local-llm', 'qwen3.6-35b-a3b', okStream)))
            .toBe('qwen3.6-35b-a3b');
    });

    it('외부는 fullId — 어느 provider 가 답했는지 드러난다', () => {
        expect(servedModelLabel(makeResolved('chatgpt', 'gpt-5.5', okStream)))
            .toBe('chatgpt:gpt-5.5');
    });
});
