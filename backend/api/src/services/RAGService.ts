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
import { VectorRepository, type VectorSearchResult } from '../data/repositories/vector-repository';
import { chunkDocument, type ChunkOptions } from '../documents/chunker';
import { RAG_CONFIG } from '../config/runtime-limits';
import type { RAGContext, RAGDocument } from '../chat/context-types';
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
 * 문서 인덱싱 결과
 */
export interface DocumentEmbedResult {
    /** 문서 ID */
    docId: string;
    /** 생성된 총 청크 수 */
    totalChunks: number;
    /** 성공적으로 저장된 청크 수 */
    storedChunks: number;
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
     * 문서를 청킹하여 FTS 인덱싱 DB에 저장합니다.
     *
     * 파이프라인: 텍스트 → 청크 분할 → DB 저장 (FTS용)
     *
     * @param request - 문서 인덱싱 요청
     * @returns 인덱싱 처리 결과
     */
    async embedDocument(request: DocumentEmbedRequest): Promise<DocumentEmbedResult> {
        const startTime = Date.now();
        const { docId, text, filename, userId, chunkOptions } = request;

        logger.info(`[RAG] 문서 인덱싱 시작: ${filename} (docId=${docId}, ${text.length}자)`);

        // 1. 기존 청크가 있으면 삭제 (재인덱싱 지원)
        const existed = await this.vectorRepo.hasChunks('document', docId);
        if (existed) {
            await this.vectorRepo.deleteBySource('document', docId);
            logger.info(`[RAG] 기존 청크 삭제 완료: ${docId}`);
        }

        // 2. 문서 청킹
        const chunks = chunkDocument(text, filename, chunkOptions);
        if (chunks.length === 0) {
            logger.warn(`[RAG] 청킹 결과 없음: ${filename}`);
            return { docId, totalChunks: 0, storedChunks: 0, durationMs: Date.now() - startTime };
        }
        logger.info(`[RAG] 청킹 완료: ${chunks.length}개 청크`);

        // 3. DB 저장 (FTS 인덱싱용)
        const chunkInputs = chunks.map(chunk => ({
            sourceType: 'document',
            sourceId: docId,
            chunkIndex: chunk.index,
            content: chunk.content,
            metadata: {
                filename,
                userId: userId ?? null,
                startOffset: chunk.startOffset,
                endOffset: chunk.endOffset,
                totalChunks: chunk.metadata.totalChunks,
            },
        }));

        const storedCount = await this.vectorRepo.storeChunks(chunkInputs);
        const durationMs = Date.now() - startTime;

        logger.info(`[RAG] 문서 인덱싱 완료: ${filename} → ${storedCount}/${chunks.length}개 저장 (${durationMs}ms)`);

        return {
            docId,
            totalChunks: chunks.length,
            storedChunks: storedCount,
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
        const { query, userId, docId, topK } = request;

        const results = await this.vectorRepo.searchLexical(query, {
            topK: topK ?? RAG_CONFIG.TOP_K,
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
        const { query, userId, docId, topK } = request;
        const finalTopK = topK ?? RAG_CONFIG.TOP_K;
        const retrievalWindow = Math.max(finalTopK * 4, 20);

        // FTS 렉시컬 검색
        const candidates = await this.vectorRepo.searchLexical(query, {
            topK: retrievalWindow,
            sourceType: 'document',
            sourceId: docId,
            userId,
        });

        logger.info(`[RAG Hybrid] lexical=${candidates.length}개 → Reranker`);

        if (candidates.length === 0) return [];

        // Cross-encoder Reranking
        try {
            const reranker = getReranker();
            return await reranker.rerank(query, candidates, finalTopK);
        } catch (error) {
            logger.warn('[RAG Hybrid] Reranker 실패 — lexical 결과로 fallback:', error);
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
     * 특정 문서에 청크가 존재하는지 확인합니다.
     */
    async hasDocumentChunks(docId: string): Promise<boolean> {
        return this.vectorRepo.hasChunks('document', docId);
    }

    /**
     * RAG 시스템 통계를 반환합니다.
     */
    async getStats(): Promise<{
        totalChunks: number;
        uniqueSources: number;
        sourceTypes: Record<string, number>;
    }> {
        return this.vectorRepo.getStats();
    }
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
