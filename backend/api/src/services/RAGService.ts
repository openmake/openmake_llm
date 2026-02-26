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
import type { RAGContext, RAGDocument } from '../chat/context-types';

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
        const results = await this.search({ query, userId, docId });

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
