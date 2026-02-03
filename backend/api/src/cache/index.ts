/**
 * 🆕 캐싱 시스템
 * LRU Cache 기반 다중 레이어 캐시
 */

import LRUCache = require('lru-cache');
import { createLogger } from '../utils/logger';

const logger = createLogger('Cache');

// 캐시 옵션 인터페이스
interface CacheOptions {
    maxSize?: number;
    ttlMs?: number;
}

// 캐시된 응답 인터페이스
interface CachedResponse {
    content: string;
    timestamp: number;
    hits: number;
    model?: string;
    agentId?: string;
}

// 캐시된 라우팅 결과
interface CachedRouting {
    agentId: string;
    confidence: number;
    timestamp: number;
}

// 캐시 통계
interface CacheStats {
    totalHits: number;
    totalMisses: number;
    hitRate: number;
    size: number;
    maxSize: number;
}

/**
 * 통합 캐시 시스템
 */
export class CacheSystem {
    // 쿼리 응답 캐시 (자주 사용되는 질문에 대한 응답)
    private queryCache: LRUCache<string, CachedResponse>;

    // 에이전트 라우팅 캐시 (동일 쿼리 패턴에 대한 라우팅 결과)
    private routingCache: LRUCache<string, CachedRouting>;

    // 임베딩 캐시 (텍스트 임베딩 결과)
    private embeddingCache: LRUCache<string, number[]>;

    // 통계
    private stats = {
        queryHits: 0,
        queryMisses: 0,
        routingHits: 0,
        routingMisses: 0
    };

    constructor(options?: CacheOptions) {
        const maxSize = options?.maxSize || 1000;
        const ttlMs = options?.ttlMs || 30 * 60 * 1000; // 30분 기본 TTL

        this.queryCache = new LRUCache<string, CachedResponse>({
            max: maxSize,
            ttl: ttlMs,
            updateAgeOnGet: true
        });

        this.routingCache = new LRUCache<string, CachedRouting>({
            max: maxSize * 2, // 라우팅은 더 많이 캐싱
            ttl: ttlMs * 2    // 라우팅 결과는 더 오래 유지
        });

        this.embeddingCache = new LRUCache<string, number[]>({
            max: maxSize,
            ttl: ttlMs * 4    // 임베딩은 더 오래 유지
        });

        logger.info(`캐시 시스템 초기화 (maxSize: ${maxSize}, TTL: ${ttlMs}ms)`);
    }

    /**
     * 쿼리 응답 캐시 조회
     */
    getQueryResponse(query: string, model?: string): CachedResponse | undefined {
        const key = this.normalizeQuery(query) + (model ? `::${model}` : '');
        const cached = this.queryCache.get(key);

        if (cached) {
            cached.hits++;
            this.stats.queryHits++;
            logger.debug(`캐시 히트: ${query.substring(0, 50)}...`);
            return cached;
        }

        this.stats.queryMisses++;
        return undefined;
    }

    /**
     * 쿼리 응답 캐시 저장
     */
    setQueryResponse(query: string, response: string, model?: string, agentId?: string): void {
        const key = this.normalizeQuery(query) + (model ? `::${model}` : '');

        this.queryCache.set(key, {
            content: response,
            timestamp: Date.now(),
            hits: 0,
            model,
            agentId
        });

        logger.debug(`캐시 저장: ${query.substring(0, 50)}...`);
    }

    /**
     * 라우팅 결과 캐시 조회
     */
    getRoutingResult(query: string): CachedRouting | undefined {
        const key = this.normalizeQuery(query);
        const cached = this.routingCache.get(key);

        if (cached) {
            this.stats.routingHits++;
            return cached;
        }

        this.stats.routingMisses++;
        return undefined;
    }

    /**
     * 라우팅 결과 캐시 저장
     */
    setRoutingResult(query: string, agentId: string, confidence: number): void {
        const key = this.normalizeQuery(query);

        this.routingCache.set(key, {
            agentId,
            confidence,
            timestamp: Date.now()
        });
    }

    /**
     * 임베딩 캐시 조회
     */
    getEmbedding(text: string): number[] | undefined {
        return this.embeddingCache.get(text);
    }

    /**
     * 임베딩 캐시 저장
     */
    setEmbedding(text: string, embedding: number[]): void {
        this.embeddingCache.set(text, embedding);
    }

    /**
     * 쿼리 정규화 (캐시 키 생성용)
     */
    private normalizeQuery(query: string): string {
        return query
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ')
            .substring(0, 500); // 최대 500자
    }

    /**
     * 캐시 통계 조회
     */
    getStats(): CacheStats {
        const totalHits = this.stats.queryHits + this.stats.routingHits;
        const totalMisses = this.stats.queryMisses + this.stats.routingMisses;
        const total = totalHits + totalMisses;

        return {
            totalHits,
            totalMisses,
            hitRate: total > 0 ? Math.round((totalHits / total) * 100) : 0,
            size: this.queryCache.size + this.routingCache.size,
            maxSize: this.queryCache.max + this.routingCache.max
        };
    }

    /**
     * 캐시 초기화
     */
    clear(): void {
        this.queryCache.clear();
        this.routingCache.clear();
        this.embeddingCache.clear();
        this.stats = { queryHits: 0, queryMisses: 0, routingHits: 0, routingMisses: 0 };
        logger.info('캐시 초기화됨');
    }

    /**
     * 특정 패턴 무효화
     */
    invalidatePattern(pattern: RegExp): number {
        let count = 0;

        for (const key of this.queryCache.keys()) {
            if (pattern.test(key)) {
                this.queryCache.delete(key);
                count++;
            }
        }

        logger.info(`패턴 무효화: ${count}개 항목 삭제`);
        return count;
    }
}

// 싱글톤 인스턴스
let cacheInstance: CacheSystem | null = null;

export function getCacheSystem(): CacheSystem {
    if (!cacheInstance) {
        cacheInstance = new CacheSystem();
    }
    return cacheInstance;
}

export function createCacheSystem(options?: CacheOptions): CacheSystem {
    return new CacheSystem(options);
}
