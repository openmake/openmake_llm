/**
 * ============================================================
 * OllamaClient - Ollama/Cloud LLM API 클라이언트
 * ============================================================
 * 
 * Ollama 및 Cloud LLM API와 통신하는 클라이언트 모듈입니다.
 * 
 * @module backend/core/ollama/client
 * @description
 * - 텍스트 생성 (generate) 및 채팅 (chat) API 지원
 * - 스트리밍 및 논-스트리밍 응답 처리
 * - Thinking 모드, 구조화된 출력, 도구 호출 지원
 * - 임베딩 생성 (embed) 지원
 * - API 키 자동 폴백 및 로테이션
 * 
 * @requires axios - HTTP 클라이언트
 * @requires ./types - Ollama API 타입 정의
 * @requires ./api-key-manager - API 키 관리자
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
    EmbedRequest,
    EmbedResponse
} from './types';
import { getConfig } from '../config';
import { createLogger } from '../utils/logger';
import { getApiKeyManager, ApiKeyManager } from './api-key-manager';

const logger = createLogger('OllamaClient');

const envConfig = getConfig();

/** 기본 Ollama 설정 */
const DEFAULT_CONFIG: OllamaConfig = {
    baseUrl: envConfig.ollamaBaseUrl,
    model: envConfig.ollamaDefaultModel,
    timeout: envConfig.ollamaTimeout
};

/**
 * Ollama LLM 클라이언트 클래스
 * 
 * Ollama 및 Cloud LLM API와 통신하며, 텍스트 생성, 채팅,
 * 임베딩 등의 기능을 제공합니다.
 * 
 * @class OllamaClient
 * @example
 * const client = new OllamaClient({ model: 'gemini-3-flash:cloud' });
 * const response = await client.generate('안녕하세요');
 * console.log(response);
 */
export class OllamaClient {
    /** Axios HTTP 클라이언트 인스턴스 */
    private client: AxiosInstance;
    /** 클라이언트 설정 */
    private config: OllamaConfig;
    /** 대화 컨텍스트 (generate API용) */
    private context: number[] = [];
    /** API 키 관리자 */
    private apiKeyManager: ApiKeyManager;

