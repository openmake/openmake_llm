/**
 * ============================================================
 * LLMClient — vLLM/LiteLLM OpenAI-compatible thin wrapper
 * ============================================================
 *
 * 기존 LLMClient 외부 시그니처를 유지하면서 내부는 OpenAI Node SDK
 * 호출로 위임합니다 — 호출자 100+ 곳의 변경 최소화가 목표입니다.
 *
 * 위임 원칙:
 *   - chat()       → /v1/chat/completions (SSE 스트림)
 *   - generate()   → chat() 으로 위임 (vLLM /v1/completions 보다 안정적)
 *   - embed()      → /v1/embeddings
 *   - listModels() → /v1/models
 *   - isAvailable()→ /v1/models 호출 성공 여부
 *   - showModel/listRunningModels — vLLM 미지원, 호환을 위해 빈 응답
 *   - webSearch/webFetch — MCP 도구 어댑터 위임
 *
 * @module llm/client
 */
import OpenAI from 'openai';
import { getConfig } from '../config';
import { createLogger } from '../utils/logger';
import { withSpan } from '../observability/otel';
import { getApiUsageTracker } from './usage-tracker';
import { checkUserQuota, recordUserUsage } from './user-quota';
import { streamChat, nonStreamChat } from './stream-parser';
import { buildExtraBody } from './reasoning-adapter';
import { selectModelByCapacity } from './model-pool';
import { MODEL_POOL_CONFIG } from '../config/model-pool';
import {
    webSearch as webSearchAdapter,
    webFetch as webFetchAdapter,
} from './web-search-adapter';
import type {
    LLMConfig,
    ChatMessage,
    ChatRequest,
    ModelOptions,
    ThinkOption,
    FormatOption,
    ToolDefinition,
    UsageMetrics,
    ListModelsResponse,
    ShowModelResponse,
    PsResponse,
    WebSearchResponse,
    WebFetchResponse,
} from './types';
import { runAgentLoop, type AgentLoopResult } from './agent-loop';

const logger = createLogger('LLMClient');

export class LLMClient {
    private openai: OpenAI;
    private config: LLMConfig;

    constructor(config: Partial<LLMConfig> = {}) {
        const cfg = getConfig();
        this.config = {
            baseUrl: cfg.llmBaseUrl,
            apiKey: cfg.llmApiKey,
            model: cfg.llmDefaultModel,
            timeout: cfg.llmTimeout,
            ...config,
        };
        this.openai = new OpenAI({
            baseURL: this.config.baseUrl,
            apiKey: this.config.apiKey && this.config.apiKey.length > 0 ? this.config.apiKey : 'sk-no-key',
            timeout: this.config.timeout,
        });
        logger.debug(`LLMClient init: chat=${this.config.baseUrl} (model=${this.config.model})`);
    }

    get model(): string {
        return this.config.model;
    }

    /**
     * 현재 설정(baseUrl/apiKey/model/userId 포함)을 유지한 채 일부만 덮어쓴
     * 파생 클라이언트를 만든다. role 해석된 외부 endpoint 클라이언트에
     * 전용 timeout 만 바꿔 쓰는 용도 (report-generator, review 류) —
     * createClient({ model: client.model }) 재파생은 외부 baseUrl 을 잃는다.
     */
    derive(overrides: Partial<LLMConfig>): LLMClient {
        return new LLMClient({ ...this.config, ...overrides });
    }

    setModel(model: string): void {
        this.config.model = model;
    }

    private async checkQuota(): Promise<void> {
        // per-user enforcement (KVStore 기반, 멀티프로세스 정합). 전역 tracker 는
        // record 경로에서 관측(dashboard)용으로만 누적 — "한 사용자 소진 시 전체 차단" 버그 제거.
        // fail-open 은 checkUserQuota 내부 처리 (QuotaExceededError 만 throw).
        await checkUserQuota(this.config.userId, Date.now());
    }

