/**
 * ============================================================
 * RAGService - Retrieval-Augmented Generation 오케스트레이션
 * ============================================================
 *
 * 문서 청킹 → 임베딩 생성 → 벡터 저장 → 유사도 검색 → 컨텍스트 주입
 * 전체 RAG 파이프라인을 조율합니다.
 *
 * @module services/RAGService
 */

import { createLogger } from '../utils/logger';
import { getPool } from '../data/models/unified-database';
import { VectorRepository, type VectorSearchResult, type VectorEmbeddingInput } from '../data/repositories/vector-repository';
import { getEmbeddingService } from './EmbeddingService';
import { chunkDocument, type TextChunk, type ChunkOptions } from '../documents/chunker';
import { RAG_CONFIG } from '../config/runtime-limits';
import type { RAGContext, RAGDocument } from '../domains/chat/pipeline/context-types';
import { getReranker } from './Reranker';

const logger = createLogger('RAGService');

/**
 * 문서 임베딩 요청
 */
export interface DocumentEmbedRequest {
    /** 문서 ID */
    docId: string;
    /** 문서 텍스트 내용 */
    text: string;
    /** 문서 파일명 */
    filename: string;
    /** 소유 사용자 ID */
    userId?: string;
    /** 청킹 옵션 */
    chunkOptions?: ChunkOptions;
}

/**
 * 문서 임베딩 결과
 */
export interface DocumentEmbedResult {
    /** 문서 ID */
    docId: string;
    /** 생성된 총 청크 수 */
    totalChunks: number;
    /** 성공적으로 임베딩된 청크 수 */
    embeddedChunks: number;
    /** 처리 시간 (밀리초) */
    durationMs: number;
}

/**
 * RAG 검색 요청
 */
export interface RAGSearchRequest {
    /** 검색 쿼리 텍스트 */
    query: string;
    /** 사용자 ID (해당 사용자 문서만 검색) */
    userId?: string;
    /** 특정 문서 ID만 검색 */
    docId?: string;
    /** 반환할 최대 결과 수 */
    topK?: number;
    /** 최소 유사도 임계값 */
    threshold?: number;
}

/**
 * RAG 파이프라인 오케스트레이션 서비스
 */
export class RAGService {
    private vectorRepo: VectorRepository;

    constructor() {
        const pool = getPool();
        this.vectorRepo = new VectorRepository(pool);
    }

    /**
     * 문서를 청킹하고 임베딩을 생성하여 벡터 DB에 저장합니다.
     *
     * 파이프라인: 텍스트 → 청크 분할 → 배치 임베딩 → 벡터 저장
     *
     * @param request - 문서 임베딩 요청
     * @returns 임베딩 처리 결과
     */
    async embedDocument(request: DocumentEmbedRequest): Promise<DocumentEmbedResult> {
        const startTime = Date.now();
        const { docId, text, filename, userId, chunkOptions } = request;

        logger.info(`[RAG] 문서 임베딩 시작: ${filename} (docId=${docId}, ${text.length}자)`);

        // 1. 기존 임베딩이 있으면 삭제 (재임베딩 지원)
        const existed = await this.vectorRepo.hasEmbeddings('document', docId);
        if (existed) {
            await this.vectorRepo.deleteBySource('document', docId);
            logger.info(`[RAG] 기존 임베딩 삭제 완료: ${docId}`);
        }

        // 2. 문서 청킹
        const chunks = chunkDocument(text, filename, chunkOptions);
        if (chunks.length === 0) {
            logger.warn(`[RAG] 청킹 결과 없음: ${filename}`);
            return { docId, totalChunks: 0, embeddedChunks: 0, durationMs: Date.now() - startTime };
        }
        logger.info(`[RAG] 청킹 완료: ${chunks.length}개 청크`);

        // 3. 배치 임베딩 생성
        const embeddingService = getEmbeddingService();
        const chunkTexts = chunks.map(c => c.content);
        const embeddings = await embeddingService.embedBatch(chunkTexts);

        // 4. 벡터 DB 저장
        const embeddingInputs: VectorEmbeddingInput[] = [];
        for (let i = 0; i < chunks.length; i++) {
            const embedding = embeddings[i];
            if (embedding === null) continue;

            embeddingInputs.push({
                sourceType: 'document',
                sourceId: docId,
                chunkIndex: chunks[i].index,
                content: chunks[i].content,
                embedding,
                metadata: {
                    filename,
                    userId: userId ?? null,
                    startOffset: chunks[i].startOffset,
                    endOffset: chunks[i].endOffset,
                    totalChunks: chunks[i].metadata.totalChunks,
                },
            });
        }

        const storedCount = await this.vectorRepo.storeEmbeddings(embeddingInputs);
        const durationMs = Date.now() - startTime;

        logger.info(`[RAG] 문서 임베딩 완료: ${filename} → ${storedCount}/${chunks.length}개 저장 (${durationMs}ms)`);

        return {
            docId,
            totalChunks: chunks.length,
            embeddedChunks: storedCount,
            durationMs,
        };
    }

