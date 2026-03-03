/**
 * ============================================================
 * Semantic Classification Cache - 시맨틱 유사도 기반 분류 캐시
 * ============================================================
 *
 * LLM 쿼리 분류 결과를 임베딩 기반 시맨틱 유사도로 캐싱합니다.
 *
 * 2-Layer 캐시:
 *   L1 (exact-match)    → Map.get(normalized) — O(1), <1ms
 *   L2 (semantic-match)  → cosine similarity scan — O(n), ~10-30ms
 *
 * exact-match 히트율 ~18% → 시맨틱 캐시로 ~60-67%까지 개선 목표.
 *
 * @module chat/semantic-cache
 * @see chat/llm-classifier - 이 캐시를 사용하는 분류기
 */

import { createLogger } from '../utils/logger';
import type { QueryType } from './model-selector-types';

const logger = createLogger('SemanticCache');

// ============================================================
// 설정
// ============================================================

/** 기본 캐시 TTL (ms) — 30분 */
const DEFAULT_TTL_MS = 30 * 60 * 1000;

/** 기본 캐시 최대 크기 */
const DEFAULT_MAX_SIZE = 500;

/** 기본 시맨틱 유사도 임계값 (0.0~1.0) */
const DEFAULT_SIMILARITY_THRESHOLD = 0.88;

// ============================================================
// 타입 정의
// ============================================================

/** 시맨틱 캐시 엔트리 */
interface SemanticCacheEntry {
    /** 정규화된 쿼리 문자열 (exact-match 키) */
    normalizedQuery: string;
    /** 분류된 질문 유형 */
    type: QueryType;
    /** 분류 신뢰도 */
    confidence: number;
    /** 캐시 저장 시각 (TTL 기준) */
    timestamp: number;
    /** 마지막 접근 시각 (LRU 기준) */
    lastAccess: number;
    /** 임베딩 벡터 (null = 임베딩 실패, L1 전용 엔트리) */
    embedding: number[] | null;
}

/** 캐시 조회 결과 */
export interface SemanticCacheLookupResult {
    /** 캐시 히트 데이터 (null = 미스) */
    hit: { type: QueryType; confidence: number } | null;
    /** 히트 소스 ('cache' = L1 exact, 'semantic-cache' = L2 semantic, null = miss) */
    source: 'cache' | 'semantic-cache' | null;
    /** 쿼리 임베딩 벡터 (L2 조회 시 생성, miss 시에도 반환하여 재사용) */
    queryEmbedding: number[] | null;
}

/** 캐시 옵션 */
export interface SemanticCacheOptions {
    /** 캐시 TTL (ms) */
    ttlMs?: number;
    /** 캐시 최대 크기 */
    maxSize?: number;
    /** 시맨틱 유사도 임계값 */
    similarityThreshold?: number;
}

/** 임베딩 생성 함수 타입 (의존성 주입용) */
export type EmbedFunction = (text: string) => Promise<number[] | null>;

// ============================================================
// 코사인 유사도 (Pure TypeScript)
// ============================================================

/**
 * 두 벡터 간의 코사인 유사도를 계산합니다.
 *
 * cosine_similarity(a, b) = dot(a, b) / (||a|| * ||b||)
 *
 * @param a - 벡터 A
 * @param b - 벡터 B
 * @returns 유사도 (-1.0 ~ 1.0), 에러 시 0
 */
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0 || a.length !== b.length) {
        return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);

    if (denominator === 0) {
        return 0;
    }

    return dotProduct / denominator;
}

// ============================================================
// SemanticClassificationCache 클래스
// ============================================================

/**
 * 시맨틱 유사도 기반 분류 캐시
 *
 * L1 (exact-match) + L2 (embedding cosine similarity)
 * 인메모리 전용, TTL + LRU 하이브리드 퇴출 정책
 */
export class SemanticClassificationCache {
    private readonly ttlMs: number;
    private readonly maxSize: number;
    private readonly similarityThreshold: number;
    private readonly embedFn: EmbedFunction;

    /**
     * L1: exact-match 인덱스 (normalizedQuery → entries 배열 인덱스)
     * L2: entries 배열 순회 (cosine similarity)
     */
    private readonly exactIndex = new Map<string, number>();
    private readonly entries: Array<SemanticCacheEntry | null> = [];

    /** 모니터링용 통계 */
    private stats = {
        l1Hits: 0,
        l2Hits: 0,
        misses: 0,
        embedFailures: 0,
    };

