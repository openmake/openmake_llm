/**
 * ============================================================
 * LocalLLMProvider - LLMClient 의 IProvider 어댑터
 * ============================================================
 *
 * `LLMClient` (vLLM/LiteLLM 호환) 를 `IProvider` 인터페이스 규약으로 래핑하는
 * 얇은 어댑터입니다.
 *
 * 매핑 요약:
 * - chat()           ⇄ streamChat()  (onToken/onThinking 분리, metrics 정규화)
 * - listModels()     ⇄ listModels()  (fullId='local-llm:<name>' 빌드, parseFullModelId 가 legacy 'ollama:' 도 인식)
 * - isAvailable()    ⇄ validateCredentials()
 * - embed()          ⇄ embed()
 *
 * 주의:
 * - PROVIDER_ID 는 canonical 'local-llm' (vLLM/LiteLLM 진입점). buildFullModelId/parseFullModelId
 *   가 legacy 'ollama' 입력을 자동 normalize 하므로 운영 중 저장된 'ollama:<model>' 도 무중단 호환.
 * - sdkType 도 canonical 'local-llm' (2026-05 vLLM 마이그레이션 잔재 정리). 로컬 provider 는 외부 키
 *   테이블에 저장되지 않아 DB CHECK('anthropic'|'openai-compatible')와 무관 — 'ollama' 불필요.
 *
 * @module providers/local-llm-provider
 */

import {
    IProvider,
    SdkType,
    ProviderCapabilities,
    ProviderModel,
    ChatStreamOptions,
    ChatStreamCallbacks,
    ChatStreamResult,
    buildFullModelId,
} from './i-provider';
import { ProviderError } from './provider-errors';
import type { LLMClient } from '../llm';
import type { ToolCall, UsageMetrics } from '../llm';
import { MODEL_CAPABILITY_PRESETS } from '../config/model-defaults';
import { createLogger } from '../utils/logger';

const logger = createLogger('LocalLLMProvider');

/**
 * Canonical provider ID — vLLM/LiteLLM 진입점. parseFullModelId 가 legacy 'ollama:' 도 normalize.
 */
const PROVIDER_ID = 'local-llm';
const PROVIDER_DISPLAY_NAME = 'Local LLM';

const DEFAULT_CONTEXT_WINDOW = 8192;
const DEFAULT_OUTPUT_LIMIT = 4096;

/**
 * 어댑터 내부의 보수적 기본 capabilities — PRESETS 미정의 모델에 사용.
 */
const FALLBACK_CAPABILITIES: ProviderCapabilities = {
    streaming: true,
    toolCalling: false,
    thinking: false,
    vision: false,
};

/**
 * 두 AbortSignal 을 합쳐 어느 한쪽이 abort 되면 결과 signal 도 abort.
 * `AbortSignal.any` (Node 19+) 의 수동 구현 — Node 18 호환.
 *
 * 분기 정확성은 호출처가 원본 a/b 의 aborted 상태를 별도로 검사하여 보장.
 */
function combineSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
    if (!a) return b;
    if (!b) return a;
    if (a.aborted || b.aborted) {
        const c = new AbortController();
        c.abort();
        return c.signal;
    }
    const combined = new AbortController();
    const onAbort = (): void => combined.abort();
    a.addEventListener('abort', onAbort, { once: true });
    b.addEventListener('abort', onAbort, { once: true });
    return combined.signal;
}

/**
 * IProvider 구현 — LLMClient 를 위임 호출하는 어댑터.
 */
export class LocalLLMProvider implements IProvider {
    readonly id = PROVIDER_ID;
    readonly sdkType: SdkType = 'local-llm';
    readonly displayName = PROVIDER_DISPLAY_NAME;

    constructor(private client: LLMClient) {}