    async chat(
        messages: ChatMessage[],
        options?: ModelOptions,
        onToken?: (token: string, thinking?: string) => void,
        advancedOptions?: {
            think?: ThinkOption;
            format?: FormatOption;
            tools?: ToolDefinition[];
            tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
            keep_alive?: string | number;
            /** OpenAI SDK request cancel — abort 시 upstream HTTP 요청 즉시 종료 (orphan 방지) */
            signal?: AbortSignal;
            /**
             * 첫 SSE 청크 수신 시 1회 호출 (streaming 한정) — 호출자의 TTFT
             * fast-fail 타이머 취소용. tool-call-only 응답에서도 발화한다.
             */
            onActivity?: () => void;
        },
    ): Promise<ChatMessage & { metrics?: UsageMetrics }> {
        await this.checkQuota();

        // Model Pool routing — this.config.model 이 pool default 와 같을 때만 자동 선택.
        // 다른 model 로 인스턴스화 됐으면 manual 우회 (사용자 명시 모델 존중).
        const isDefaultModel = this.config.model === MODEL_POOL_CONFIG.defaultModel;
        const poolDecision = isDefaultModel
            ? selectModelByCapacity(messages, { num_predict: options?.num_predict })
            : { model: this.config.model, source: 'manual' as const };

        if (poolDecision.source !== 'manual') {
            const droppedStr = poolDecision.droppedMessages
                ? ` dropped=${poolDecision.droppedMessages}`
                : '';
            logger.info(
                `[ModelPool] routed=${poolDecision.model} source=${poolDecision.source}` +
                ` input=~${poolDecision.inputTokens ?? '?'}${droppedStr}`,
            );
        }

        // 통계 영속화 — fire-and-forget (운영자 모니터링용, audit 패턴).
        // 실패해도 chat 자체는 계속 진행.
        void (async () => {
            try {
                const { getPool } = await import('../data/models/unified-database');
                await getPool().query(
                    `INSERT INTO model_pool_metrics (model, source, input_tokens, dropped_messages)
                     VALUES ($1, $2, $3, $4)`,
                    [
                        poolDecision.model,
                        poolDecision.source,
                        poolDecision.inputTokens ?? null,
                        poolDecision.droppedMessages ?? null,
                    ],
                );
            } catch (err) {
                logger.warn(`[ModelPool] metric INSERT 실패 (continue):`, err);
            }
        })();

        const effectiveMessages = poolDecision.adjustedMessages ?? messages;
        const effectiveOptions: ModelOptions | undefined = poolDecision.adjustedMaxTokens !== undefined
            ? { ...(options ?? {}), num_predict: poolDecision.adjustedMaxTokens }
            : options;

        const request: ChatRequest = {
            model: poolDecision.model,
            messages: effectiveMessages,
            stream: !!onToken,
            options: effectiveOptions,
            ...(advancedOptions?.think !== undefined && { think: advancedOptions.think }),
            ...(advancedOptions?.format && { format: advancedOptions.format }),
            ...(advancedOptions?.tools && { tools: advancedOptions.tools }),
            ...(advancedOptions?.tool_choice !== undefined && { tool_choice: advancedOptions.tool_choice }),
        };
        const extraBody = buildExtraBody(advancedOptions?.think);

        return withSpan(
            'llm-client',
            'llm.chat',
            async (span) => {
                const result = onToken
                    ? await streamChat(this.openai, request, onToken, extraBody, advancedOptions?.signal,
                        undefined, advancedOptions?.onActivity)
                    : await nonStreamChat(this.openai, request, extraBody, advancedOptions?.signal);
                const totalTokens =
                    (result.metrics?.prompt_tokens ?? 0) + (result.metrics?.completion_tokens ?? 0);
                if (totalTokens > 0) {
                    getApiUsageTracker().record(totalTokens);  // 전역 aggregate (dashboard 관측용)
                    void recordUserUsage(this.config.userId, totalTokens, Date.now());  // per-user enforcement 누적
                    try {
                        this.config.onUsage?.({
                            model: poolDecision.model,
                            promptTokens: result.metrics?.prompt_tokens ?? 0,
                            completionTokens: result.metrics?.completion_tokens ?? 0,
                        });
                    } catch { /* 관측 훅 실패는 호출 결과에 영향 없음 */ }
                }
                span.setAttribute('llm.prompt_tokens', result.metrics?.prompt_tokens ?? 0);
                span.setAttribute('llm.completion_tokens', result.metrics?.completion_tokens ?? 0);
                span.setAttribute('llm.response_chars', (result.content ?? '').length);
                return result;
            },
            {
                attributes: {
                    'llm.model': poolDecision.model,
                    'llm.message_count': effectiveMessages.length,
                    'llm.stream': !!onToken,
                    'llm.has_tools': !!advancedOptions?.tools,
                    'llm.has_format': !!advancedOptions?.format,
                },
            },
        );
    }

