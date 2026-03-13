/**
 * @module rag/embedding-service
 * @description 문서 임베딩 생성 서비스
 *
 * 문서 텍스트를 청크로 분할하고, OllamaClient를 통해 임베딩 벡터를 생성한 뒤
 * VectorRepository에 저장합니다. 기존 임베딩이 있으면 삭제 후 재생성합니다.
 */

import { OllamaClient } from '../ollama/client';
import { VectorRepository, type VectorEmbeddingInput } from '../data/repositories/vector-repository';
import { getPool } from '../data/models/unified-database';
import { getConfig } from '../config';
import { chunkText } from './chunker';
import { getCacheSystem } from '../cache';
import { createLogger } from '../utils/logger';
import type { Pool } from 'pg';

const logger = createLogger('EmbeddingService');

/** 임베딩 배치 크기 (한 번에 OllamaClient.embed()에 전달할 청크 수) */
const EMBEDDING_BATCH_SIZE = 32;

/**
 * 문서를 인덱싱합니다 (청크 분할 → 임베딩 생성 → DB 저장).
 *
 * @param docId - 문서 식별자
 * @param filename - 문서 파일명
 * @param text - 문서 전체 텍스트
 */
export async function indexDocument(docId: string, filename: string, text: string): Promise<void> {
    const config = getConfig();
    const vectorRepo = new VectorRepository(getPool());

    logger.info(`문서 인덱싱 시작: ${filename} (docId=${docId}, ${text.length}자)`);

    // 기존 임베딩 삭제 (재인덱싱 시)
    await vectorRepo.deleteBySource('document', docId);

    // 텍스트 청크 분할
    const chunks = chunkText(text, config.chunkSize, config.chunkOverlap);
    if (chunks.length === 0) {
        logger.warn(`문서 인덱싱 건너뜀: 텍스트가 비어 있음 (docId=${docId})`);
        return;
    }

    logger.info(`청크 분할 완료: ${chunks.length}개 청크`);

    // OllamaClient 생성 (임베딩 전용)
    const ollamaClient = new OllamaClient({ baseUrl: config.ollamaBaseUrl });
    const cache = getCacheSystem();

    // 배치 단위로 임베딩 생성 및 저장
    for (let batchStart = 0; batchStart < chunks.length; batchStart += EMBEDDING_BATCH_SIZE) {
        const batch = chunks.slice(batchStart, batchStart + EMBEDDING_BATCH_SIZE);
        const textsToEmbed: string[] = [];
        const cachedEmbeddings: Map<number, number[]> = new Map();

        // 캐시 확인
        for (let i = 0; i < batch.length; i++) {
            const cached = cache.getEmbedding(batch[i].text);
            if (cached) {
                cachedEmbeddings.set(i, cached);
            } else {
                textsToEmbed.push(batch[i].text);
            }
        }

        // 캐시에 없는 텍스트만 임베딩 생성
        let newEmbeddings: number[][] = [];
        if (textsToEmbed.length > 0) {
            newEmbeddings = await ollamaClient.embed(textsToEmbed, config.embeddingModel);

            // 캐시에 저장
            for (let i = 0; i < textsToEmbed.length; i++) {
                cache.setEmbedding(textsToEmbed[i], newEmbeddings[i]);
            }
        }

        // 캐시 결과와 새 임베딩 병합
        const embeddings: VectorEmbeddingInput[] = [];
        let newEmbIdx = 0;

        for (let i = 0; i < batch.length; i++) {
            const embedding = cachedEmbeddings.get(i) || newEmbeddings[newEmbIdx++];
            embeddings.push({
                sourceType: 'document',
                sourceId: docId,
                chunkIndex: batch[i].index,
                content: batch[i].text,
                embedding,
                metadata: { documentName: filename },
            });
        }

        // DB에 저장
        await vectorRepo.storeEmbeddings(embeddings);
        logger.debug(`배치 임베딩 저장 완료: ${batchStart + 1}~${batchStart + batch.length} / ${chunks.length}`);
    }

    logger.info(`문서 인덱싱 완료: ${filename} (${chunks.length}개 청크 저장)`);
}

/**
 * 문서의 임베딩을 삭제합니다.
 *
 * @param docId - 삭제할 문서 식별자
 */
export async function deleteDocumentEmbeddings(docId: string): Promise<void> {
    const vectorRepo = new VectorRepository(getPool());
    await vectorRepo.deleteBySource('document', docId);
}

/**
 * 인덱싱된 문서 목록을 조회합니다.
 */
export async function getIndexedDocuments(): Promise<Array<{
    sourceId: string;
    documentName: string;
    chunkCount: number;
}>> {
    const pool = getPool() as Pool;
    const result = await pool.query<{
        source_id: string;
        document_name: string;
        chunk_count: string;
    }>(
        `SELECT source_id,
                COALESCE(metadata->>'documentName', 'unknown') as document_name,
                COUNT(*)::text as chunk_count
         FROM vector_embeddings
         WHERE source_type = 'document'
         GROUP BY source_id, metadata->>'documentName'
         ORDER BY MIN(created_at) DESC`
    );
    return result.rows.map(row => ({
        sourceId: row.source_id,
        documentName: row.document_name,
        chunkCount: parseInt(row.chunk_count, 10),
    }));
}
