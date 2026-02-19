/**
 * ============================================================
 * OllamaClient - Ollama HTTP 클라이언트
 * ============================================================
 *
 * Ollama API와의 HTTP 통신을 담당하는 핵심 클라이언트 모듈입니다.
 * Cloud/Local 모델 자동 감지, API Key 자동 로테이션, 스트리밍 지원을 제공합니다.
 *
 * @module ollama/client
 * @description
 * - Generate/Chat/Embed API 호출 (스트리밍 및 비스트리밍)
 * - Cloud 모델(:cloud 접미사) 자동 감지 및 호스트 전환
 * - Axios 인터셉터를 통한 API Key 동적 주입 및 자동 로테이션
 * - 429/401/403 에러 시 자동 키 스와핑, 네트워크 에러 시 지수 백오프 재시도
 * - 사용량 쿼터 검사 (QuotaExceededError)
 * - Web Search/Fetch API, Agent Loop 위임
 * - A2A 병렬 처리를 위한 인덱스 기반 클라이언트 팩토리
 *
 * @requires axios - HTTP 클라이언트
 * @requires ./api-key-manager - API Key 로테이션 관리
 * @requires ./api-usage-tracker - 사용량 추적/쿼터 관리
 */
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
    WebFetchResponse,
    ShowModelRequest,
    ShowModelResponse,
    PsResponse
} from './types';
import { getConfig } from '../config';
import { OLLAMA_CLOUD_HOST } from '../config/constants';
import { createLogger } from '../utils/logger';
import { getApiKeyManager, ApiKeyManager } from './api-key-manager';
import { getApiUsageTracker } from './api-usage-tracker';
import { QuotaExceededError } from '../errors/quota-exceeded.error';
import { KeyExhaustionError } from '../errors/key-exhaustion.error';
import { runAgentLoop, AgentLoopResult } from './agent-loop';

const logger = createLogger('OllamaClient');

const envConfig = getConfig();

const DEFAULT_CONFIG: OllamaConfig = {
    baseUrl: envConfig.ollamaBaseUrl,
    model: envConfig.ollamaDefaultModel,
    timeout: envConfig.ollamaTimeout
};

/**
 * Ollama HTTP 클라이언트 클래스
 *
 * Ollama API(로컬/클라우드)와의 모든 HTTP 통신을 관리합니다.
 * Axios 인터셉터를 통해 API Key 자동 주입/로테이션을 처리하며,
 * 스트리밍/비스트리밍 모드의 Generate/Chat/Embed API를 지원합니다.
 *
 * @class OllamaClient
 *
 * @example
 * ```typescript
 * const client = new OllamaClient({ model: 'gemini-3-flash-preview:cloud' });
 * const result = await client.chat(
 *   [{ role: 'user', content: '안녕하세요' }],
 *   undefined,
 *   (token) => process.stdout.write(token)
 * );
 * ```
 */
export class OllamaClient {
    /** Axios HTTP 클라이언트 인스턴스 (인터셉터 포함) */
    private client: AxiosInstance;
    /** Ollama 클라이언트 설정 (baseUrl, model, timeout) */
    private config: OllamaConfig;
    /** 연속 대화를 위한 컨텍스트 토큰 배열 (Generate API용) */
    private context: number[] = [];
    /** API Key 관리자 인스턴스 (키 로테이션 담당) */
    private apiKeyManager: ApiKeyManager;

    // 🆕 Ollama Cloud 호스트 상수 (constants.ts에서 중앙 관리)