    /**
     * 쿼리 텍스트로 관련 문서 청크를 검색합니다.
     *
     * 파이프라인: 쿼리 → 임베딩 → 벡터 유사도 검색 → 결과 반환
     *
     * @param request - RAG 검색 요청
     * @returns 관련 문서 검색 결과
     */
    async search(request: RAGSearchRequest): Promise<VectorSearchResult[]> {
        const { query, userId, docId, topK, threshold } = request;

        // 1. 쿼리 임베딩 생성
        const embeddingService = getEmbeddingService();
        const queryEmbedding = await embeddingService.embedText(query);

        if (!queryEmbedding) {
            logger.warn('[RAG] 쿼리 임베딩 생성 실패 — 검색 중단');
            return [];
        }

        // 2. 벡터 유사도 검색
        const results = await this.vectorRepo.searchSimilar(queryEmbedding, {
            topK: topK ?? RAG_CONFIG.TOP_K,
            threshold: threshold ?? RAG_CONFIG.RELEVANCE_THRESHOLD,
            sourceType: 'document',
            sourceId: docId,
            userId,
        });

        logger.info(`[RAG] 검색 완료: "${query.substring(0, 50)}..." → ${results.length}개 결과`);
        return results;
    }

    /**
     * 하이브리드 검색 (Vector + FTS/BM25 + RRF 융합 + Cross-encoder Reranking)
     *
     * 3단계 파이프라인:
     * 1. 벡터 유사도 검색 (시맨틱) + FTS 렉시컬 검색 (BM25/tsvector)
     * 2. Reciprocal Rank Fusion으로 두 결과를 융합
     * 3. Cross-encoder Reranker로 최종 재순위화
     *
     * @param request - RAG 검색 요청
     * @returns 재순위화된 검색 결과
     */
    async searchHybrid(request: RAGSearchRequest): Promise<VectorSearchResult[]> {
        const { query, userId, docId, topK, threshold } = request;
        const finalTopK = topK ?? RAG_CONFIG.TOP_K;
        // Reranker에 충분한 후보를 제공하기 위해 넓은 창 사용 (최소 20)
        const retrievalWindow = Math.max(finalTopK * 4, 20);

        // 1. 쿼리 임베딩 생성
        const embeddingService = getEmbeddingService();
        const queryEmbedding = await embeddingService.embedText(query);

        // 2. 병렬 검색 실행 (Vector + FTS)
        const searchOptions = {
            topK: retrievalWindow,
            threshold: threshold ?? RAG_CONFIG.RELEVANCE_THRESHOLD,
            sourceType: 'document' as const,
            sourceId: docId,
            userId,
        };

        const [vectorResults, lexicalResults] = await Promise.all([
            queryEmbedding
                ? this.vectorRepo.searchSimilar(queryEmbedding, searchOptions)
                : Promise.resolve([]),
            this.vectorRepo.searchLexical(query, {
                topK: retrievalWindow,
                sourceType: 'document',
                sourceId: docId,
                userId,
            }),
        ]);

        logger.info(
            `[RAG Hybrid] vector=${vectorResults.length}개, lexical=${lexicalResults.length}개 → RRF 융합`
        );

        // 3. RRF 융합
        if (vectorResults.length === 0 && lexicalResults.length === 0) {
            return [];
        }

        let candidates: VectorSearchResult[];

        if (lexicalResults.length === 0) {
            candidates = vectorResults.slice(0, retrievalWindow);
        } else if (vectorResults.length === 0) {
            candidates = lexicalResults.slice(0, retrievalWindow);
        } else {
            // RRF로 넓은 후보 풀 생성 (reranker에 전달할 양)
            candidates = reciprocalRankFusion(vectorResults, lexicalResults, retrievalWindow);
        }

        // 4. Cross-encoder Reranking
        try {
            const reranker = getReranker();
            const reranked = await reranker.rerank(query, candidates, finalTopK);
            return reranked;
        } catch (error) {
            logger.warn('[RAG Hybrid] Reranker 실패 — RRF 결과로 fallback:', error);
            return candidates.slice(0, finalTopK);
        }
    }

    /**
     * RAG 검색 결과를 ContextEngineering용 RAGContext로 변환합니다.
     *
     * ChatService에서 setRAGContext()에 전달할 수 있는 형태로 변환합니다.
     *
     * @param query - 검색에 사용된 쿼리
     * @param results - 벡터 검색 결과
     * @returns RAGContext 객체
     */
    buildRAGContext(query: string, results: VectorSearchResult[]): RAGContext {
        const documents: RAGDocument[] = results.map(r => ({
            content: r.content,
            source: (r.metadata?.filename as string) ?? `${r.sourceType}/${r.sourceId}`,
            timestamp: r.createdAt,
            relevanceScore: r.similarity,
        }));

        return {
            documents,
            searchQuery: query,
            relevanceThreshold: RAG_CONFIG.RELEVANCE_THRESHOLD,
        };
    }

