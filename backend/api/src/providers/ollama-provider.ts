/**
 * ============================================================
 * OllamaProvider - 기존 OllamaClient 의 IProvider 어댑터
 * ============================================================
 *
 * 기존 `OllamaClient` 를 `IProvider` 인터페이스 규약으로 래핑하는
 * 얇은 어댑터입니다. OllamaClient 의 코드는 단 한 줄도 수정하지
 * 않으며, Phase 1 단일 로컬 모델(`gemma4:e4b`) 회귀 0 을 최우선으로
 * 합니다.
 *
 * 매핑 요약:
 * - chat()           ⇄ streamChat()  (onToken/onThinking 분리, metrics 정규화)
 * - listModels()     ⇄ listModels()  (fullId='ollama:<name>' 빌드)
 * - isAvailable()    ⇄ validateCredentials()
 * - embed()          ⇄ embed()
 *
 * @module providers/ollama-provider
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
import type { OllamaClient } from '../ollama/client';
import type { ToolCall, UsageMetrics } from '../ollama/types';
import { MODEL_CAPABILITY_PRESETS } from '../config/model-defaults';
import { createLogger } from '../utils/logger';

const logger = createLogger('OllamaProvider');

const PROVIDER_ID = 'ollama';
const PROVIDER_DISPLAY_NAME = 'Local Ollama';

// ----------------------------------------------------------------
// 모델 메타데이터 기본값
// ----------------------------------------------------------------
// `ollama show` 호출 없이 보수적으로 추정한 컨텍스트/출력 한도.
// 단일 로컬 모델 환경에서 라우터가 최소한의 수치를 알 수 있도록 제공한다.
// Phase 2 이후 모델별 정확한 값을 `ollama show` 또는 config 로부터 로드하도록 확장 예정.
const DEFAULT_CONTEXT_WINDOW = 8192;
const DEFAULT_OUTPUT_LIMIT = 4096;

/**
 * 어댑터 내부의 보수적 기본 capabilities — PRESETS 미정의 모델에 사용.
 * `chat/model-selector.ts` 의 fallback 정책과 일치시켜 라우팅 일관성을 유지한다.
 */
const FALLBACK_CAPABILITIES: ProviderCapabilities = {
    streaming: true,
    toolCalling: false,
    thinking: false,
    vision: false,
    embedding: false,
};

/**
 * IProvider 구현 — 기존 OllamaClient 를 위임 호출하는 어댑터.
 */
export class OllamaProvider implements IProvider {
    readonly id = PROVIDER_ID;
    readonly sdkType: SdkType = 'ollama';
    readonly displayName = PROVIDER_DISPLAY_NAME;

    constructor(private client: OllamaClient) {}

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
            // 채팅 모델은 embedding 미지원 — 별도 임베딩 모델(nomic-embed-text 등) 사용.
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
        // OllamaClient 는 생성 시 config.model 이 고정된다. opts.modelId 가
        // 다르면 회귀 방지를 위해 throw 하지 않고 warning 만 남긴다.
        // (Phase 1 단일 모델 환경 가정. Phase 2 이후 라우터에서 client.setModel()
        //  도입 시 이 분기를 정상 흐름으로 승격한다.)
        if (opts.modelId !== this.client.model) {
            logger.warn(
                `[streamChat] modelId mismatch — requested='${opts.modelId}', client='${this.client.model}'. ` +
                'Phase 1: 단일 모델 환경이므로 client 모델로 진행합니다.',
            );
        }

        try {
            // OllamaClient.chat 의 onToken 콜백은 (token, thinking?) 합쳐서 받음.
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

            // 사용량 메트릭 — IProvider.ChatStreamResult.usage 는 UsageMetrics 타입을
            // 그대로 노출하므로 Ollama 원본 필드명(prompt_eval_count/eval_count)을 유지한다.
            const usage: UsageMetrics = result.metrics ?? {};
            callbacks.onUsage?.(usage);

            // tool_calls 정규화: ToolCall (function-shape) → IProvider {id, name, args}
            // Ollama 는 tool_call 별 id 를 별도로 부여하지 않으므로 합성 id 를 발급한다.
            const toolCalls = (result.tool_calls ?? []).map((tc: ToolCall, idx: number) => ({
                id: `ollama-tool-${Date.now()}-${idx}`,
                name: tc.function.name,
                args: tc.function.arguments,
            }));

            // tool_calls 이 있으면 callbacks.onToolCall 로도 즉시 전달 (옵션)
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
                    ? `Ollama 호출이 중단되었습니다: ${message}`
                    : `Ollama 호출 실패: ${message}`,
                err,
            );
        }
    }

    async embed(text: string, modelId: string): Promise<number[]> {
        try {
            return await this.client.embed(text, modelId);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new ProviderError('UPSTREAM_ERROR', `Ollama embed 실패: ${message}`, err);
        }
    }
}
