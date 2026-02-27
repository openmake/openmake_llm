/**
 * ============================================================
 * MultiModelClientFactory - A2A 병렬 생성 클라이언트 팩토리
 * ============================================================
 *
 * 각 API 키-모델 쌍에 대해 독립적인 HTTP 클라이언트를 생성하고,
 * 병렬/레이스 방식으로 다중 모델에 동시 요청을 보내는 A2A 핵심 모듈입니다.
 *
 * @module ollama/multi-model-client
 * @description
 * - 키-모델 쌍별 독립 Axios 클라이언트 생성 (Cloud/Local 자동 감지)
 * - parallelChat(): 모든 모델에 동시 요청 후 결과 수집
 * - raceChat(): 가장 빨리 응답한 모델의 결과만 반환
 * - 모델명/인덱스/라운드 로빈 방식의 클라이언트 검색
 * - 상태 조회 (클라이언트 수, 모델명, 마스킹된 키)
 *
 * @example
 * ```typescript
 * const factory = getMultiModelClientFactory();
 * const results = await factory.parallelChat(messages);
 * const winner = await factory.raceChat(messages);
 * ```
 */

import axios, { AxiosInstance } from 'axios';
import { getApiKeyManager, KeyModelPair } from './api-key-manager';
import { getConfig } from '../config/env';
import { OLLAMA_CLOUD_HOST } from '../config/constants';
import { ChatMessage, ChatResponse } from './types';
import { createLogger } from '../utils/logger';

const logger = createLogger('MultiModelClient');

/**
 * A2A 병렬 실행 결과 — 개별 모델의 응답 결과
 * @interface ParallelChatResult
 */
export interface ParallelChatResult {
    /** 클라이언트 인덱스 (0-based) */
    index: number;
    /** 사용된 모델 이름 */
    model: string;
    /** 요청 성공 여부 */
    success: boolean;
    /** 성공 시 응답 메시지 */
    response?: ChatMessage;
    /** 실패 시 에러 메시지 */
    error?: string;
    /** 요청 소요 시간 (밀리초) */
    duration: number;
}

/**
 * 개별 모델 클라이언트 — 키-모델 쌍에 연결된 Axios 인스턴스
 * @interface ModelClient
 */
export interface ModelClient {
    /** 클라이언트 인덱스 (0-based) */
    index: number;
    /** 할당된 모델 이름 */
    model: string;
    /** 할당된 API 키 */
    key: string;
    /** Axios HTTP 클라이언트 인스턴스 */
    axiosInstance: AxiosInstance;
}

/**
 * Multi-Model 클라이언트 팩토리 클래스
 *
 * ApiKeyManager에서 모든 키-모델 쌍을 가져와 각각에 대해
 * 독립적인 Axios 클라이언트를 생성합니다.
 * 병렬 요청(parallelChat), 레이스 요청(raceChat), 개별 요청(chat)을 지원합니다.
 *
 * @class MultiModelClientFactory
 */
export class MultiModelClientFactory {
    /** 인덱스 -> ModelClient 매핑 (키-모델 쌍별 독립 클라이언트) */
    private clients: Map<number, ModelClient> = new Map();

    /**
     * MultiModelClientFactory 인스턴스를 생성합니다.
     * 생성 시 자동으로 모든 키-모델 쌍의 클라이언트를 초기화합니다.
     */
    constructor() {
        this.initialize();
    }

    /**
     * 모든 키-모델 쌍에 대해 독립 Axios 클라이언트를 초기화합니다.
     *
     * 각 키-모델 쌍에 대해:
     * 1. 모델명의 ':cloud' 접미사로 Cloud/Local 호스트 결정
     * 2. 개별 API 키를 Authorization 헤더에 설정
     * 3. 환경변수의 timeout 설정 적용
     *
     * @private
     */
    private initialize(): void {
        const keyManager = getApiKeyManager();
        const pairs = keyManager.getAllKeyModelPairs();
        const envConfig = getConfig();

        logger.info(`🚀 ${pairs.length}개 모델 클라이언트 초기화 중...`);

        pairs.forEach((pair: KeyModelPair) => {
            const lowerModel = pair.model?.toLowerCase() ?? '';
            const isCloudModel = lowerModel.endsWith(':cloud') || lowerModel.endsWith('-cloud');
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
            logger.info(`  Client ${pair.index + 1}: ${pair.model} (${maskedKey})`);
        });

        logger.info(`✅ ${this.clients.size}개 클라이언트 준비 완료`);
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
     * 특정 인덱스의 클라이언트로 채팅 요청을 보냅니다.
     *
     * @param index - 클라이언트 인덱스 (0-based)
     * @param messages - 대화 메시지 히스토리
     * @param options - 요청 옵션 (stream 등)
     * @returns 어시스턴트 응답 메시지
     * @throws {Error} 해당 인덱스의 클라이언트가 없는 경우
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

        logger.info(`🔄 ${targetIndices.length}개 모델에 병렬 요청 시작...`);

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
                logger.info(`✅ Model ${index + 1} (${client.model}): ${duration}ms`);

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
                logger.error(`❌ Model ${index + 1} (${client.model}): ${errorMessage}`);

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
        logger.info(`📊 병렬 요청 완료: ${successCount}/${results.length} 성공`);

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

        logger.info(`🏁 ${targetIndices.length}개 모델 레이스 시작...`);

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
        logger.info(`🏆 레이스 우승: Model ${result.index + 1} (${result.model}) - ${result.duration}ms`);

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

// ============================================
// 싱글톤 인스턴스 관리
// ============================================

/** MultiModelClientFactory 싱글톤 인스턴스 */
let multiModelClientFactory: MultiModelClientFactory | null = null;

/**
 * MultiModelClientFactory 싱글톤 인스턴스를 반환합니다.
 * 최초 호출 시 모든 키-모델 쌍의 클라이언트를 초기화합니다.
 *
 * @returns MultiModelClientFactory 싱글톤 인스턴스
 */
export function getMultiModelClientFactory(): MultiModelClientFactory {
    if (!multiModelClientFactory) {
        multiModelClientFactory = new MultiModelClientFactory();
    }
    return multiModelClientFactory;
}

/**
 * MultiModelClientFactory 싱글톤 인스턴스를 초기화합니다.
 * 다음 getMultiModelClientFactory() 호출 시 새 인스턴스가 생성됩니다.
 */
export function resetMultiModelClientFactory(): void {
    multiModelClientFactory = null;
}
