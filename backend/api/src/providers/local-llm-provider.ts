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
    embedding: false,
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
            embedding: false,
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
        // LLMClient 는 생성 시 config.model 이 고정된다.
        // opts.modelId 가 다르면 회귀 방지를 위해 warning 만 남긴다.
        if (opts.modelId !== this.client.model) {
            logger.warn(
                `[streamChat] modelId mismatch — requested='${opts.modelId}', client='${this.client.model}'. ` +
                'client 모델로 진행합니다.',
            );
        }

        try {
            // LLMClient.chat 의 onToken 콜백은 (token, thinking?) 합쳐서 받음.
            // IProvider 의 분리된 onToken / onThinking 으로 매핑.
            const onTokenCombined = (token: string, thinking?: string): void => {
                if (thinking) callbacks.onThinking?.(thinking);
                if (token) callbacks.onToken?.(token);
            };

            const result = await this.client.chat(
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
            const message = err instanceof Error ? err.message : String(err);
            throw new ProviderError(
                'UPSTREAM_ERROR',
                opts.abortSignal?.aborted
                    ? `LLM 호출이 중단되었습니다: ${message}`
                    : `LLM 호출 실패: ${message}`,
                err,
            );
        }
    }

    async embed(text: string, modelId: string): Promise<number[]> {
        try {
            return await this.client.embed(text, modelId);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new ProviderError('UPSTREAM_ERROR', `LLM embed 실패: ${message}`, err);
        }
    }
}