    /**
     * /api/generate 호환 메서드 — 내부적으로 chat() 으로 위임.
     *
     * vLLM 의 /v1/completions 는 stop sequence 처리 등 미세한 quirks 가 있어
     * 표준화된 /v1/chat/completions 가 안정적입니다. system + user 단일 turn 으로 구성.
     *
     * 주의: 기존 LLMClient.generate() 의 context: number[] 반환은 지원하지 않습니다.
     * (호출자 7곳 검토 결과 context 사용처 없음 — 단일 호출만)
     */
    async generate(
        prompt: string,
        options?: ModelOptions,
        onToken?: (token: string) => void,
        images?: string[],
        advancedOptions?: {
            think?: ThinkOption;
            format?: FormatOption;
            system?: string;
            keep_alive?: string | number;
            /** chat() 와 동일 — fast-fail / warmup timeout 등 caller abort 전달 경로 */
            signal?: AbortSignal;
        },
    ): Promise<{ response: string; metrics?: UsageMetrics }> {
        const messages: ChatMessage[] = [];
        if (advancedOptions?.system) {
            messages.push({ role: 'system', content: advancedOptions.system });
        }
        messages.push({
            role: 'user',
            content: prompt,
            ...(images && images.length > 0 && { images }),
        });
        const result = await this.chat(
            messages,
            options,
            onToken ? (t) => onToken(t) : undefined,
            {
                ...(advancedOptions?.think !== undefined && { think: advancedOptions.think }),
                ...(advancedOptions?.format && { format: advancedOptions.format }),
                ...(advancedOptions?.signal && { signal: advancedOptions.signal }),
            },
        );
        return { response: result.content, metrics: result.metrics };
    }

    async listModels(): Promise<ListModelsResponse> {
        const list = await this.openai.models.list();
        return {
            models: list.data.map((m) => ({
                name: m.id,
                modified_at: '',
                size: 0,
                digest: '',
            })),
        };
    }

    /** vLLM 미지원 — 호환을 위해 빈 응답 반환 */
    async showModel(_model: string, _verbose?: boolean): Promise<ShowModelResponse> {
        return {
            modelfile: '',
            parameters: '',
            template: '',
            details: { parameter_size: '', quantization_level: '' },
            capabilities: ['completion'],
        };
    }

    /** vLLM 미지원 — listModels() 결과를 RunningModel 형태로 정규화 */
    async listRunningModels(): Promise<PsResponse> {
        const list = await this.listModels();
        return {
            models: list.models.map((m) => ({
                name: m.name,
                model: m.name,
                size: 0,
                digest: '',
            })),
        };
    }

    async isAvailable(): Promise<boolean> {
        try {
            await this.openai.models.list();
            return true;
        } catch {
            return false;
        }
    }

    /** Generate API context 와의 호환 — vLLM stateless, no-op */
    clearContext(): void {
        // no-op
    }

    async webSearch(query: string, maxResults = 5): Promise<WebSearchResponse> {
        return webSearchAdapter(query, maxResults);
    }

    async webFetch(url: string): Promise<WebFetchResponse> {
        return webFetchAdapter(url);
    }

    async runAgentLoop(
        messages: ChatMessage[],
        tools: ToolDefinition[],
        availableFunctions: Record<string, (args: Record<string, unknown>) => unknown | Promise<unknown>>,
        options?: {
            think?: ThinkOption;
            stream?: boolean;
            onToken?: (token: string, thinking?: string) => void;
            onToolCall?: (name: string, args: unknown, result: unknown) => void;
            maxIterations?: number;
        },
    ): Promise<AgentLoopResult> {
        return runAgentLoop({
            client: this,
            messages,
            tools,
            availableFunctions,
            ...(options?.think !== undefined && { think: options.think }),
            ...(options?.stream !== undefined && { stream: options.stream }),
            ...(options?.onToken && { onToken: options.onToken }),
            ...(options?.onToolCall && { onToolCall: options.onToolCall }),
            ...(options?.maxIterations !== undefined && { maxIterations: options.maxIterations }),
        });
    }
}

export const createClient = (config?: Partial<LLMConfig>): LLMClient => new LLMClient(config);
