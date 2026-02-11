/**
 * Multi-Model Client Factory for A2A Parallel Execution
 * 
 * 🆕 5개의 API 키를 각각 다른 모델로 병렬 사용하여 A2A 통신 지원
 * 
 * 사용 예시:
 * ```typescript
 * const factory = getMultiModelClientFactory();
 * 
 * // 모든 모델에 병렬 요청
 * const results = await factory.parallelChat(messages);
 * 
 * // 특정 인덱스의 클라이언트 사용
 * const client = factory.getClient(0); // Key 1 + Model 1
 * ```
 */

import axios, { AxiosInstance } from 'axios';
import { getApiKeyManager, KeyModelPair } from './api-key-manager';
import { getConfig } from '../config/env';
import { ChatMessage, ChatResponse } from './types';

const OLLAMA_CLOUD_HOST = 'https://ollama.com';

/**
 * A2A 병렬 실행 결과
 */
export interface ParallelChatResult {
    index: number;
    model: string;
    success: boolean;
    response?: ChatMessage;
    error?: string;
    duration: number;
}

/**
 * 개별 모델 클라이언트
 */
export interface ModelClient {
    index: number;
    model: string;
    key: string;
    axiosInstance: AxiosInstance;
}

/**
 * Multi-Model Client Factory
 * 각 API 키-모델 쌍에 대해 독립적인 클라이언트 생성 및 병렬 실행 지원
 */
export class MultiModelClientFactory {
    private clients: Map<number, ModelClient> = new Map();

    constructor() {
        this.initialize();
    }

