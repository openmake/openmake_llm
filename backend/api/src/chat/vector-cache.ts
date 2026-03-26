/**
 * ============================================================
 * Vector Cache - 임베딩 기반 L1.5 분류 캐시
 * ============================================================
 *
 * 코사인 유사도를 사용하여 유사한 쿼리의 분류 결과를 캐싱합니다.
 * L1(exact-match)과 LLM 분류 사이에 위치하여 LLM 호출을 절감합니다.
 *
 * @module chat/vector-cache
 */

import { createLogger } from '../utils/logger';
import { VECTOR_CACHE_THRESHOLD, VECTOR_CACHE_MAX_SIZE } from '../config/routing-config';
import type { QueryType } from './model-selector-types';

const logger = createLogger('VectorCache');

interface VectorCacheEntry {
    query: string;
    embedding: number[];
    type: QueryType;
    confidence: number;
    timestamp: number;
}

interface VectorSearchResult {
    type: QueryType;
    confidence: number;
    similarity: number;
    originalQuery: string;
}

export class VectorClassificationCache {
    private entries: VectorCacheEntry[] = [];
    private readonly threshold: number;
    private readonly maxSize: number;
    private hits = 0;
    private misses = 0;

    constructor(options?: { threshold?: number; maxSize?: number }) {
        this.threshold = options?.threshold ?? VECTOR_CACHE_THRESHOLD;
        this.maxSize = options?.maxSize ?? VECTOR_CACHE_MAX_SIZE;
    }

    /**
     * 코사인 유사도 계산
     */
    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) return 0;
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        return denominator === 0 ? 0 : dotProduct / denominator;
    }

    /**
     * 벡터 유사도 검색 -- 임계값 이상인 가장 유사한 엔트리 반환
     */
    search(queryEmbedding: number[]): VectorSearchResult | null {
        let bestMatch: VectorCacheEntry | null = null;
        let bestSimilarity = -1;

        for (const entry of this.entries) {
            const sim = this.cosineSimilarity(queryEmbedding, entry.embedding);
            if (sim > bestSimilarity) {
                bestSimilarity = sim;
                bestMatch = entry;
            }
        }

        if (bestMatch && bestSimilarity >= this.threshold) {
            this.hits++;
            logger.debug(
                `벡터 캐시 히트: sim=${bestSimilarity.toFixed(3)}, ` +
                `type=${bestMatch.type}, original="${bestMatch.query.substring(0, 30)}..."`
            );
            return {
                type: bestMatch.type,
                confidence: bestMatch.confidence,
                similarity: bestSimilarity,
                originalQuery: bestMatch.query,
            };
        }

        this.misses++;
        return null;
    }

    /**
     * 벡터 캐시에 엔트리 추가
     */
    add(query: string, embedding: number[], type: QueryType, confidence: number): void {
        // 최대 크기 도달 시 가장 오래된 엔트리 제거
        if (this.entries.length >= this.maxSize) {
            this.entries.shift();
        }

        this.entries.push({
            query,
            embedding,
            type,
            confidence,
            timestamp: Date.now(),
        });
    }

    /**
     * 캐시 통계
     */
    getStats(): { hits: number; misses: number; size: number; hitRate: number } {
        const total = this.hits + this.misses;
        return {
            hits: this.hits,
            misses: this.misses,
            size: this.entries.length,
            hitRate: total > 0 ? (this.hits / total) * 100 : 0,
        };
    }

    /** 캐시 크기 */
    size(): number {
        return this.entries.length;
    }

    /** 캐시 초기화 */
    clear(): void {
        this.entries = [];
        this.hits = 0;
        this.misses = 0;
    }
}