    /**
     * OllamaClient 인스턴스를 생성합니다.
     * 
     * @param config - 클라이언트 설정 옵션
     * @param config.baseUrl - Ollama API 기본 URL
     * @param config.model - 사용할 기본 모델명
     * @param config.timeout - 요청 타임아웃 (ms)
     */
    constructor(config: Partial<OllamaConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.apiKeyManager = getApiKeyManager();

        this.client = axios.create({
            baseURL: this.config.baseUrl,
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

        // 🆕 응답 인터셉터: 실패 시 폴백 처리
        this.client.interceptors.response.use(
            (response) => {
                this.apiKeyManager.reportSuccess();
                return response;
            },
            async (error) => {
                const switched = this.apiKeyManager.reportFailure(error);
                if (switched && error.config && !error.config._retry) {
                    error.config._retry = true;
                    error.config.headers.Authorization = this.apiKeyManager.getAuthHeaders().Authorization;
                    console.log('[OllamaClient] 🔄 API 키 전환 후 재시도...');
                    return this.client.request(error.config);
                }
                throw error;
            }
        );
    }

    /**
     * 현재 설정된 모델명을 반환합니다.
     * @returns 현재 모델명
     */
    get model(): string {
        return this.config.model;
    }

    /**
     * 사용할 모델을 변경합니다.
     * @param model - 새 모델명
     */
    setModel(model: string): void {
        this.config.model = model;
    }

    /**
     * 사용 가능한 모델 목록을 조회합니다.
     * @returns 모델 목록 응답
     */
    async listModels(): Promise<ListModelsResponse> {
        const response = await this.client.get<ListModelsResponse>('/api/tags');
        return response.data;
    }

    /**
     * 텍스트 생성 API를 호출합니다.
     * 
     * @param prompt - 입력 프롬프트
     * @param options - 모델 옵션 (temperature, top_p 등)
     * @param onToken - 스트리밍 시 토큰별 콜백 함수
     * @param images - 이미지 데이터 배열 (Vision 모델용, base64)
     * @returns 생성된 텍스트 응답
     * 
     * @example
     * // 논-스트리밍
     * const response = await client.generate('Hello');
     * 
     * // 스트리밍
     * const response = await client.generate('Hello', {}, (token) => {
     *     process.stdout.write(token);
     * });
     */
    async generate(
        prompt: string,
        options?: ModelOptions,
        onToken?: (token: string) => void,
        images?: string[]
    ): Promise<string> {
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
        return response.data.response;
    }

    private async streamGenerate(
        request: GenerateRequest,
        onToken: (token: string) => void
    ): Promise<string> {
        const response = await this.client.post('/api/generate', request, {
            responseType: 'stream'
        });

        let fullResponse = '';
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
                            if (data.done && data.context) {
                                this.context = data.context;
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
                    } catch (e) {
                        // 🔒 스트림 끝의 불완전한 JSON은 디버그 레벨로 로깅
                        logger.debug('[OllamaClient] Final buffer parse skipped (incomplete JSON)');
                    }
                }
                resolve(fullResponse);
            });
            response.data.on('error', reject);
        });
    }

    /**
     * 향상된 채팅 API를 호출합니다.
     * 
     * Thinking 모드, 구조화된 출력, 도구 호출을 지원합니다.
     * 
     * @param messages - 채팅 메시지 배열 (system, user, assistant, tool)
     * @param options - 모델 옵션 (temperature, top_p 등)
     * @param onToken - 스트리밍 시 토큰별 콜백 (token, thinking?)
     * @param advancedOptions - 고급 옵션
     * @param advancedOptions.think - Thinking 모드 (boolean | 'low' | 'medium' | 'high')
     * @param advancedOptions.format - 출력 형식 ('json' | JSON Schema)
     * @param advancedOptions.tools - 도구 정의 배열
     * @returns 어시스턴트 응답 메시지 (content, thinking?, tool_calls?)
     * 
     * @example
     * const response = await client.chat([
     *     { role: 'system', content: 'You are a helpful assistant.' },
     *     { role: 'user', content: 'Hello!' }
     * ], { temperature: 0.7 });
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
    ): Promise<ChatMessage> {
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
        return response.data.message;
    }

    private async streamChat(
        request: ChatRequest,
        onToken: (token: string, thinking?: string) => void
    ): Promise<ChatMessage> {
        const response = await this.client.post('/api/chat', request, {
            responseType: 'stream'
        });

        let fullContent = '';
        let fullThinking = '';
        let toolCalls: any[] = [];

        return new Promise((resolve, reject) => {
            let buffer = '';

            response.data.on('data', (chunk: Buffer) => {
                logger.debug(`Data chunk received: ${chunk.length} bytes`);
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
                        if (data.message?.thinking) {
                            fullThinking += data.message.thinking;
                        }
                        if (data.message?.content) {
                            fullContent += data.message.content;
                            onToken(data.message.content);
                        }
                        if (data.message?.tool_calls) {
                            toolCalls = data.message.tool_calls;
                        }
                    } catch (e) {
                        // 🔒 스트림 끝의 불완전한 JSON은 디버그 레벨로 로깅
                        logger.debug('[OllamaClient] Chat final buffer parse skipped (incomplete JSON)');
                    }
                }

                const result: ChatMessage = {
                    role: 'assistant',
                    content: fullContent
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
     * 텍스트의 임베딩 벡터를 생성합니다.
     * 
     * 의미론적 검색, 유사도 비교 등에 사용할 수 있습니다.
     * 
     * @param input - 임베딩할 텍스트 또는 텍스트 배열
     * @param model - 임베딩 모델명 (기본값: 'embeddinggemma')
     * @returns 임베딩 벡터 배열
     * 
     * @example
     * const embeddings = await client.embed('Hello world');
     * console.log(embeddings[0].length); // 벡터 차원 수
     */
    async embed(input: string | string[], model?: string): Promise<number[][]> {
        const request: EmbedRequest = {
            model: model || 'embeddinggemma',
            input
        };

        const response = await this.client.post<EmbedResponse>('/api/embed', request);
        return response.data.embeddings;
    }

    /**
     * Ollama 서버의 가용성을 확인합니다.
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
     * 대화 컨텍스트를 초기화합니다.
     * 새로운 대화를 시작할 때 호출합니다.
     */
    clearContext(): void {
        this.context = [];
    }
}

/**
 * OllamaClient 인스턴스를 생성하는 팩토리 함수입니다.
 * 
 * @param config - 클라이언트 설정 옵션
 * @returns 새 OllamaClient 인스턴스
 * 
 * @example
 * const client = createClient({ model: 'gemini-3-flash:cloud' });
 */
export const createClient = (config?: Partial<OllamaConfig>): OllamaClient => {
    return new OllamaClient(config);
};
