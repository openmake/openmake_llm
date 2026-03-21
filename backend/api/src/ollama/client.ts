/**
 * ============================================================
 * OllamaClient - Ollama HTTP 클라이언트
 * ============================================================
 *
 * Ollama API와의 HTTP 통신을 담당하는 핵심 클라이언트 모듈입니다.
 * Cloud/Local 모델 자동 감지, API Key 자동 로테이션, 스트리밍 지원을 제공합니다.
 *
 * 내부 구현은 다음 하위 모듈로 분리되어 있습니다:
 * - stream-parser: NDJSON 스트리밍 응답 파싱 (Generate/Chat)
 * - web-api: Web Search/Fetch API 호출
 * - interceptors: Axios 요청/응답 인터셉터 (키 로테이션, 재시도)
 *
 * @module ollama/client
 */
import axios, { AxiosInstance } from 'axios';
import {
    OllamaConfig,
    GenerateRequest,
    GenerateResponse,
    ChatRequest,
    ChatMessage,
    ChatResponse,
    ListModelsResponse,
    ModelOptions,
    ThinkOption,
    FormatOption,
    ToolDefinition,
    UsageMetrics,
    WebSearchResponse,
    WebFetchResponse,
    ShowModelRequest,
    ShowModelResponse,
    PsResponse,
    normalizeThinkOption
} from './types';
import { getConfig } from '../config';
import { OLLAMA_CLOUD_HOST } from '../config/constants';
import { createLogger } from '../utils/logger';
import { getApiKeyManager, ApiKeyManager } from './api-key-manager';
import { getApiUsageTracker } from './api-usage-tracker';
import { QuotaExceededError } from '../errors/quota-exceeded.error';
import { runAgentLoop, AgentLoopResult } from './agent-loop';
import { setupInterceptors, KeyIndexRef } from './interceptors';
import { streamGenerate, streamChat } from './stream-parser';
import { webSearch as webSearchApi, webFetch as webFetchApi } from './web-api';

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
    /** Per-instance bound key index (A2A 싱글톤 경합 방지) */
    private keyRef: KeyIndexRef;

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

        let baseUrl = this.config.baseUrl;
        if (this.isCloudModel(this.config.model)) {
            baseUrl = OLLAMA_CLOUD_HOST;
            logger.info(`Cloud 모델 감지 - 호스트: ${baseUrl}`);
        }

        // 키풀에서 라운드로빈으로 다음 가용 키 할당 (모델 무관)
        const poolKeyIndex = this.apiKeyManager.getNextAvailableKey();
        const boundKeyIndex = poolKeyIndex !== -1 ? poolKeyIndex : this.apiKeyManager.getCurrentKeyIndex();
        this.keyRef = { boundKeyIndex };
        logger.info(`[constructor] 키풀 할당: ${this.config.model} → Key ${this.keyRef.boundKeyIndex + 1}`);

        this.client = axios.create({
            baseURL: baseUrl,
            timeout: this.config.timeout,
            headers: {
                'Content-Type': 'application/json',
                ...this.apiKeyManager.getAuthHeadersForIndex(this.keyRef.boundKeyIndex)
            }
        });

        setupInterceptors(this.client, this.apiKeyManager, this.keyRef);
    }

    /**
     * 현재 설정된 모델 이름을 반환합니다.
     */
    get model(): string {
        return this.config.model;
    }

    /**
     * 현재 바인딩된 키 인덱스를 반환합니다.
     * web-api 등 하위 모듈에서 사용합니다.
     */
    private get boundKeyIndex(): number {
        return this.keyRef.boundKeyIndex;
    }

    /**
     * 모델이 Cloud 모델(:cloud 접미사)인지 확인합니다.
     */
    private isCloudModel(model: string): boolean {
        const lower = model?.toLowerCase() ?? '';
        return lower.endsWith(':cloud') || lower.endsWith('-cloud');
    }

    /**
     * 클라이언트의 기본 모델을 변경하고, Cloud 모델 전환 시 baseURL을 자동 갱신합니다.
     *
     * @param model - 새로 설정할 모델 이름
     */
    setModel(model: string): void {
        const wasCloud = this.isCloudModel(this.config.model);
        const isCloud = this.isCloudModel(model);
        this.config.model = model;

        if (isCloud && !wasCloud) {
            this.client.defaults.baseURL = OLLAMA_CLOUD_HOST;
            logger.info(`[setModel] Cloud 모델 전환 → ${OLLAMA_CLOUD_HOST} (model: ${model})`);
        } else if (!isCloud && wasCloud) {
            this.client.defaults.baseURL = this.config.baseUrl;
            logger.info(`[setModel] Local 모델 전환 → ${this.config.baseUrl} (model: ${model})`);
        }

        logger.info(`[setModel] 모델 변경: ${model} (키 유지: Key ${this.boundKeyIndex + 1})`);
    }

    /**
     * Ollama 서버에서 사용 가능한 모델 목록을 조회합니다.
     */
    async listModels(): Promise<ListModelsResponse> {
        const response = await this.client.get<ListModelsResponse>('/api/tags');
        return response.data;
    }

    /**
     * 모델 상세 정보를 조회합니다 (Ollama POST /api/show).
     */
    async showModel(model: string, verbose?: boolean): Promise<ShowModelResponse> {
        const request: ShowModelRequest = { model, ...(verbose && { verbose }) };
        const response = await this.client.post<ShowModelResponse>('/api/show', request);
        return response.data;
    }

    /**
     * 현재 실행 중인 모델 목록을 조회합니다 (Ollama GET /api/ps).
     */
    async listRunningModels(): Promise<PsResponse> {
        const response = await this.client.get<PsResponse>('/api/ps');
        return response.data;
    }

    /**
     * API 사용량 쿼터를 검사합니다.
     * @throws {QuotaExceededError} 시간/주간 사용량 한계 초과 시
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
            if (error instanceof QuotaExceededError) {
                throw error;
            }
            logger.warn('Quota check failed (non-blocking):', error);
        }
    }

    /**
     * 텍스트 생성 API를 호출합니다 (Ollama /api/generate).
     *
     * @param prompt - 생성할 텍스트의 프롬프트
     * @param options - 모델 추론 옵션 (temperature, top_p 등)
     * @param onToken - 스트리밍 시 토큰 수신 콜백
     * @param images - Base64 인코딩된 이미지 배열 (Vision 모델용)
     * @param advancedOptions - 고급 옵션 (think, format, system, keep_alive)
     * @returns 생성된 텍스트와 성능 메트릭
     * @throws {QuotaExceededError} 사용량 한계 초과 시
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
            ...(advancedOptions?.think !== undefined && { think: normalizeThinkOption(advancedOptions.think, this.config.model) }),
            ...(advancedOptions?.format && { format: advancedOptions.format }),
            ...(advancedOptions?.system && { system: advancedOptions.system }),
            ...(advancedOptions?.keep_alive !== undefined && { keep_alive: advancedOptions.keep_alive })
        };

        if (onToken) {
            return streamGenerate(this.client, request, onToken, (ctx) => { this.context = ctx; });
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
     * 채팅 API를 호출합니다 (Ollama /api/chat).
     *
     * @param messages - 대화 히스토리 메시지 배열
     * @param options - 모델 추론 옵션
     * @param onToken - 스트리밍 시 토큰/Thinking 수신 콜백
     * @param advancedOptions - 고급 옵션 (think, format, tools, keep_alive)
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
            ...(advancedOptions?.think !== undefined && { think: normalizeThinkOption(advancedOptions.think, this.config.model) }),
            ...(advancedOptions?.format && { format: advancedOptions.format }),
            ...(advancedOptions?.tools && { tools: advancedOptions.tools }),
            ...(advancedOptions?.keep_alive !== undefined && { keep_alive: advancedOptions.keep_alive })
        };

        if (onToken) {
            return streamChat(this.client, request, onToken);
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
     * Ollama 서버의 가용성을 확인합니다.
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
     */
    clearContext(): void {
        this.context = [];
    }

    // ============================================
    // Ollama Web Search/Fetch API
    // ============================================

    /**
     * Ollama 공식 Web Search API
     */
    async webSearch(query: string, maxResults: number = 5): Promise<WebSearchResponse> {
        return webSearchApi(this.client, this.apiKeyManager, this.boundKeyIndex, query, maxResults);
    }

    /**
     * Ollama 공식 Web Fetch API
     */
    async webFetch(url: string): Promise<WebFetchResponse> {
        return webFetchApi(this.client, this.apiKeyManager, this.boundKeyIndex, url);
    }

    // ============================================
    // Multi-turn Tool Calling (Agent Loop)
    // ============================================

    /**
     * Multi-turn Tool Calling Agent Loop 실행
     *
     * 도구 호출이 없을 때까지 자동으로 대화를 이어갑니다.
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

// createClientForIndex(), createAllClients() 제거됨
// → OllamaClient constructor가 getNextAvailableKey()로 키풀에서 자동 할당하므로 불필요
