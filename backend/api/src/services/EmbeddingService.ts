/**
 * ============================================================
 * EmbeddingService - 텍스트 임베딩 생성 서비스
 * ============================================================
 *
 * Ollama API를 통해 텍스트를 벡터 임베딩으로 변환합니다.
 * ClusterManager를 통해 사용 가능한 노드에서 임베딩을 생성하며,
 * 배치 처리를 지원합니다.
 *
 * @module services/EmbeddingService
 */

import { createLogger } from '../utils/logger';
import { getClusterManager } from '../cluster/manager';
import { RAG_CONFIG } from '../config/runtime-limits';
import type { OllamaClient } from '../ollama/client';

const logger = createLogger('EmbeddingService');

/**
 * 임베딩 생성 결과
 */
export interface EmbeddingResult {
    /** 입력 텍스트 */
    text: string;
    /** 생성된 임베딩 벡터 */
    embedding: number[];
    /** 사용된 모델 이름 */
    model: string;
}

/**
 * 텍스트 임베딩 생성 서비스
 */
export class EmbeddingService {
    private readonly embeddingModel: string;
    private readonly batchSize: number;

    constructor() {
        this.embeddingModel = RAG_CONFIG.EMBEDDING_MODEL;
        this.batchSize = RAG_CONFIG.EMBEDDING_BATCH_SIZE;
    }

    /**
     * Ollama 클라이언트를 획득합니다.
     * ClusterManager에서 사용 가능한 노드를 자동으로 선택합니다.
     */
    private getClient(): OllamaClient | undefined {
        try {
            const cluster = getClusterManager();
            const bestNode = cluster.getBestNode(this.embeddingModel);
            if (!bestNode) {
                logger.warn('임베딩 가능한 노드 없음 — 기본 노드 시도');
                // 모델 지정 없이 최적 노드 선택
                const anyNode = cluster.getBestNode();
                if (!anyNode) return undefined;
                return cluster.createScopedClient(anyNode.id, this.embeddingModel);
            }
            return cluster.createScopedClient(bestNode.id, this.embeddingModel);
        } catch (error) {
            logger.error('클라이언트 획득 실패:', error);
            return undefined;
        }
    }

    /**
     * 단일 텍스트의 임베딩을 생성합니다.
     *
     * @param text - 임베딩할 텍스트
     * @returns 임베딩 벡터 또는 null (실패 시)
     */
    async embedText(text: string): Promise<number[] | null> {
        const client = this.getClient();
        if (!client) {
            logger.error('사용 가능한 Ollama 노드 없음 — 임베딩 실패');
            return null;
        }

        try {
            const embeddings = await client.embed(text, this.embeddingModel);
            if (embeddings.length === 0 || embeddings[0].length === 0) {
                logger.warn('임베딩 결과가 비어있음');
                return null;
            }
            return embeddings[0];
        } catch (error) {
            logger.error('임베딩 생성 실패:', error);
            return null;
        }
    }

    /**
     * 여러 텍스트의 임베딩을 배치로 생성합니다.
     *
     * 배치 크기(RAG_CONFIG.EMBEDDING_BATCH_SIZE)에 맞게 분할하여 처리합니다.
     *
     * @param texts - 임베딩할 텍스트 배열
     * @returns 임베딩 결과 배열 (실패한 항목은 null)
     */
    async embedBatch(texts: string[]): Promise<Array<number[] | null>> {
        if (texts.length === 0) return [];

        const client = this.getClient();
        if (!client) {
            logger.error('사용 가능한 Ollama 노드 없음 — 배치 임베딩 실패');
            return texts.map(() => null);
        }

        const results: Array<number[] | null> = [];

        // 배치 단위로 분할 처리
        for (let i = 0; i < texts.length; i += this.batchSize) {
            const batch = texts.slice(i, i + this.batchSize);

            try {
                const embeddings = await client.embed(batch, this.embeddingModel);

                for (let j = 0; j < batch.length; j++) {
                    if (embeddings[j] && embeddings[j].length > 0) {
                        results.push(embeddings[j]);
                    } else {
                        results.push(null);
                    }
                }

                logger.debug(`배치 임베딩 완료: ${i + 1}~${Math.min(i + this.batchSize, texts.length)}/${texts.length}`);
            } catch (error) {
                logger.error(`배치 임베딩 실패 (${i}~${i + batch.length}):`, error);
                // 실패한 배치의 모든 항목을 null로 채움
                for (let j = 0; j < batch.length; j++) {
                    results.push(null);
                }
            }
        }

        const successCount = results.filter(r => r !== null).length;
        logger.info(`배치 임베딩 결과: ${successCount}/${texts.length} 성공`);

        return results;
    }

    /**
     * 임베딩 모델의 사용 가능 여부를 확인합니다.
     */
    async isAvailable(): Promise<boolean> {
        const client = this.getClient();
        if (!client) return false;

        try {
            const testEmbed = await client.embed('test', this.embeddingModel);
            return testEmbed.length > 0 && testEmbed[0].length > 0;
        } catch {
            return false;
        }
    }

    /**
     * 현재 설정된 임베딩 모델 이름을 반환합니다.
     */
    getModelName(): string {
        return this.embeddingModel;
    }
}

// 싱글톤 팩토리
let instance: EmbeddingService | null = null;

/**
 * EmbeddingService 싱글톤 인스턴스를 반환합니다.
 */
export function getEmbeddingService(): EmbeddingService {
    if (!instance) {
        instance = new EmbeddingService();
    }
    return instance;
}
