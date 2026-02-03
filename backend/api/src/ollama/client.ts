import axios, { AxiosInstance } from 'axios';
import {
    OllamaConfig,
    GenerateRequest,
    GenerateResponse,
    ChatRequest,
    ChatResponse,
    ChatMessage,
    ListModelsResponse,
    ModelOptions,
    ThinkOption,
    FormatOption,
    ToolDefinition,
    ToolCall,
    EmbedRequest,
    EmbedResponse,
    UsageMetrics,
    WebSearchRequest,
    WebSearchResponse,
    WebFetchRequest,
    WebFetchResponse
} from './types';
import { getConfig } from '../config';
import { createLogger } from '../utils/logger';
import { getApiKeyManager, ApiKeyManager } from './api-key-manager';
import { getApiUsageTracker } from './api-usage-tracker';
import { QuotaExceededError } from '../errors/quota-exceeded.error';
import { runAgentLoop, AgentLoopOptions, AgentLoopResult } from './agent-loop';

const logger = createLogger('OllamaClient');

const envConfig = getConfig();

const DEFAULT_CONFIG: OllamaConfig = {
    baseUrl: envConfig.ollamaBaseUrl,
    model: envConfig.ollamaDefaultModel,
    timeout: envConfig.ollamaTimeout
};

export class OllamaClient {
    private client: AxiosInstance;
    private config: OllamaConfig;
    private context: number[] = [];
    private apiKeyManager: ApiKeyManager;

    // 🆕 Ollama Cloud 호스트 상수
    private static readonly OLLAMA_CLOUD_HOST = 'https://ollama.com';

    constructor(config: Partial<OllamaConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.apiKeyManager = getApiKeyManager();

        // 🆕 모델이 :cloud 접미사를 가지면 Ollama Cloud 호스트 사용
        let baseUrl = this.config.baseUrl;
        if (this.isCloudModel(this.config.model)) {
            baseUrl = OllamaClient.OLLAMA_CLOUD_HOST;
            console.log(`[OllamaClient] 🌐 Cloud 모델 감지 - 호스트: ${baseUrl}`);
        }

        this.client = axios.create({
            baseURL: baseUrl,
            timeout: this.config.timeout,
            headers: {
                'Content-Type': 'application/json',
                ...this.apiKeyManager.getAuthHeaders()
            }
        });

        // 🆕 요청 인터셉터: 동적 API 키 주입
        this.client.interceptors.request.use((config) => {
            const authHeaders = this.apiKeyManager.getAuthHeaders();
            if (authHeaders.Authorization) {
                config.headers.Authorization = authHeaders.Authorization;
            }
            return config;
        });

        // 🆕 응답 인터셉터: 실패 시 폴백 처리 (모든 API 키 순환 시도)
        this.client.interceptors.response.use(
            (response) => {
                this.apiKeyManager.reportSuccess();
                return response;
            },
            async (error) => {
                const statusCode = error?.response?.status;
                console.log(`[OllamaClient] ❌ 요청 실패 - 상태 코드: ${statusCode}`);

                // 네트워크 에러 (ETIMEDOUT, ECONNREFUSED 등) 시 재시도
                const isNetworkError = !statusCode && (
                    error.code === 'ETIMEDOUT' ||
                    error.code === 'ECONNREFUSED' ||
                    error.code === 'ECONNRESET' ||
                    error.code === 'ENOTFOUND' ||
                    error.code === 'EAI_AGAIN'
                );

                // 429, 401, 403 에러 시 API 키 스와핑 시도
                if (statusCode === 429 || statusCode === 401 || statusCode === 403) {
                    // 재시도 횟수 추적 (키 개수만큼 시도)
                    const retryCount = error.config?._retryCount || 0;
                    const maxRetries = this.apiKeyManager.getTotalKeys() - 1;

                    console.log(`[OllamaClient] 🔄 API 키 스와핑 시도 중... (${retryCount + 1}/${maxRetries + 1})`);
                    const switched = this.apiKeyManager.reportFailure(error);

                    if (switched && error.config && retryCount < maxRetries) {
                        error.config._retryCount = retryCount + 1;
                        const newAuthHeaders = this.apiKeyManager.getAuthHeaders();
                        error.config.headers.Authorization = newAuthHeaders.Authorization;
                        console.log(`[OllamaClient] ✅ 새 API 키로 재시도 (Key ${this.apiKeyManager.getCurrentKeyIndex() + 1})...`);
                        return this.client.request(error.config);
                    } else {
                        console.log(`[OllamaClient] ⚠️ 모든 키 소진 - switched: ${switched}, retryCount: ${retryCount}/${maxRetries}`);
                    }
                } else if (isNetworkError && error.config) {
                    // 네트워크 일시 장애 시 최대 2회 재시도 (지수 백오프)
                    const retryCount = error.config._retryCount || 0;
                    const maxNetworkRetries = 2;
                    if (retryCount < maxNetworkRetries) {
                        error.config._retryCount = retryCount + 1;
                        const backoffMs = Math.pow(2, retryCount) * 1000; // 1s, 2s
                        console.log(`[OllamaClient] 🔄 네트워크 에러(${error.code}) - ${backoffMs}ms 후 재시도 (${retryCount + 1}/${maxNetworkRetries})`);
                        await new Promise(resolve => setTimeout(resolve, backoffMs));
                        return this.client.request(error.config);
                    }
                    console.log(`[OllamaClient] ⚠️ 네트워크 재시도 소진 (${error.code})`);
                    this.apiKeyManager.reportFailure(error);
                } else {
                    this.apiKeyManager.reportFailure(error);
                }

                throw error;
            }
        );
    }

