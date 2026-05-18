/**
 * ============================================================
 * Semantic Agent Router (PoC) — 임베딩 기반 에이전트 라우팅
 * ============================================================
 *
 * 기존 키워드 라우터(topic-analyzer + keyword-router)의 한계를 보완하기 위한
 * 임베딩 기반 의미 라우팅 PoC. shadow mode로 시작하여 키워드 결과와 비교 후
 * 안정성이 확인되면 본격 라우팅으로 승격합니다.
 *
 * 설계 원칙:
 * - embed 함수는 외부 주입(테스트 가능성 + LLMClient 의존성 분리)
 * - 인덱스는 lazy 초기화 (서버 시작 비용 분산)
 * - 사용자 메시지 임베딩은 LRU 캐시로 비용 절감
 * - 인덱스 갱신은 이벤트 훅으로 (에이전트 변경 시 외부에서 invalidateIndex 호출)
 *
 * @module agents/semantic-router
 */
import { createLogger } from '../utils/logger';
import type { Agent } from './types';
import { loadCache, saveCache, lookupEmbedding, storeEmbedding } from './semantic-cache';

const logger = createLogger('SemanticAgentRouter');

/** 외부 주입 가능한 임베딩 함수 시그니처 */
export type EmbedFunction = (text: string) => Promise<number[]>;

/** 인덱싱된 에이전트 엔트리 */
interface IndexedAgent {
    agentId: string;
    agentName: string;
    category: string;
    description: string;
    embedding: number[];
}

/** 라우팅 후보 결과 */
export interface AgentCandidate {
    agentId: string;
    agentName: string;
    category: string;
    similarity: number;
}

/** 라우터 통계 (관측성용) */
export interface RouterStatistics {
    indexedAgentCount: number;
    indexBuildDurationMs: number;
    indexBuildCompletedAt?: number;
    queryEmbeddingCacheSize: number;
    queryEmbeddingCacheHits: number;
    queryEmbeddingCacheMisses: number;
    routingCallCount: number;
    /** 마지막 인덱싱에서 디스크 캐시 hit (재사용된 임베딩) */
    lastIndexDiskCacheHits: number;
    /** 마지막 인덱싱에서 디스크 캐시 miss (새로 임베딩) */
    lastIndexDiskCacheMisses: number;
}

/**
 * 코사인 유사도 (vector-cache.ts와 동일 계산식, 모듈 독립성 위해 로컬 정의)
 */
function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

/** 인덱싱 입력 — 카테고리별 에이전트 묶음 */
export interface AgentIndexInput {
    categoryName: string;
    agents: Agent[];
}

/** 옵션 */
export interface SemanticAgentRouterOptions {
    /** 사용자 메시지 임베딩 LRU 캐시 최대 크기 (기본 200) */
    queryCacheMaxSize?: number;
    /** 디스크 캐시 파일 경로 (지정 시 인덱싱 시 자동 hit/miss 처리) */
    diskCachePath?: string;
    /** 디스크 캐시에 저장될 임베딩 모델 식별자 (모델 변경 시 자동 무효화) */
    embeddingModel?: string;
}

export class SemanticAgentRouter {
    private index: IndexedAgent[] = [];
    private indexBuildDurationMs = 0;
    private indexBuildCompletedAt?: number;
    private readonly embed: EmbedFunction;
    private readonly queryCacheMaxSize: number;
    private readonly queryCache = new Map<string, number[]>();
    private readonly diskCachePath: string | undefined;
    private readonly embeddingModel: string;
    private cacheHits = 0;
    private cacheMisses = 0;
    private routingCallCount = 0;
    private lastDiskCacheHits = 0;
    private lastDiskCacheMisses = 0;

    constructor(embed: EmbedFunction, options: SemanticAgentRouterOptions = {}) {
        this.embed = embed;
        this.queryCacheMaxSize = options.queryCacheMaxSize ?? 200;
        this.diskCachePath = options.diskCachePath;
        this.embeddingModel = options.embeddingModel ?? 'unknown';
    }

