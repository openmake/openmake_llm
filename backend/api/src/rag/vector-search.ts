/**
 * @module rag/vector-search
 * @description 벡터 유사도 기반 문서 검색 모듈
 *
 * 사용자 질의를 임베딩한 후 pgvector DB에서 유사한 청크를 검색하여
 * RAGDocument 형태로 반환합니다.
 */

import { OllamaClient } from '../ollama/client';
import { VectorRepository } from '../data/repositories/vector-repository';
import { getPool } from '../data/models/unified-database';
import { getConfig } from '../config';
import { getCacheSystem } from '../cache';
import { createLogger } from '../utils/logger';
import type { RAGDocument } from '../domains/chat/pipeline/context-types';

const logger = createLogger('VectorSearch');

export interface VectorSearchOptions {
    /** 반환할 최대 결과 수 (기본: 5) */
    topK?: number;
    /** 유사도 임계값 (기본: 0.3) */
    threshold?: number;
    /** 특정 문서로 필터링 */
    sourceId?: string;
}

/**
 * 질의에 유사한 문서 청크를 검색합니다.
 *
 * @param query - 검색 질의 텍스트
 * @param options - 검색 옵션
 * @returns RAGDocument 배열 (유사도 내림차순 정렬)
 */
export async function searchSimilarChunks(
    query: string,
    options?: VectorSearchOptions
): Promise<RAGDocument[]> {
    const config = getConfig();
    const topK = options?.topK ?? config.ragTopK;
    const threshold = options?.threshold ?? config.ragRelevanceThreshold;
    const sourceId = options?.sourceId;

    if (!query || query.trim().length === 0) {
        return [];
    }

    // 질의 임베딩 생성 (캐시 활용)
    const cache = getCacheSystem();
    let queryEmbedding = cache.getEmbedding(query);

    if (!queryEmbedding) {
        const ollamaClient = new OllamaClient({ baseUrl: config.ollamaBaseUrl });
        const embeddings = await ollamaClient.embed(query, config.embeddingModel);
        queryEmbedding = embeddings[0];
        cache.setEmbedding(query, queryEmbedding);
    }

    // DB에서 유사도 검색
    const vectorRepo = new VectorRepository(getPool());
    const results = await vectorRepo.searchSimilar(queryEmbedding, {
        topK,
        threshold,
        sourceType: 'document',
        sourceId,
    });

    if (results.length === 0) {
        logger.debug(`벡터 검색 결과 없음: "${query.substring(0, 50)}..." (threshold=${threshold})`);
        return [];
    }

    // RAGDocument 형태로 변환
    const documents: RAGDocument[] = results.map(row => {
        const documentName = (row.metadata?.documentName as string) || 'unknown';
        return {
            content: row.content,
            source: documentName,
            timestamp: row.createdAt,
            relevanceScore: row.similarity,
        };
    });

    logger.debug(`벡터 검색 완료: ${documents.length}개 결과 (query="${query.substring(0, 50)}...")`);
    return documents;
}