    /**
     * OllamaClient 인스턴스를 생성합니다.
     *
     * 초기화 시 다음을 수행합니다:
     * 1. Cloud 모델(:cloud 접미사) 감지 시 baseUrl을 Ollama Cloud 호스트로 전환
     * 2. Axios 인스턴스 생성 및 기본 헤더 설정
     * 3. 요청 인터셉터: 매 요청마다 현재 활성 API Key를 Authorization 헤더에 동적 주입
     * 4. 응답 인터셉터: 429/401/403 에러 시 API Key 자동 스와핑 후 재시도,
     *    네트워크 에러(ETIMEDOUT 등) 시 지수 백오프(1s, 2s)로 최대 2회 재시도,
     *    모든 키 소진 시 KeyExhaustionError throw
     *
     * @param config - Ollama 클라이언트 설정 (부분 적용 가능, 미지정 시 환경변수 기본값 사용)
     * @throws {KeyExhaustionError} 모든 API 키가 소진되어 요청 불가능한 경우
     */
    constructor(config: Partial<OllamaConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.apiKeyManager = getApiKeyManager();

        // 🆕 모델이 :cloud 접미사를 가지면 Ollama Cloud 호스트 사용
        let baseUrl = this.config.baseUrl;
        if (this.isCloudModel(this.config.model)) {
            baseUrl = OLLAMA_CLOUD_HOST;
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

                // 429, 401, 403, 502 에러 시 API 키 스와핑 시도
                // 502: Cloud 모델 게이트웨이 장애 (Ollama 공식 문서)
                if (statusCode === 429 || statusCode === 401 || statusCode === 403 || statusCode === 502) {
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
                        
                        // 🆕 모든 키가 소진되었을 때 KeyExhaustionError throw
                        const nextResetTime = this.apiKeyManager.getNextResetTime();
                        if (nextResetTime) {
                            const totalKeys = this.apiKeyManager.getTotalKeys();
                            const keysInCooldown = this.apiKeyManager.getKeysInCooldownCount();
                            throw new KeyExhaustionError(nextResetTime, totalKeys, keysInCooldown);
                        }
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
                    // ENOTFOUND/EAI_AGAIN은 호스트(DNS) 레벨 장애 — 키 로테이션 무의미
                    // 키별 장애(ETIMEDOUT, ECONNREFUSED 등)만 키 교체 트리거
                    if (error.code !== 'ENOTFOUND' && error.code !== 'EAI_AGAIN') {
                        this.apiKeyManager.reportFailure(error);
                    }
                } else {
                    this.apiKeyManager.reportFailure(error);
                }

                throw error;
            }
        );
    }

    /**
     * 현재 설정된 모델 이름을 반환합니다.
     * @returns 현재 모델 이름
     */
    get model(): string {
        return this.config.model;
    }

    /**
     * 모델이 Cloud 모델(:cloud 접미사)인지 확인합니다.
     *
     * @param model - 확인할 모델 이름
     * @returns Cloud 모델 여부
     * @private
     */
    private isCloudModel(model: string): boolean {
        return model?.toLowerCase().endsWith(':cloud') ?? false;
    }

    /**
     * 클라이언트의 기본 모델을 변경하고, Cloud 모델 전환 시 baseURL을 자동 갱신합니다.
     *
     * Auto-routing 등에서 런타임에 모델이 변경될 때,
     * Cloud 모델이면 OLLAMA_CLOUD_HOST로, 로컬 모델이면 원래 노드 URL로 전환합니다.
     *
     * @param model - 새로 설정할 모델 이름
     */
    setModel(model: string): void {
        const wasCloud = this.isCloudModel(this.config.model);
        const isCloud = this.isCloudModel(model);
        this.config.model = model;

        // Cloud ↔ Local 전환 시 baseURL 갱신
        if (isCloud && !wasCloud) {
            this.client.defaults.baseURL = OLLAMA_CLOUD_HOST;
            logger.info(`[setModel] 🌐 Cloud 모델 전환 → ${OLLAMA_CLOUD_HOST} (model: ${model})`);
        } else if (!isCloud && wasCloud) {
            this.client.defaults.baseURL = this.config.baseUrl;
            logger.info(`[setModel] 🏠 Local 모델 전환 → ${this.config.baseUrl} (model: ${model})`);
        }
    }

    /**
     * Ollama 서버에서 사용 가능한 모델 목록을 조회합니다.
     *
     * @returns 모델 목록 응답 (모델 이름, 크기, 수정일 등)
     * @throws {Error} 서버 연결 실패 시
     */
    async listModels(): Promise<ListModelsResponse> {
        const response = await this.client.get<ListModelsResponse>('/api/tags');
        return response.data;
    }

    /**
     * 모델 상세 정보를 조회합니다 (Ollama POST /api/show).
     *
     * 모델의 라이선스, Modelfile, 파라미터, 템플릿, capabilities 등을 반환합니다.
     *
     * @param model - 조회할 모델 이름
     * @param verbose - 상세 모델 정보 포함 여부
     * @returns 모델 상세 정보
     */
    async showModel(model: string, verbose?: boolean): Promise<ShowModelResponse> {
        const request: ShowModelRequest = { model, ...(verbose && { verbose }) };
        const response = await this.client.post<ShowModelResponse>('/api/show', request);
        return response.data;
    }

    /**
     * 현재 실행 중인 모델 목록을 조회합니다 (Ollama GET /api/ps).
     *
     * 각 모델의 VRAM 사용량, 컨텍스트 길이, 만료 시간 등을 반환합니다.
     *
     * @returns 실행 중인 모델 목록
     */
    async listRunningModels(): Promise<PsResponse> {
        const response = await this.client.get<PsResponse>('/api/ps');
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

    /**
     * 텍스트 생성 API를 호출합니다 (Ollama /api/generate).
     *
     * onToken 콜백이 제공되면 스트리밍 모드로 동작하여 토큰 단위로 콜백을 호출합니다.
     * 사용량 쿼터 검사를 먼저 수행하고, 초과 시 QuotaExceededError를 throw합니다.
     *
     * @param prompt - 생성할 텍스트의 프롬프트
     * @param options - 모델 추론 옵션 (temperature, top_p 등)
     * @param onToken - 스트리밍 시 토큰 수신 콜백 (미제공 시 비스트리밍 모드)
     * @param images - Base64 인코딩된 이미지 배열 (Vision 모델용)
     * @returns 생성된 텍스트와 성능 메트릭
     * @throws {QuotaExceededError} 시간/주간 사용량 한계 초과 시
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
        }
    ): Promise<{ response: string; metrics?: UsageMetrics }> {
        this.checkQuota();

        const request: GenerateRequest = {
            model: this.config.model,
            prompt,
            context: this.context,
            stream: !!onToken,
            options,
            images,
            ...(advancedOptions?.think !== undefined && { think: advancedOptions.think }),
            ...(advancedOptions?.format && { format: advancedOptions.format }),
            ...(advancedOptions?.system && { system: advancedOptions.system }),
            ...(advancedOptions?.keep_alive !== undefined && { keep_alive: advancedOptions.keep_alive })
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

    /**
     * 스트리밍 방식으로 텍스트를 생성합니다 (내부 메서드).
     *
     * NDJSON 스트림을 파싱하여 토큰 단위로 콜백을 호출하고,
     * 완료 시 전체 응답과 메트릭을 반환합니다.
     * 버퍼링 방식으로 줄 단위 파싱을 수행합니다.
     *
     * @param request - 텍스트 생성 요청 객체
     * @param onToken - 토큰 수신 콜백
     * @returns 전체 응답 텍스트와 성능 메트릭
     * @private
     */
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
                            const parsed = JSON.parse(line) as GenerateResponse & { error?: string };
                            // 스트리밍 중 에러 응답 체크 (Ollama 공식 문서)
                            if (parsed.error) {
                                reject(new Error(`Ollama generate stream error: ${parsed.error}`));
                                return;
                            }
                            const data = parsed;
                            if (data.response) {
                                fullResponse += data.response;
                                onToken(data.response);
                            }
                            // Thinking 필드 처리 (think=true 시)
                            if (data.thinking) {
                                fullResponse += data.thinking;
                                onToken(data.thinking);
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
                        const parsed = JSON.parse(buffer) as GenerateResponse & { error?: string };
                        if (parsed.error) {
                            reject(new Error(`Ollama generate stream error: ${parsed.error}`));
                            return;
                        }
                        const data = parsed;
                        if (data.response) {
                            fullResponse += data.response;
                            onToken(data.response);
                        }
                        if (data.thinking) {
                            fullResponse += data.thinking;
                            onToken(data.thinking);
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
                    } catch (e) { /* ignore trailing buffer parse errors */ }
                }
                resolve({ response: fullResponse, metrics });
            });
            response.data.on('error', reject);
        });
    }

    /**
     * 채팅 API를 호출합니다 (Ollama /api/chat).
     *
     * Thinking(추론 과정 표시), 구조화된 출력(JSON Schema), Tool Calling 등
     * 고급 기능을 지원합니다. onToken 콜백 제공 시 스트리밍 모드로 동작합니다.
     *
     * @param messages - 대화 히스토리 메시지 배열
     * @param options - 모델 추론 옵션 (temperature, top_p 등)
     * @param onToken - 스트리밍 시 토큰/Thinking 수신 콜백 (token, thinking?)
     * @param advancedOptions - 고급 옵션 (think: Thinking 모드, format: 출력 형식, tools: 도구 목록)
     * @returns 어시스턴트 응답 메시지 및 성능 메트릭
     * @throws {QuotaExceededError} 사용량 한계 초과 시
     */
    async chat(
        messages: ChatMessage[],
        options?: ModelOptions,
        onToken?: (token: string, thinking?: string) => void,
        advancedOptions?: {
            think?: ThinkOption;
            format?: FormatOption;
            tools?: ToolDefinition[];
            keep_alive?: string | number;
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
            ...(advancedOptions?.tools && { tools: advancedOptions.tools }),
            ...(advancedOptions?.keep_alive !== undefined && { keep_alive: advancedOptions.keep_alive })
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

    /**
     * 스트리밍 방식으로 채팅 응답을 생성합니다 (내부 메서드).
     *
     * NDJSON 스트림을 파싱하여 Thinking, Content, Tool Calls를 구분 처리합니다:
     * - thinking 필드가 있으면 추론 과정으로 콜백 호출 (빈 content + thinking)
     * - content 필드가 있으면 본문 텍스트로 콜백 호출
     * - tool_calls 필드가 있으면 도구 호출 목록 수집
     * - done=true 시 메트릭 수집
     *
     * @param request - 채팅 요청 객체
     * @param onToken - 토큰/Thinking 수신 콜백
     * @returns 어시스턴트 응답 메시지 (content, thinking, tool_calls 포함)
     * @private
     */
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
                            const parsed = JSON.parse(line) as ChatResponse & { error?: string };
                            // 스트리밍 중 에러 응답 체크 (Ollama 공식 문서)
                            if (parsed.error) {
                                reject(new Error(`Ollama chat stream error: ${parsed.error}`));
                                return;
                            }
                            const data = parsed;

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

                            // Handle tool calls (스트리밍 시 누적 — Ollama 공식 스펙)
                            if (data.message?.tool_calls) {
                                toolCalls = [...toolCalls, ...data.message.tool_calls];
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
                        const parsed = JSON.parse(buffer) as ChatResponse & { error?: string };
                        if (parsed.error) {
                            reject(new Error(`Ollama chat stream error: ${parsed.error}`));
                            return;
                        }
                        const data = parsed;
                        if (data.message?.thinking) fullThinking += data.message.thinking;
                        if (data.message?.content) {
                            fullContent += data.message.content;
                            onToken(data.message.content);
                        }
                        if (data.message?.tool_calls) toolCalls = [...toolCalls, ...data.message.tool_calls];
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
     * 텍스트 임베딩을 생성합니다 (Ollama /api/embed).
     *
     * 텍스트를 벡터 공간의 숫자 배열로 변환합니다.
     * 유사도 검색, 클러스터링 등에 활용됩니다.
     *
     * @param input - 임베딩할 텍스트 (단일 문자열 또는 배열)
     * @param model - 임베딩 모델 이름 (기본값: 'embeddinggemma')
     * @returns 임베딩 벡터 배열 (입력 개수 x 차원)
     * @throws {Error} 임베딩 모델 사용 불가 시
     */
    async embed(
        input: string | string[],
        model?: string,
        embedOptions?: {
            truncate?: boolean;
            keep_alive?: string | number;
            options?: ModelOptions;
        }
    ): Promise<number[][]> {
        const request: EmbedRequest = {
            model: model || 'embeddinggemma',
            input,
            ...(embedOptions?.truncate !== undefined && { truncate: embedOptions.truncate }),
            ...(embedOptions?.keep_alive !== undefined && { keep_alive: embedOptions.keep_alive }),
            ...(embedOptions?.options && { options: embedOptions.options })
        };

        const response = await this.client.post<EmbedResponse>('/api/embed', request);
        return response.data.embeddings;
    }

    /**
     * Ollama 서버의 가용성을 확인합니다.
     *
     * 서버 루트 엔드포인트에 GET 요청을 보내 응답 가능 여부를 판단합니다.
     *
     * @returns 서버 사용 가능 여부
     */
    async isAvailable(): Promise<boolean> {
        try {
            await this.client.get('/');
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 연속 대화 컨텍스트를 초기화합니다.
     *
     * Generate API의 대화 컨텍스트 토큰 배열을 비웁니다.
     * 새로운 대화를 시작할 때 호출합니다.
     */
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
                `${OLLAMA_CLOUD_HOST}/api/web_search`,
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
            logger.warn('[OllamaClient] 웹 검색 실패:', error);
            return {
                results: [],
                error: error instanceof Error ? error.message : 'Web search failed'
            };
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
                `${OLLAMA_CLOUD_HOST}/api/web_fetch`,
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

/**
 * OllamaClient 인스턴스를 생성하는 팩토리 함수
 *
 * @param config - Ollama 클라이언트 설정 (부분 적용 가능)
 * @returns 새 OllamaClient 인스턴스
 */
export const createClient = (config?: Partial<OllamaConfig>): OllamaClient => {
    return new OllamaClient(config);
};

/**
 * 🆕 특정 인덱스의 키-모델 쌍으로 클라이언트 생성 (A2A용)
 * @param index API 키 인덱스 (0-based)
 * @returns 해당 키-모델 쌍으로 구성된 OllamaClient
 */
export const createClientForIndex = (index: number): OllamaClient | null => {
    const keyManager = getApiKeyManager();
    const pair = keyManager.getKeyModelPair(index);
    
    if (!pair) {
        console.error(`[OllamaClient] ❌ 인덱스 ${index}에 해당하는 키-모델 쌍이 없습니다.`);
        return null;
    }
    
    console.log(`[OllamaClient] 🎯 인덱스 ${index + 1} 클라이언트 생성: ${pair.model}`);
    return new OllamaClient({ model: pair.model });
};

/**
 * 🆕 모든 키-모델 쌍에 대해 클라이언트 배열 생성 (A2A 병렬 처리용)
 * @returns OllamaClient 배열
 */
export const createAllClients = (): OllamaClient[] => {
    const keyManager = getApiKeyManager();
    const pairs = keyManager.getAllKeyModelPairs();
    
    console.log(`[OllamaClient] 🚀 ${pairs.length}개 A2A 클라이언트 생성 중...`);
    
    const clients = pairs.map(pair => {
        // 각 클라이언트 생성 전에 해당 인덱스로 키 매니저 설정
        const client = new OllamaClient({ model: pair.model });
        return client;
    });
    
    console.log(`[OllamaClient] ✅ ${clients.length}개 A2A 클라이언트 준비 완료`);
    return clients;
};