    /**
     * 에이전트 인덱스를 구축합니다 (한 번 호출 후 invalidateIndex 전까지 유효).
     * description + keywords를 단일 텍스트로 결합하여 임베딩합니다.
     *
     * 디스크 캐시 사용 시 (diskCachePath 옵션):
     * - hash 일치 + 모델 일치 → 캐시 재사용 (임베딩 호출 0)
     * - 그 외 → 새로 임베딩 후 캐시 갱신
     * - 인덱싱 종료 시 atomic write로 디스크 저장
     */
    async initializeIndex(input: AgentIndexInput[]): Promise<void> {
        const startTime = Date.now();
        const newIndex: IndexedAgent[] = [];

        const cache = this.diskCachePath ? loadCache(this.diskCachePath) : null;
        let diskHits = 0;
        let diskMisses = 0;
        let modelMismatches = 0;

        for (const { categoryName, agents } of input) {
            for (const agent of agents) {
                const embedText = this.buildEmbedText(agent);

                // 디스크 캐시 lookup
                if (cache) {
                    const lookup = lookupEmbedding(cache, embedText, this.embeddingModel);
                    if (lookup.hit && lookup.embedding) {
                        diskHits++;
                        newIndex.push({
                            agentId: agent.id,
                            agentName: agent.name,
                            category: categoryName,
                            description: agent.description,
                            embedding: lookup.embedding,
                        });
                        continue;
                    }
                    if (lookup.modelMismatch) modelMismatches++;
                }

                try {
                    const embedding = await this.embed(embedText);
                    newIndex.push({
                        agentId: agent.id,
                        agentName: agent.name,
                        category: categoryName,
                        description: agent.description,
                        embedding,
                    });
                    if (cache) {
                        storeEmbedding(cache, embedText, embedding, this.embeddingModel);
                        diskMisses++;
                    }
                } catch (e) {
                    logger.warn(`에이전트 임베딩 실패 (스킵): ${agent.id}`, e);
                }
            }
        }

        // 캐시 변경 시 디스크에 저장
        if (cache && this.diskCachePath && diskMisses > 0) {
            try {
                saveCache(cache, this.diskCachePath);
            } catch (e) {
                logger.warn('디스크 캐시 저장 실패 (인덱스는 정상):', e instanceof Error ? e.message : e);
            }
        }

        this.lastDiskCacheHits = diskHits;
        this.lastDiskCacheMisses = diskMisses;
        this.index = newIndex;
        this.indexBuildDurationMs = Date.now() - startTime;
        this.indexBuildCompletedAt = Date.now();

        const cacheInfo = cache
            ? ` (디스크 캐시: hit=${diskHits}, miss=${diskMisses}, modelMismatch=${modelMismatches})`
            : '';
        logger.info(
            `Semantic 인덱스 구축 완료: ${newIndex.length}명 / ${this.indexBuildDurationMs}ms${cacheInfo}`
        );
    }

    /**
     * 인덱스 무효화 — 에이전트 변경 시 외부에서 호출하여 재구축 트리거
     */
    invalidateIndex(): void {
        this.index = [];
        this.indexBuildCompletedAt = undefined;
        logger.info('Semantic 인덱스 무효화됨');
    }

    /**
     * 인덱스 구축 여부 확인
     */
    isIndexReady(): boolean {
        return this.index.length > 0;
    }

    /**
     * 사용자 메시지에 대한 top-K 에이전트 후보 반환
     * 메시지 임베딩은 LRU 캐싱되어 동일 메시지 반복 호출 시 비용 절감
     */
    async findCandidates(message: string, topK = 3): Promise<AgentCandidate[]> {
        if (!this.isIndexReady()) {
            logger.debug('인덱스 미구축 → 빈 후보 반환');
            return [];
        }

        this.routingCallCount++;
        const queryEmbedding = await this.getQueryEmbedding(message);

        const scored = this.index.map((entry) => ({
            agentId: entry.agentId,
            agentName: entry.agentName,
            category: entry.category,
            similarity: cosineSimilarity(queryEmbedding, entry.embedding),
        }));

        scored.sort((a, b) => b.similarity - a.similarity);
        return scored.slice(0, topK);
    }

    /**
     * shadow mode 비교 헬퍼:
     * 키워드 라우터의 결과 agentId가 임베딩 라우터 top-K에 포함되는지 검증
     * 운영 데이터 수집용
     */
    async compareWithKeywordResult(
        message: string,
        keywordAgentId: string,
        topK = 3
    ): Promise<{
        keywordAgentId: string;
        topCandidates: AgentCandidate[];
        keywordInTopK: boolean;
        keywordRank: number; // -1이면 top-K 밖
        topSimilarity: number;
    }> {
        const candidates = await this.findCandidates(message, topK);
        const keywordRank = candidates.findIndex((c) => c.agentId === keywordAgentId);
        return {
            keywordAgentId,
            topCandidates: candidates,
            keywordInTopK: keywordRank >= 0,
            keywordRank,
            topSimilarity: candidates[0]?.similarity ?? 0,
        };
    }

    getStatistics(): RouterStatistics {
        return {
            indexedAgentCount: this.index.length,
            indexBuildDurationMs: this.indexBuildDurationMs,
            indexBuildCompletedAt: this.indexBuildCompletedAt,
            queryEmbeddingCacheSize: this.queryCache.size,
            queryEmbeddingCacheHits: this.cacheHits,
            queryEmbeddingCacheMisses: this.cacheMisses,
            routingCallCount: this.routingCallCount,
            lastIndexDiskCacheHits: this.lastDiskCacheHits,
            lastIndexDiskCacheMisses: this.lastDiskCacheMisses,
        };
    }

    private buildEmbedText(agent: Agent): string {
        const keywordPart = agent.keywords && agent.keywords.length > 0
            ? `\nKeywords: ${agent.keywords.join(', ')}`
            : '';
        return `${agent.name}\n${agent.description}${keywordPart}`;
    }

    private async getQueryEmbedding(message: string): Promise<number[]> {
        const cached = this.queryCache.get(message);
        if (cached) {
            this.cacheHits++;
            // LRU: 최근 사용 항목을 맵 끝으로 이동
            this.queryCache.delete(message);
            this.queryCache.set(message, cached);
            return cached;
        }

        this.cacheMisses++;
        const embedding = await this.embed(message);

        if (this.queryCache.size >= this.queryCacheMaxSize) {
            // 가장 오래된 항목 제거 (LRU)
            const firstKey = this.queryCache.keys().next().value;
            if (firstKey !== undefined) {
                this.queryCache.delete(firstKey);
            }
        }
        this.queryCache.set(message, embedding);
        return embedding;
    }
}