    get model(): string {
        return this.config.model;
    }

    /**
     * 🆕 모델이 Cloud 모델(:cloud 접미사)인지 확인
     */
    private isCloudModel(model: string): boolean {
        return model?.toLowerCase().endsWith(':cloud') ?? false;
    }

    setModel(model: string): void {
        this.config.model = model;
    }

    async listModels(): Promise<ListModelsResponse> {
        const response = await this.client.get<ListModelsResponse>('/api/tags');
        return response.data;
    }


    /**
     * Check API quota before making a request.
     * Throws QuotaExceededError if hourly or weekly limit is exceeded.
     */
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
        } catch (error) {
            // Re-throw QuotaExceededError, ignore other errors (tracker init failures)
            if (error instanceof QuotaExceededError) {
                throw error;
            }
            logger.warn('Quota check failed (non-blocking):', error);
        }
    }

    async generate(
        prompt: string,
        options?: ModelOptions,
        onToken?: (token: string) => void,
        images?: string[]
    ): Promise<{ response: string; metrics?: UsageMetrics }> {
        this.checkQuota();

        const request: GenerateRequest = {
            model: this.config.model,
            prompt,
            context: this.context,
            stream: !!onToken,
            options,
            images
        };

        if (onToken) {
            return this.streamGenerate(request, onToken);
        }

        const response = await this.client.post<GenerateResponse>('/api/generate', request);
        this.context = response.data.context || [];
        return {
            response: response.data.response,
            metrics: {
                total_duration: response.data.total_duration,
                load_duration: response.data.load_duration,
                prompt_eval_count: response.data.prompt_eval_count,
                prompt_eval_duration: response.data.prompt_eval_duration,
                eval_count: response.data.eval_count,
                eval_duration: response.data.eval_duration
            }
        };
    }

    private async streamGenerate(
        request: GenerateRequest,
        onToken: (token: string) => void
    ): Promise<{ response: string; metrics?: UsageMetrics }> {
        const response = await this.client.post('/api/generate', request, {
            responseType: 'stream'
        });

        let fullResponse = '';
        let metrics: UsageMetrics | undefined;

        return new Promise((resolve, reject) => {
            let buffer = '';

            response.data.on('data', (chunk: Buffer) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const data: GenerateResponse = JSON.parse(line);
                            if (data.response) {
                                fullResponse += data.response;
                                onToken(data.response);
                            }
                            if (data.done) {
                                if (data.context) {
                                    this.context = data.context;
                                }
                                metrics = {
                                    total_duration: data.total_duration,
                                    load_duration: data.load_duration,
                                    prompt_eval_count: data.prompt_eval_count,
                                    prompt_eval_duration: data.prompt_eval_duration,
                                    eval_count: data.eval_count,
                                    eval_duration: data.eval_duration
                                };
                            }
                        } catch (e) {
                            console.error('[OllamaClient] JSON Parse Error:', e);
                        }
                    }
                }
            });

            response.data.on('end', () => {
                if (buffer.trim()) {
                    try {
                        const data: GenerateResponse = JSON.parse(buffer);
                        if (data.response) {
                            fullResponse += data.response;
                            onToken(data.response);
                        }
                        if (data.done) {
                            metrics = {
                                total_duration: data.total_duration,
                                load_duration: data.load_duration,
                                prompt_eval_count: data.prompt_eval_count,
                                prompt_eval_duration: data.prompt_eval_duration,
                                eval_count: data.eval_count,
                                eval_duration: data.eval_duration
                            };
                        }
                    } catch (e) { /* ignore */ }
                }
                resolve({ response: fullResponse, metrics });
            });
            response.data.on('error', reject);
        });
    }

    /**
     * Enhanced chat with Thinking, Structured Outputs, and Tool Calling support
     */
    async chat(
        messages: ChatMessage[],
        options?: ModelOptions,
        onToken?: (token: string, thinking?: string) => void,
        advancedOptions?: {
            think?: ThinkOption;
            format?: FormatOption;
            tools?: ToolDefinition[];
        }
    ): Promise<ChatMessage & { metrics?: UsageMetrics }> {
        this.checkQuota();

        const request: ChatRequest = {
            model: this.config.model,
            messages,
            stream: !!onToken,
            options,
            ...(advancedOptions?.think !== undefined && { think: advancedOptions.think }),
            ...(advancedOptions?.format && { format: advancedOptions.format }),
            ...(advancedOptions?.tools && { tools: advancedOptions.tools })
        };

        if (onToken) {
            return this.streamChat(request, onToken);
        }

        const response = await this.client.post<ChatResponse>('/api/chat', request);
        return {
            ...response.data.message,
            metrics: {
                total_duration: response.data.total_duration,
                load_duration: response.data.load_duration,
                prompt_eval_count: response.data.prompt_eval_count,
                prompt_eval_duration: response.data.prompt_eval_duration,
                eval_count: response.data.eval_count,
                eval_duration: response.data.eval_duration
            }
        };
    }

    private async streamChat(
        request: ChatRequest,
        onToken: (token: string, thinking?: string) => void
    ): Promise<ChatMessage & { metrics?: UsageMetrics }> {
        const response = await this.client.post('/api/chat', request, {
            responseType: 'stream'
        });

        let fullContent = '';
        let fullThinking = '';
        let toolCalls: ToolCall[] = [];
        let metrics: UsageMetrics | undefined;

        return new Promise((resolve, reject) => {
            let buffer = '';

            response.data.on('data', (chunk: Buffer) => {
                // logger.debug(`Data chunk received: ${chunk.length} bytes`); // Log noise reduction
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const data: ChatResponse = JSON.parse(line);

                            // Handle thinking trace
                            if (data.message?.thinking) {
                                fullThinking += data.message.thinking;
                                onToken('', data.message.thinking);
                            }

                            // Handle content
                            if (data.message?.content) {
                                fullContent += data.message.content;
                                onToken(data.message.content);
                            }

                            // Handle tool calls
                            if (data.message?.tool_calls) {
                                toolCalls = data.message.tool_calls;
                            }

                            if (data.done) {
                                metrics = {
                                    total_duration: data.total_duration,
                                    load_duration: data.load_duration,
                                    prompt_eval_count: data.prompt_eval_count,
                                    prompt_eval_duration: data.prompt_eval_duration,
                                    eval_count: data.eval_count,
                                    eval_duration: data.eval_duration
                                };
                            }
                        } catch (e) {
                            console.error('[OllamaClient] Chat JSON Parse Error:', e);
                        }
                    }
                }
            });

            response.data.on('end', () => {
                if (buffer.trim()) {
                    try {
                        const data: ChatResponse = JSON.parse(buffer);
                        if (data.message?.thinking) fullThinking += data.message.thinking;
                        if (data.message?.content) {
                            fullContent += data.message.content;
                            onToken(data.message.content);
                        }
                        if (data.message?.tool_calls) toolCalls = data.message.tool_calls;
                        if (data.done) {
                            metrics = {
                                total_duration: data.total_duration,
                                load_duration: data.load_duration,
                                prompt_eval_count: data.prompt_eval_count,
                                prompt_eval_duration: data.prompt_eval_duration,
                                eval_count: data.eval_count,
                                eval_duration: data.eval_duration
                            };
                        }
                    } catch (e) { /* ignore */ }
                }

                const result: ChatMessage & { metrics?: UsageMetrics } = {
                    role: 'assistant',
                    content: fullContent,
                    metrics
                };

                if (fullThinking) {
                    result.thinking = fullThinking;
                }

                if (toolCalls.length > 0) {
                    result.tool_calls = toolCalls;
                }

                resolve(result);
            });
            response.data.on('error', reject);
        });
    }

    /**
     * Generate embeddings for text (Ollama Embeddings API)
     */
    async embed(input: string | string[], model?: string): Promise<number[][]> {
        const request: EmbedRequest = {
            model: model || 'embeddinggemma',
            input
        };

        const response = await this.client.post<EmbedResponse>('/api/embed', request);
        return response.data.embeddings;
    }

    async isAvailable(): Promise<boolean> {
        try {
            await this.client.get('/');
            return true;
        } catch {
            return false;
        }
    }

    clearContext(): void {
        this.context = [];
    }

    // ============================================
    // Ollama Web Search API Methods
    // ============================================

    /**
     * Ollama 공식 Web Search API
     * https://ollama.com/api/web_search
     */
    async webSearch(query: string, maxResults: number = 5): Promise<WebSearchResponse> {
        const request: WebSearchRequest = {
            query,
            max_results: Math.min(maxResults, 10)
        };

        console.log(`[OllamaClient] 🔍 Web Search: "${query}"`);

        try {
            // Ollama 공식 API 엔드포인트
            const response = await this.client.post<WebSearchResponse>(
                'https://ollama.com/api/web_search',
                request,
                {
                    baseURL: '', // Override baseURL to use absolute URL
                    headers: {
                        'Content-Type': 'application/json',
                        ...this.apiKeyManager.getAuthHeaders()
                    }
                }
            );

            console.log(`[OllamaClient] ✅ Web Search: ${response.data.results?.length || 0}개 결과`);
            return response.data;
        } catch (error: unknown) {
            console.error('[OllamaClient] Web Search 실패:', (error instanceof Error ? error.message : String(error)));
            return { results: [] };
        }
    }

    /**
     * Ollama 공식 Web Fetch API
     * https://ollama.com/api/web_fetch
     */
    async webFetch(url: string): Promise<WebFetchResponse> {
        const request: WebFetchRequest = { url };

        console.log(`[OllamaClient] 📥 Web Fetch: ${url}`);

        try {
            const response = await this.client.post<WebFetchResponse>(
                'https://ollama.com/api/web_fetch',
                request,
                {
                    baseURL: '',
                    headers: {
                        'Content-Type': 'application/json',
                        ...this.apiKeyManager.getAuthHeaders()
                    }
                }
            );

            console.log(`[OllamaClient] ✅ Web Fetch: "${response.data.title}"`);
            return response.data;
        } catch (error: unknown) {
            console.error('[OllamaClient] Web Fetch 실패:', (error instanceof Error ? error.message : String(error)));
            return { title: '', content: '', links: [] };
        }
    }

    // ============================================
    // Multi-turn Tool Calling (Agent Loop)
    // ============================================

    /**
     * Multi-turn Tool Calling Agent Loop 실행
     * 
     * 도구 호출이 없을 때까지 자동으로 대화를 이어갑니다.
     * 공식 문서: https://docs.ollama.com/capabilities/tool-calling#multi-turn-tool-calling-agent-loop
     * 
     * @example
     * ```typescript
     * const result = await client.runAgentLoop(
     *   [{ role: 'user', content: '서울 날씨 알려줘' }],
     *   [weatherTool],
     *   { get_weather: getWeatherFunc },
     *   { onToolCall: (name, args, result) => console.log(`Tool: ${name}`) }
     * );
     * ```
     */
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
        }
    ): Promise<AgentLoopResult> {
        return runAgentLoop({
            model: this.config.model,
            messages,
            tools,
            availableFunctions,
            think: options?.think,
            stream: options?.stream,
            onToken: options?.onToken,
            onToolCall: options?.onToolCall,
            maxIterations: options?.maxIterations
        });
    }
}

export const createClient = (config?: Partial<OllamaConfig>): OllamaClient => {
    return new OllamaClient(config);
};
