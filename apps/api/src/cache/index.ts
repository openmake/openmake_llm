/**
 * 캐싱 시스템 — LRU 기반 에이전트 라우팅 캐시.
 *
 * 질의 텍스트 기반 응답 캐시(getQueryResponse/setQueryResponse)는 호출처가 없고 키에 사용자가 없어 되살리면 사용자 간
 * 응답이 섞이므로 2026-09-17 제거했다(개인화된 채팅 응답은 캐시 대상이 아니다 — 실효 캐시는 vLLM 프리픽스 캐시).
 */

import LRUCache = require('lru-cache');
import { createLogger } from '../utils/logger';
import { CACHE_CONFIG } from '../config/runtime-limits';

const logger = createLogger('Cache');

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
 * 캐시 시스템
 */
class CacheSystem {
    // 에이전트 라우팅 캐시 (동일 쿼리 패턴에 대한 라우팅 결과)
    private routingCache: LRUCache<string, CachedRouting>;

    // 통계
    private stats = {
        routingHits: 0,
        routingMisses: 0
    };

    constructor() {
        // 라우팅 캐시 수명·용량은 CACHE_CONFIG.ROUTING_* (매핑이 상하지 않고 미스 비용은 LLM 라우팅 왕복이라 길게 잡는다).
        this.routingCache = new LRUCache<string, CachedRouting>({
            max: CACHE_CONFIG.ROUTING_CACHE_MAX_SIZE,
            ttl: CACHE_CONFIG.ROUTING_CACHE_TTL_MS
        });

        logger.info(`캐시 시스템 초기화 (라우팅 maxSize: ${CACHE_CONFIG.ROUTING_CACHE_MAX_SIZE}, TTL: ${CACHE_CONFIG.ROUTING_CACHE_TTL_MS}ms)`);
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
        const totalHits = this.stats.routingHits;
        const totalMisses = this.stats.routingMisses;
        const total = totalHits + totalMisses;

        return {
            totalHits,
            totalMisses,
            hitRate: total > 0 ? Math.round((totalHits / total) * 100) : 0,
            size: this.routingCache.size,
            maxSize: this.routingCache.max
        };
    }

    /**
     * 캐시 초기화
     */
    clear(): void {
        this.routingCache.clear();
        this.stats = { routingHits: 0, routingMisses: 0 };
        logger.info('캐시 초기화됨');
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
