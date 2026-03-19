/**
 * ============================================================
 * Classification Cache - L1 Exact-Match 분류 캐시
 * ============================================================
 *
 * LLM 쿼리 분류 결과를 exact-match로 캐싱합니다.
 * TTL + LRU 하이브리드 퇴출 정책.
 *
 * @module chat/semantic-cache
 * @see chat/llm-classifier - 이 캐시를 사용하는 분류기
 */

import { createLogger } from '../utils/logger';
import type { QueryType } from './model-selector-types';

const logger = createLogger('ClassificationCache');

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_SIZE = 500;

interface CacheEntry {
    normalizedQuery: string;
    type: QueryType;
    confidence: number;
    timestamp: number;
    lastAccess: number;
}

export interface SemanticCacheLookupResult {
    hit: { type: QueryType; confidence: number } | null;
    source: 'cache' | null;
}

export interface SemanticCacheOptions {
    ttlMs?: number;
    maxSize?: number;
}

export class SemanticClassificationCache {
    private readonly ttlMs: number;
    private readonly maxSize: number;
    private readonly exactIndex = new Map<string, number>();
    private readonly entries: Array<CacheEntry | null> = [];
    private stats = { l1Hits: 0, misses: 0 };

    constructor(options?: SemanticCacheOptions) {
        this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
        this.maxSize = options?.maxSize ?? DEFAULT_MAX_SIZE;
    }

    getExact(query: string): SemanticCacheLookupResult {
        const normalizedQuery = this.normalize(query);
        const now = Date.now();

        const exactIdx = this.exactIndex.get(normalizedQuery);
        if (exactIdx !== undefined) {
            const entry = this.entries[exactIdx];
            if (entry && !this.isExpired(entry, now)) {
                entry.lastAccess = now;
                this.stats.l1Hits++;
                logger.debug(`캐시 히트: "${query.substring(0, 30)}..." → ${entry.type}`);
                return { hit: { type: entry.type, confidence: entry.confidence }, source: 'cache' };
            }
            if (entry) this.removeEntry(exactIdx);
        }

        this.stats.misses++;
        return { hit: null, source: null };
    }

    set(query: string, type: QueryType, confidence: number): void {
        const normalizedQuery = this.normalize(query);
        const now = Date.now();

        const existingIdx = this.exactIndex.get(normalizedQuery);
        if (existingIdx !== undefined && this.entries[existingIdx]) {
            const existing = this.entries[existingIdx]!;
            existing.type = type;
            existing.confidence = confidence;
            existing.timestamp = now;
            existing.lastAccess = now;
            return;
        }

        this.evictIfNeeded();

        const entry: CacheEntry = { normalizedQuery, type, confidence, timestamp: now, lastAccess: now };

        let insertIdx = this.entries.indexOf(null);
        if (insertIdx === -1) {
            insertIdx = this.entries.length;
            this.entries.push(entry);
        } else {
            this.entries[insertIdx] = entry;
        }

        this.exactIndex.set(normalizedQuery, insertIdx);
    }

    size(): number {
        let count = 0;
        for (const entry of this.entries) {
            if (entry !== null) count++;
        }
        return count;
    }

    clear(): void {
        this.exactIndex.clear();
        this.entries.length = 0;
        this.stats = { l1Hits: 0, misses: 0 };
    }

    getStats(): { l1Hits: number; misses: number; size: number; maxSize: number; hitRate: number } {
        const total = this.stats.l1Hits + this.stats.misses;
        const hitRate = total > 0 ? Math.round((this.stats.l1Hits / total) * 10000) / 100 : 0;
        return {
            l1Hits: this.stats.l1Hits,
            misses: this.stats.misses,
            size: this.size(),
            maxSize: this.maxSize,
            hitRate,
        };
    }

    private normalize(query: string): string {
        return query.trim().toLowerCase();
    }

    private isExpired(entry: CacheEntry, now: number): boolean {
        return now - entry.timestamp > this.ttlMs;
    }

    private removeEntry(idx: number): void {
        const entry = this.entries[idx];
        if (entry) {
            this.exactIndex.delete(entry.normalizedQuery);
            this.entries[idx] = null;
        }
    }

    private evictIfNeeded(): void {
        let activeCount = 0;
        for (const entry of this.entries) {
            if (entry !== null) activeCount++;
        }
        if (activeCount < this.maxSize) return;

        let oldestIdx = -1;
        let oldestAccess = Infinity;
        for (let i = 0; i < this.entries.length; i++) {
            const entry = this.entries[i];
            if (entry && entry.lastAccess < oldestAccess) {
                oldestAccess = entry.lastAccess;
                oldestIdx = i;
            }
        }
        if (oldestIdx >= 0) this.removeEntry(oldestIdx);
    }
}