    /**
     * 채팅 메시지에 대한 RAG 컨텍스트를 생성합니다.
     *
     * 검색 → RAGContext 변환까지 한 번에 수행하는 편의 메서드입니다.
     *
     * @param query - 사용자 메시지
     * @param userId - 사용자 ID
     * @param docId - 특정 문서 ID (선택)
     * @returns RAGContext 또는 null (결과 없음)
     */
    async getRAGContextForChat(
        query: string,
        userId?: string,
        docId?: string,
    ): Promise<RAGContext | null> {
        // Adaptive Top-K: 쿼리 길이와 복잡도에 따라 검색 범위를 동적으로 조정
        // 짧은 쿼리(키워드 검색) → 적은 결과, 긴 복잡한 쿼리 → 넓은 검색
        const queryLen = query.trim().length;
        const hasMultipleSentences = (query.match(/[.?!。？！]\s/g) || []).length >= 1;
        let adaptiveTopK: number = RAG_CONFIG.TOP_K; // 기본 5
        if (queryLen > 100 || hasMultipleSentences) {
            adaptiveTopK = Math.min(RAG_CONFIG.TOP_K * 2, 10); // 복잡 쿼리 → 최대 10
        } else if (queryLen < 20) {
            adaptiveTopK = Math.max(Math.floor(RAG_CONFIG.TOP_K * 0.6), 3); // 짧은 쿼리 → 최소 3
        }

        const results = await this.search({ query, userId, docId, topK: adaptiveTopK });

        if (results.length === 0) {
            return null;
        }

        // 최대 컨텍스트 크기 제한
        let totalChars = 0;
        const limitedResults: VectorSearchResult[] = [];
        for (const r of results) {
            if (totalChars + r.content.length > RAG_CONFIG.MAX_CONTEXT_CHARS) break;
            limitedResults.push(r);
            totalChars += r.content.length;
        }

        return this.buildRAGContext(query, limitedResults);
    }

    /**
     * 특정 문서의 임베딩을 삭제합니다.
     */
    async deleteDocumentEmbeddings(docId: string): Promise<number> {
        return this.vectorRepo.deleteBySource('document', docId);
    }

    /**
     * 모든 문서의 임베딩을 일괄 삭제합니다.
     */
    async deleteAllDocumentEmbeddings(): Promise<number> {
        return this.vectorRepo.deleteBySourceType('document');
    }

    /**
     * 특정 문서에 임베딩이 존재하는지 확인합니다.
     */
    async hasDocumentEmbeddings(docId: string): Promise<boolean> {
        return this.vectorRepo.hasEmbeddings('document', docId);
    }

    /**
     * RAG 시스템 통계를 반환합니다.
     */
    async getStats(): Promise<{
        totalEmbeddings: number;
        uniqueSources: number;
        sourceTypes: Record<string, number>;
        embeddingModelAvailable: boolean;
    }> {
        const embeddingService = getEmbeddingService();
        const [dbStats, modelAvailable] = await Promise.all([
            this.vectorRepo.getStats(),
            embeddingService.isAvailable(),
        ]);

        return {
            ...dbStats,
            embeddingModelAvailable: modelAvailable,
        };
    }
}

/**
 * Reciprocal Rank Fusion (RRF) — 벡터 + 렉시컬 검색 결과를 융합합니다.
 *
 * 각 결과 리스트의 순위(rank)를 기반으로 점수를 계산하며,
 * 동일 문서가 두 리스트에 모두 등장하면 점수가 합산됩니다.
 *
 * score(d) = ∑ 1/(k + rank_i(d))
 *
 * @param vectorResults - 벡터 유사도 검색 결과 (순위 정렬됨)
 * @param lexicalResults - FTS 렉시컬 검색 결과 (순위 정렬됨)
 * @param topK - 반환할 최대 결과 수
 * @param k - RRF 상수 (기본: 60, 논문 권장값)
 * @returns RRF 점수 순으로 정렬된 검색 결과
 */
export function reciprocalRankFusion(
    vectorResults: VectorSearchResult[],
    lexicalResults: VectorSearchResult[],
    topK: number,
    k: number = 60,
): VectorSearchResult[] {
    const scores = new Map<number, number>();
    const metadataMap = new Map<number, VectorSearchResult>();

    // 벡터 결과 점수 계산
    vectorResults.forEach((r, i) => {
        const current = scores.get(r.id) ?? 0;
        scores.set(r.id, current + 1 / (k + i + 1));
        if (!metadataMap.has(r.id)) {
            metadataMap.set(r.id, r);
        }
    });

    // 렉시컬 결과 점수 합산
    lexicalResults.forEach((r, i) => {
        const current = scores.get(r.id) ?? 0;
        scores.set(r.id, current + 1 / (k + i + 1));
        if (!metadataMap.has(r.id)) {
            metadataMap.set(r.id, r);
        }
    });

    // RRF 점수 순 정렬 후 topK 반환
    return [...scores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, topK)
        .map(([id, score]) => {
            const original = metadataMap.get(id)!;
            return {
                ...original,
                similarity: score, // RRF 점수로 대체
            };
        });
}

// 싱글톤 팩토리
let instance: RAGService | null = null;

/**
 * RAGService 싱글톤 인스턴스를 반환합니다.
 */
export function getRAGService(): RAGService {
    if (!instance) {
        instance = new RAGService();
    }
    return instance;
}
