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
 * - sdkType 은 legacy 'ollama' 유지 — DB CHECK 제약 + ExternalKeysRepo 호환. 별도 마이그레이션 phase 에서 변경.
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
 * IProvider 구현 — LLMClient 를 위임 호출하는 어댑터.
 */
export class LocalLLMProvider implements IProvider {
    readonly id = PROVIDER_ID;
    readonly sdkType: SdkType = 'ollama';  // legacy sdkType 식별자 유지
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

        // Fast-fail timeout — retried=false 호출에 한해 짧은 timeout 으로 응답 미수신 시 즉시 reject.
        // 정상 모델은 TTFT 가 수백 ms 이내 — default 5s 안전.
        // user signal (opts.abortSignal) 과는 완전 분리된 자체 Promise 사용 (자체 abort 를 user
        // abort 로 오인하여 fallback 을 건너뛰는 함정 방지).
        const FAST_FAIL_MS = retried ? 0 : parseInt(process.env.LLM_FAST_FAIL_TIMEOUT_MS || '5000', 10);
        let fastFailTimer: NodeJS.Timeout | null = null;
        const fastFailPromise = FAST_FAIL_MS > 0
            ? new Promise<never>((_, reject) => {
                fastFailTimer = setTimeout(
                    () => reject(new Error(`FAST_FAIL_TIMEOUT_EXCEEDED (${FAST_FAIL_MS}ms)`)),
                    FAST_FAIL_MS,
                );
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

            // 사용자 abort 는 fallback 안 함 (즉시 throw).
            // 자체 fast-fail timeout 은 opts.abortSignal 을 건드리지 않으므로 여기 분기에 안 걸림.
            if (opts.abortSignal?.aborted) {
                const message = err instanceof Error ? err.message : String(err);
                throw new ProviderError('UPSTREAM_ERROR', `LLM 호출이 중단되었습니다: ${message}`, err);
            }

            // Per-request fallback: backend connectivity 실패 시 같은 role 다른 모델로 1회 재시도.
            // retried=true 면 이미 fallback 시도 — 무한 loop 방지 위해 throw.
            if (!retried) {
                const { tryFallbackAfterFailure } = await import('./local-llm-fallback');
                const fallbackOpts = tryFallbackAfterFailure(opts.modelId, err);
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