    /**
     * 모델 ID 의 prefix(첫 ':' 앞 segment)를 키로 PRESETS 룩업.
     * 미정의 시 보수적 기본값을 반환한다.
     */
    getCapabilities(modelId: string): ProviderCapabilities {
        const prefix = modelId.split(':')[0];
        const preset = MODEL_CAPABILITY_PRESETS[prefix];
        if (!preset) {
            return { ...FALLBACK_CAPABILITIES };
        }
        return {
            streaming: preset.streaming,
            toolCalling: preset.toolCalling,
            thinking: preset.thinking,
            vision: preset.vision,
        };
    }

    async listModels(): Promise<ProviderModel[]> {
        const res = await this.client.listModels();
        const list = res.models ?? [];
        return list.map((m) => ({
            id: m.name,
            fullId: buildFullModelId(PROVIDER_ID, m.name),
            displayName: m.name,
            contextWindow: DEFAULT_CONTEXT_WINDOW,
            outputLimit: DEFAULT_OUTPUT_LIMIT,
            capabilities: this.getCapabilities(m.name),
        }));
    }

    async validateCredentials(): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
        const start = Date.now();
        try {
            const ok = await this.client.isAvailable();
            return { ok, latencyMs: Date.now() - start };
        } catch (err) {
            return {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
                latencyMs: Date.now() - start,
            };
        }
    }

    async streamChat(
        opts: ChatStreamOptions,
        callbacks: ChatStreamCallbacks,
    ): Promise<ChatStreamResult> {
        return this.streamChatOnce(opts, callbacks, /* retried */ false);
    }

    /**
     * 단일 호출 시도 + 실패 시 1회 fallback 재시도.
     * retried=true 면 fallback 시도 자체 — 재진입 막음.
     */
    private async streamChatOnce(
        opts: ChatStreamOptions,
        callbacks: ChatStreamCallbacks,
        retried: boolean,
    ): Promise<ChatStreamResult> {
        // opts.modelId 가 client.model 과 다르면 client.setModel 로 동기화 (fallback retry 시).
        if (opts.modelId !== this.client.model) {
            if (retried) {
                this.client.setModel(opts.modelId);
            } else {
                logger.warn(
                    `[streamChat] modelId mismatch — requested='${opts.modelId}', client='${this.client.model}'. ` +
                    'client 모델로 진행합니다.',
                );
            }
        }

        // Fast-fail timeout — retried=false 호출에 한해 짧은 timeout 으로 TTFT race.
        // 정상 모델은 TTFT 가 수백 ms 이내 — default 5s 안전.
        //
        // 2단 메커니즘:
        //  1) fastFailController.abort() → SDK request cancel (upstream HTTP 즉시 종료, orphan 방지)
        //  2) Promise.race reject → catch 진입 (SDK 의 mid-stream abort 는 silent 종료라
        //     race 없이는 fallback 미발동)
        //
        // user signal (opts.abortSignal) 과는 별도 controller — 자체 abort 를 user abort 로
        // 오인하여 fallback 을 건너뛰는 함정 방지.
        const FAST_FAIL_MS = retried ? 0 : parseInt(process.env.LLM_FAST_FAIL_TIMEOUT_MS || '5000', 10);
        const fastFailController = FAST_FAIL_MS > 0 ? new AbortController() : null;
        let fastFailTimer: NodeJS.Timeout | null = null;
        const fastFailPromise = fastFailController
            ? new Promise<never>((_, reject) => {
                fastFailTimer = setTimeout(() => {
                    fastFailController.abort();
                    reject(new Error(`FAST_FAIL_TIMEOUT_EXCEEDED (${FAST_FAIL_MS}ms)`));
                }, FAST_FAIL_MS);
                fastFailTimer.unref?.();
            })
            : null;

        try {
            // LLMClient.chat 의 onToken 콜백은 (token, thinking?) 합쳐서 받음.
            // IProvider 의 분리된 onToken / onThinking 으로 매핑.
            //
            // Fast-fail 은 TTFT(첫 토큰 수신) 만 race — 첫 토큰 도착 시 timer 취소하여
            // long-response (긴 답변) 가 5초 넘어도 잘리지 않도록 한다.
            const onTokenCombined = (token: string, thinking?: string): void => {
                if (fastFailTimer && (token || thinking)) {
                    clearTimeout(fastFailTimer);
                    fastFailTimer = null;
                }
                if (thinking) callbacks.onThinking?.(thinking);
                if (token) callbacks.onToken?.(token);
            };

            const chatPromise = this.client.chat(
                opts.messages,
                {
                    temperature: opts.temperature,
                    num_predict: opts.maxTokens,
                },
                onTokenCombined,
                {
                    think: typeof opts.thinking === 'object'
                        ? true
                        : opts.thinking,
                    tools: opts.tools,
                    // user signal (opts.abortSignal) + self fast-fail signal 결합 전달 — 어느 쪽이
                    // abort 해도 SDK upstream 즉시 종료. catch 분기는 원본 signal 의 aborted 로 구분.
                    ...((fastFailController || opts.abortSignal)
                        ? { signal: combineSignals(fastFailController?.signal, opts.abortSignal) }
                        : {}),
                },
            );

            const result = fastFailPromise
                ? await Promise.race([chatPromise, fastFailPromise])
                : await chatPromise;
            if (fastFailTimer) clearTimeout(fastFailTimer);

            // 사용량 메트릭 — UsageMetrics 타입 그대로 노출 (prompt_eval_count/eval_count).
            const usage: UsageMetrics = result.metrics ?? {};
            callbacks.onUsage?.(usage);

            // tool_calls 정규화: ToolCall (function-shape) → IProvider {id, name, args}
            const toolCalls = (result.tool_calls ?? []).map((tc: ToolCall, idx: number) => ({
                id: `local-llm-tool-${Date.now()}-${idx}`,
                name: tc.function.name,
                args: tc.function.arguments,
            }));

            if (callbacks.onToolCall) {
                for (const call of toolCalls) callbacks.onToolCall(call);
            }

            return {
                content: result.content ?? '',
                ...(result.thinking ? { thinking: result.thinking } : {}),
                ...(toolCalls.length > 0 ? { toolCalls } : {}),
                usage,
                finishReason: opts.abortSignal?.aborted
                    ? 'aborted'
                    : toolCalls.length > 0
                        ? 'tool_calls'
                        : 'stop',
            };
        } catch (err) {
            if (fastFailTimer) clearTimeout(fastFailTimer);

            // [분기 1] user abort — 항상 즉시 throw
            if (opts.abortSignal?.aborted) {
                const message = err instanceof Error ? err.message : String(err);
                throw new ProviderError('UPSTREAM_ERROR', `LLM 호출이 중단되었습니다: ${message}`, err);
            }

            // [분기 2] self fast-fail abort — SDK 가 'Request was aborted' 등 임의 메시지로 throw 해도
            // controller.signal.aborted 가 ground truth. SDK 메시지 의존 회피 (버전 간 불안정).
            const selfAborted = fastFailController?.signal.aborted ?? false;
            const errForFallback = selfAborted
                ? new Error(`FAST_FAIL_TIMEOUT_EXCEEDED (${FAST_FAIL_MS}ms, self-abort)`)
                : err;

            // [분기 3] retried=false 면 fallback 시도. self-aborted 는 강제 fallbackable 로 위장.
            if (!retried) {
                const { tryFallbackAfterFailure } = await import('./local-llm-fallback');
                const fallbackOpts = tryFallbackAfterFailure(opts.modelId, errForFallback);
                if (fallbackOpts) {
                    logger.warn(
                        `[streamChat] ${opts.modelId} 실패 → fallback ${fallbackOpts.fallbackModelId} 재시도`,
                    );
                    return this.streamChatOnce(
                        { ...opts, modelId: fallbackOpts.fallbackModelId },
                        callbacks,
                        true,
                    );
                }
            }

            const message = err instanceof Error ? err.message : String(err);
            throw new ProviderError('UPSTREAM_ERROR', `LLM 호출 실패: ${message}`, err);
        }
    }

}

