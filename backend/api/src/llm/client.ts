/**
 * ============================================================
 * LLMClient — vLLM/LiteLLM OpenAI-compatible thin wrapper
 * ============================================================
 *
 * Ollama 시절 OllamaClient 의 외부 시그니처를 유지하면서 내부는 OpenAI Node SDK
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
import { QuotaExceededError } from '../errors/quota-exceeded.error';
import { getApiUsageTracker } from './usage-tracker';
import { streamChat, nonStreamChat } from './stream-parser';
import { buildExtraBody } from './reasoning-adapter';
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
    private embeddingOpenai: OpenAI;
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
        const embeddingBaseUrl = getConfig().llmEmbeddingBaseUrl || this.config.baseUrl;
        this.embeddingOpenai = embeddingBaseUrl !== this.config.baseUrl
            ? new OpenAI({
                baseURL: embeddingBaseUrl,
                apiKey: this.config.apiKey && this.config.apiKey.length > 0 ? this.config.apiKey : 'sk-no-key',
                timeout: this.config.timeout,
            })
            : this.openai;
        logger.debug(`LLMClient init: chat=${this.config.baseUrl} embed=${embeddingBaseUrl} (model=${this.config.model})`);
    }

    get model(): string {
        return this.config.model;
    }

    setModel(model: string): void {
        this.config.model = model;
    }

    private checkQuota(): void {
        try {
            const tracker = getApiUsageTracker();
            const quota = tracker.getQuotaStatus();
            if (quota.hourly.remaining <= 0 && quota.weekly.remaining <= 0) {
                throw new QuotaExceededError('both', quota.weekly.used, quota.weekly.limit);
            }
            if (quota.hourly.remaining <= 0) {
                throw new QuotaExceededError('hourly', quota.hourly.used, quota.hourly.limit);
            }
            if (quota.weekly.remaining <= 0) {
                throw new QuotaExceededError('weekly', quota.weekly.used, quota.weekly.limit);
            }
        } catch (e) {
            if (e instanceof QuotaExceededError) throw e;
            logger.warn('Quota check failed (non-blocking):', e);
        }
    }

    async chat(
        messages: ChatMessage[],
        options?: ModelOptions,
        onToken?: (token: string, thinking?: string) => void,
        advancedOptions?: {
            think?: ThinkOption;
            format?: FormatOption;
            tools?: ToolDefinition[];
            keep_alive?: string | number;
        },
    ): Promise<ChatMessage & { metrics?: UsageMetrics }> {
        this.checkQuota();
        const request: ChatRequest = {
            model: this.config.model,
            messages,
            stream: !!onToken,
            options,
            ...(advancedOptions?.think !== undefined && { think: advancedOptions.think }),
            ...(advancedOptions?.format && { format: advancedOptions.format }),
            ...(advancedOptions?.tools && { tools: advancedOptions.tools }),
        };
        const extraBody = buildExtraBody(advancedOptions?.think);

        return withSpan(
            'llm-client',
            'llm.chat',
            async (span) => {
                const result = onToken
                    ? await streamChat(this.openai, request, onToken, extraBody)
                    : await nonStreamChat(this.openai, request, extraBody);
                const totalTokens =
                    (result.metrics?.prompt_eval_count ?? 0) + (result.metrics?.eval_count ?? 0);
                if (totalTokens > 0) getApiUsageTracker().record(totalTokens);
                span.setAttribute('llm.prompt_eval_count', result.metrics?.prompt_eval_count ?? 0);
                span.setAttribute('llm.eval_count', result.metrics?.eval_count ?? 0);
                span.setAttribute('llm.response_chars', (result.content ?? '').length);
                return result;
            },
            {
                attributes: {
                    'llm.model': this.config.model,
                    'llm.message_count': messages.length,
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
     * 주의: 기존 OllamaClient.generate() 의 context: number[] 반환은 지원하지 않습니다.
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
            },
        );
        return { response: result.content, metrics: result.metrics };
    }

    async embed(text: string, model?: string): Promise<number[]> {
        const embeddingModel = model || getConfig().llmEmbeddingModel;
        const res = await this.embeddingOpenai.embeddings.create({
            model: embeddingModel,
            input: text,
        } as never);
        const data = (res as unknown as { data?: Array<{ embedding?: number[] }> }).data;
        if (!data || !data[0] || !data[0].embedding) {
            throw new Error('Embedding 응답에 벡터가 없습니다');
        }
        return data[0].embedding;
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
    async showModel(model: string, _verbose?: boolean): Promise<ShowModelResponse> {
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