    constructor(embedFn: EmbedFunction, options?: SemanticCacheOptions) {
        this.embedFn = embedFn;
        this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
        this.maxSize = options?.maxSize ?? DEFAULT_MAX_SIZE;
        this.similarityThreshold = options?.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
    }

    /**
     * 캐시를 조회합니다.
     *
     * 흐름:
     * 1. 정규화 → L1 exact-match 검색
     * 2. L1 미스 → 임베딩 생성 → L2 semantic-match 검색
     * 3. 모두 미스 → null 반환 (queryEmbedding은 함께 반환하여 caller가 set 시 재사용)
     *
     * @param query - 사용자 질문 텍스트
     * @returns 캐시 조회 결과
     */
    async get(query: string): Promise<SemanticCacheLookupResult> {
        const normalizedQuery = this.normalize(query);
        const now = Date.now();

        // ── L1: Exact-match ──
        const exactIdx = this.exactIndex.get(normalizedQuery);
        if (exactIdx !== undefined) {
            const entry = this.entries[exactIdx];
            if (entry && !this.isExpired(entry, now)) {
                // LRU 갱신
                entry.lastAccess = now;
                this.stats.l1Hits++;
                logger.debug(`L1 캐시 히트: "${query.substring(0, 30)}..." → ${entry.type}`);
                return {
                    hit: { type: entry.type, confidence: entry.confidence },
                    source: 'cache',
                    queryEmbedding: entry.embedding,
                };
            }
            // 만료된 엔트리 정리
            if (entry) {
                this.removeEntry(exactIdx);
            }
        }

        // ── L2: Semantic-match ──
        let queryEmbedding: number[] | null = null;
        try {
            queryEmbedding = await this.embedFn(normalizedQuery);
        } catch (error) {
            this.stats.embedFailures++;
            logger.debug('임베딩 생성 실패 — L2 스킵');
        }

        if (queryEmbedding && queryEmbedding.length > 0) {
            let bestSimilarity = -1;
            let bestEntry: SemanticCacheEntry | null = null;

            for (let i = 0; i < this.entries.length; i++) {
                const entry = this.entries[i];
                if (!entry || !entry.embedding) continue;
                if (this.isExpired(entry, now)) {
                    this.removeEntry(i);
                    continue;
                }

                const similarity = cosineSimilarity(queryEmbedding, entry.embedding);
                if (similarity >= this.similarityThreshold && similarity > bestSimilarity) {
                    bestSimilarity = similarity;
                    bestEntry = entry;
                }
            }

            if (bestEntry) {
                // LRU 갱신
                bestEntry.lastAccess = now;
                this.stats.l2Hits++;
                logger.debug(
                    `L2 캐시 히트: "${query.substring(0, 30)}..." → ${bestEntry.type} (similarity=${bestSimilarity.toFixed(3)})`
                );
                return {
                    hit: { type: bestEntry.type, confidence: bestEntry.confidence },
                    source: 'semantic-cache',
                    queryEmbedding,
                };
            }
        }

        // ── 미스 ──
        this.stats.misses++;
        return { hit: null, source: null, queryEmbedding };
    }

    /**
     * L1 exact-match만 조회합니다 (임베딩 호출 없음, 동기적).
     * 병렬 최적화용: L1 미스 시 임베딩 + LLM을 동시에 실행하기 위함.
     *
     * @param query - 사용자 질문 텍스트
     * @returns L1 히트 결과 또는 null
     */
    getExact(query: string): SemanticCacheLookupResult {
        const normalizedQuery = this.normalize(query);
        const now = Date.now();

        const exactIdx = this.exactIndex.get(normalizedQuery);
        if (exactIdx !== undefined) {
            const entry = this.entries[exactIdx];
            if (entry && !this.isExpired(entry, now)) {
                entry.lastAccess = now;
                this.stats.l1Hits++;
                logger.debug(`L1 캐시 히트 (exact): "${query.substring(0, 30)}..." → ${entry.type}`);
                return {
                    hit: { type: entry.type, confidence: entry.confidence },
                    source: 'cache',
                    queryEmbedding: entry.embedding,
                };
            }
            if (entry) {
                this.removeEntry(exactIdx);
            }
        }

        return { hit: null, source: null, queryEmbedding: null };
    }

