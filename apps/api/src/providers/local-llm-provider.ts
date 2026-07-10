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
 * - listModels()     ⇄ listModels()  (fullId='local-llm:<name>' 빌드)
 * - isAvailable()    ⇄ validateCredentials()
 * - embed()          ⇄ embed()
 *
 * 주의:
 * - PROVIDER_ID / sdkType 은 canonical 'local-llm' (vLLM/LiteLLM 진입점). 로컬 provider 는
 *   외부 키 테이블에 저장되지 않아 DB CHECK('anthropic'|'openai-compatible')와 무관.
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
import { matchCapabilityPreset, FALLBACK_CAPABILITIES } from '../config/model-defaults';
import { LLM_ANTI_DEGENERATION_FREQUENCY_PENALTY } from '../config/llm-parameters';
import { createLogger } from '../utils/logger';

const logger = createLogger('LocalLLMProvider');

/**
 * Canonical provider ID — vLLM/LiteLLM 진입점.
 */
const PROVIDER_ID = 'local-llm';
const PROVIDER_DISPLAY_NAME = 'Local LLM';

const DEFAULT_CONTEXT_WINDOW = 8192;
const DEFAULT_OUTPUT_LIMIT = 4096;

/**
 * 두 AbortSignal 을 합쳐 어느 한쪽이 abort 되면 결과 signal 도 abort.
 * 표준 `AbortSignal.any` (Node 20.3+ 안정) 사용 — 이미 abort 된 signal 도 즉시 반영.
 *
 * 분기 정확성은 호출처가 원본 a/b 의 aborted 상태를 별도로 검사하여 보장.
 */
function combineSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
    if (!a) return b;
    if (!b) return a;
    return AbortSignal.any([a, b]);
}

/**
 * IProvider 구현 — LLMClient 를 위임 호출하는 어댑터.
 */
export class LocalLLMProvider implements IProvider {
    readonly id = PROVIDER_ID;
    readonly sdkType: SdkType = 'local-llm';
    readonly displayName = PROVIDER_DISPLAY_NAME;

    constructor(private client: LLMClient) {}

    /** modelId 를 공유 매처(startsWith-longest)로 룩업; 미정의 시 보수적 FALLBACK. */
    getCapabilities(modelId: string): ProviderCapabilities {
        const caps = matchCapabilityPreset(modelId);
        return caps ? { ...caps } : { ...FALLBACK_CAPABILITIES };
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
            // Fast-fail 은 "업스트림 생존" 확인까지만 race — 첫 SSE 청크(onActivity) 도착 시
            // timer 취소하여 long-response 가 timeout 을 넘어도 잘리지 않도록 한다.
            // onActivity 는 content 토큰 없이 tool_calls delta 만 오는 응답에서도 발화 —
            // (구) onToken(content/thinking) 기준 취소는 tool-call-only 응답이 timeout 을
            // 넘기면 정상 스트림을 끊는 결함이 있었다 (2026-07-04 수정).
            const clearFastFail = (): void => {
                if (fastFailTimer) {
                    clearTimeout(fastFailTimer);
                    fastFailTimer = null;
                }
            };
            const onTokenCombined = (token: string, thinking?: string): void => {
                if (token || thinking) clearFastFail();
                if (thinking) callbacks.onThinking?.(thinking);
                if (token) callbacks.onToken?.(token);
            };

            const chatPromise = this.client.chat(
                opts.messages,
                {
                    temperature: opts.temperature,
                    num_predict: opts.maxTokens,
                    // 반복(degeneration) 방지 — 로컬 모델이 동일 토큰을 무한 반복하며
                    // 응답이 붕괴하는 것을 억제. vLLM native frequency_penalty (0=미적용).
                    ...(LLM_ANTI_DEGENERATION_FREQUENCY_PENALTY > 0
                        ? { frequency_penalty: LLM_ANTI_DEGENERATION_FREQUENCY_PENALTY }
                        : {}),
                },
                onTokenCombined,
                {
                    think: typeof opts.thinking === 'object'
                        ? true
                        : opts.thinking,
                    tools: opts.tools,
                    ...(opts.tool_choice !== undefined ? { tool_choice: opts.tool_choice } : {}),
                    // 첫 SSE 청크 = 업스트림 생존 — fast-fail 취소 (tool-call-only 응답 포함).
                    onActivity: clearFastFail,
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

            // 사용량 메트릭 — UsageMetrics 타입 그대로 노출 (prompt_tokens/completion_tokens).
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
                        // max_tokens 절단('length')을 보존 — 무고지 절단 관측/UX 신호 유지
                        : (usage.finish_reason === 'length' ? 'length' : 'stop'),
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