    /**
     * 모든 키-모델 쌍에 대해 클라이언트 초기화
     */
    private initialize(): void {
        const keyManager = getApiKeyManager();
        const pairs = keyManager.getAllKeyModelPairs();
        const envConfig = getConfig();

        console.log(`[MultiModelClientFactory] 🚀 ${pairs.length}개 모델 클라이언트 초기화 중...`);

        pairs.forEach((pair: KeyModelPair) => {
            const isCloudModel = pair.model?.toLowerCase().endsWith(':cloud') ?? false;
            const baseUrl = isCloudModel ? OLLAMA_CLOUD_HOST : envConfig.ollamaBaseUrl;

            const axiosInstance = axios.create({
                baseURL: baseUrl,
                timeout: envConfig.ollamaTimeout,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${pair.key}`
                }
            });

            this.clients.set(pair.index, {
                index: pair.index,
                model: pair.model,
                key: pair.key,
                axiosInstance
            });

            const maskedKey = pair.key.substring(0, 8) + '...';
            console.log(`[MultiModelClientFactory]   Client ${pair.index + 1}: ${pair.model} (${maskedKey})`);
        });

        console.log(`[MultiModelClientFactory] ✅ ${this.clients.size}개 클라이언트 준비 완료`);
    }

    /**
     * 특정 인덱스의 클라이언트 반환
     */
    getClient(index: number): ModelClient | undefined {
        return this.clients.get(index);
    }

    /**
     * 모든 클라이언트 목록 반환
     */
    getAllClients(): ModelClient[] {
        return Array.from(this.clients.values());
    }

    /**
     * 사용 가능한 클라이언트 개수
     */
    getClientCount(): number {
        return this.clients.size;
    }

    /**
     * 단일 클라이언트로 채팅 요청
     */
    async chat(
        index: number,
        messages: ChatMessage[],
        options?: { stream?: boolean }
    ): Promise<ChatMessage> {
        const client = this.clients.get(index);
        if (!client) {
            throw new Error(`Client ${index} not found`);
        }

        const response = await client.axiosInstance.post<ChatResponse>('/api/chat', {
            model: client.model,
            messages,
            stream: options?.stream ?? false
        });

        return response.data.message;
    }

    /**
     * 🆕 모든 모델에 병렬로 채팅 요청 (A2A 핵심 기능)
     */
    async parallelChat(
        messages: ChatMessage[],
        options?: {
            indices?: number[];  // 특정 인덱스만 사용 (미지정시 전체)
            timeout?: number;
        }
    ): Promise<ParallelChatResult[]> {
        const targetIndices = options?.indices ?? Array.from(this.clients.keys());
        const timeout = options?.timeout ?? getConfig().ollamaTimeout;

        console.log(`[MultiModelClientFactory] 🔄 ${targetIndices.length}개 모델에 병렬 요청 시작...`);

        const promises = targetIndices.map(async (index) => {
            const client = this.clients.get(index);
            if (!client) {
                return {
                    index,
                    model: 'unknown',
                    success: false,
                    error: `Client ${index} not found`,
                    duration: 0
                };
            }

            const startTime = Date.now();

            try {
                const response = await Promise.race([
                    client.axiosInstance.post<ChatResponse>('/api/chat', {
                        model: client.model,
                        messages,
                        stream: false
                    }),
                    new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error('Timeout')), timeout)
                    )
                ]);

                const duration = Date.now() - startTime;
                console.log(`[MultiModelClientFactory] ✅ Model ${index + 1} (${client.model}): ${duration}ms`);

                return {
                    index,
                    model: client.model,
                    success: true,
                    response: response.data.message,
                    duration
                };
            } catch (error) {
                const duration = Date.now() - startTime;
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error(`[MultiModelClientFactory] ❌ Model ${index + 1} (${client.model}): ${errorMessage}`);

                return {
                    index,
                    model: client.model,
                    success: false,
                    error: errorMessage,
                    duration
                };
            }
        });

        const results = await Promise.all(promises);
        
        const successCount = results.filter(r => r.success).length;
        console.log(`[MultiModelClientFactory] 📊 병렬 요청 완료: ${successCount}/${results.length} 성공`);

        return results;
    }

    /**
     * 🆕 첫 번째 성공 응답 반환 (레이스 모드)
     */
    async raceChat(
        messages: ChatMessage[],
        options?: { indices?: number[] }
    ): Promise<ParallelChatResult> {
        const targetIndices = options?.indices ?? Array.from(this.clients.keys());

        console.log(`[MultiModelClientFactory] 🏁 ${targetIndices.length}개 모델 레이스 시작...`);

        const promises = targetIndices.map(async (index) => {
            const client = this.clients.get(index);
            if (!client) {
                throw new Error(`Client ${index} not found`);
            }

            const startTime = Date.now();
            const response = await client.axiosInstance.post<ChatResponse>('/api/chat', {
                model: client.model,
                messages,
                stream: false
            });

            return {
                index,
                model: client.model,
                success: true,
                response: response.data.message,
                duration: Date.now() - startTime
            };
        });

        const result = await Promise.race(promises);
        console.log(`[MultiModelClientFactory] 🏆 레이스 우승: Model ${result.index + 1} (${result.model}) - ${result.duration}ms`);

        return result;
    }

    /**
     * 🆕 특정 모델명으로 클라이언트 검색
     */
    getClientByModel(modelName: string): ModelClient | undefined {
        for (const client of this.clients.values()) {
            if (client.model === modelName || client.model.includes(modelName)) {
                return client;
            }
        }
        return undefined;
    }

    /**
     * 🆕 가중치 기반 라운드 로빈 선택
     */
    selectClientRoundRobin(): ModelClient | undefined {
        if (this.clients.size === 0) return undefined;
        
        // 간단한 라운드 로빈: 현재 키 매니저의 인덱스 사용
        const keyManager = getApiKeyManager();
        const currentIndex = keyManager.getCurrentKeyIndex();
        return this.clients.get(currentIndex);
    }

    /**
     * 상태 정보 반환
     */
    getStatus(): {
        clientCount: number;
        clients: { index: number; model: string; keyMasked: string }[];
    } {
        const clients = Array.from(this.clients.values()).map(c => ({
            index: c.index,
            model: c.model,
            keyMasked: c.key.substring(0, 8) + '...' + c.key.substring(c.key.length - 4)
        }));

        return {
            clientCount: this.clients.size,
            clients
        };
    }
}

// 싱글톤 인스턴스
let multiModelClientFactory: MultiModelClientFactory | null = null;

export function getMultiModelClientFactory(): MultiModelClientFactory {
    if (!multiModelClientFactory) {
        multiModelClientFactory = new MultiModelClientFactory();
    }
    return multiModelClientFactory;
}

export function resetMultiModelClientFactory(): void {
    multiModelClientFactory = null;
}