    /**
     * L2 semantic-match만 조회합니다 (사전 생성된 임베딩 사용).
     * 병렬 최적화용: 이미 생성된 queryEmbedding으로 L2만 스캔.
     *
     * @param queryEmbedding - 사전 생성된 쿼리 임베딩 벡터
     * @returns L2 히트 결과 또는 null (queryEmbedding 포함)
     */
    searchSemantic(queryEmbedding: number[]): SemanticCacheLookupResult {
        const now = Date.now();

        if (!queryEmbedding || queryEmbedding.length === 0) {
            return { hit: null, source: null, queryEmbedding: null };
        }

        let bestSimilarity = -1;
        let bestEntry: SemanticCacheEntry | null = null;

        for (let i = 0; i < this.entries.length; i++) {
            const entry = this.entries[i];
            if (!entry || !entry.embedding) continue;
            if (this.isExpired(entry, now)) {
                this.removeEntry(i);
                continue;
            }

            const similarity = cosineSimilarity(queryEmbedding, entry.embedding);
            if (similarity >= this.similarityThreshold && similarity > bestSimilarity) {
                bestSimilarity = similarity;
                bestEntry = entry;
            }
        }

        if (bestEntry) {
            bestEntry.lastAccess = now;
            this.stats.l2Hits++;
            logger.debug(
                `L2 캐시 히트 (semantic): "${bestEntry.normalizedQuery.substring(0, 30)}..." → ${bestEntry.type} (similarity=${bestSimilarity.toFixed(3)})`
            );
            return {
                hit: { type: bestEntry.type, confidence: bestEntry.confidence },
                source: 'semantic-cache',
                queryEmbedding,
            };
        }

        this.stats.misses++;
        return { hit: null, source: null, queryEmbedding };
    }

    /**
     * 분류 결과를 캐시에 저장합니다.
     *
     * @param query - 사용자 질문 텍스트
     * @param type - 분류된 질문 유형
     * @param confidence - 분류 신뢰도
     * @param embedding - 쿼리 임베딩 벡터 (null 허용 — L1 전용 엔트리)
     */
    set(query: string, type: QueryType, confidence: number, embedding: number[] | null): void {
        const normalizedQuery = this.normalize(query);
        const now = Date.now();

        // 이미 존재하면 업데이트
        const existingIdx = this.exactIndex.get(normalizedQuery);
        if (existingIdx !== undefined && this.entries[existingIdx]) {
            const existing = this.entries[existingIdx]!;
            existing.type = type;
            existing.confidence = confidence;
            existing.timestamp = now;
            existing.lastAccess = now;
            // 기존 임베딩이 없고 새로 제공되면 업데이트
            if (!existing.embedding && embedding) {
                existing.embedding = embedding;
            }
            return;
        }

        // 최대 크기 제한 — LRU 기반으로 가장 오래 미접근 항목 제거
        this.evictIfNeeded();

        const entry: SemanticCacheEntry = {
            normalizedQuery,
            type,
            confidence,
            timestamp: now,
            lastAccess: now,
            embedding,
        };

        // 빈 슬롯 찾기 (삭제로 인한 null 슬롯 재사용)
        let insertIdx = this.entries.indexOf(null);
        if (insertIdx === -1) {
            insertIdx = this.entries.length;
            this.entries.push(entry);
        } else {
            this.entries[insertIdx] = entry;
        }

        this.exactIndex.set(normalizedQuery, insertIdx);
    }

    /** 활성 캐시 엔트리 수를 반환합니다 */
    size(): number {
        let count = 0;
        for (const entry of this.entries) {
            if (entry !== null) count++;
        }
        return count;
    }

    /** 캐시를 초기화합니다 */
    clear(): void {
        this.exactIndex.clear();
        this.entries.length = 0;
        this.stats = { l1Hits: 0, l2Hits: 0, misses: 0, embedFailures: 0 };
    }

    /** 모니터링 통계를 반환합니다 */
    getStats(): Readonly<typeof this.stats> {
        return { ...this.stats };
    }

    // ── Private helpers ──

    private normalize(query: string): string {
        return query.trim().toLowerCase();
    }

    private isExpired(entry: SemanticCacheEntry, now: number): boolean {
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
        // 활성 엔트리 수 계산
        let activeCount = 0;
        for (const entry of this.entries) {
            if (entry !== null) activeCount++;
        }

        if (activeCount < this.maxSize) return;

        // LRU: lastAccess가 가장 오래된 항목 제거
        let oldestIdx = -1;
        let oldestAccess = Infinity;

        for (let i = 0; i < this.entries.length; i++) {
            const entry = this.entries[i];
            if (entry && entry.lastAccess < oldestAccess) {
                oldestAccess = entry.lastAccess;
                oldestIdx = i;
            }
        }

        if (oldestIdx >= 0) {
            this.removeEntry(oldestIdx);
        }
    }
}
