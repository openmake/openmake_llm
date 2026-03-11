/**
 * ============================================================
 * VectorRepository - 벡터 임베딩 저장 및 검색 리포지토리
 * ============================================================
 *
 * vector_embeddings 테이블에 대한 CRUD 및 유사도 검색을 제공합니다.
 * pgvector 확장을 기반으로 동작합니다.
 *
 * @module data/repositories/vector-repository
 * @extends BaseRepository
 */

import { Pool } from 'pg';
import { BaseRepository, QueryParam } from './base-repository';
import { createLogger } from '../../utils/logger';

const logger = createLogger('VectorRepository');

/**
 * 벡터 임베딩 저장용 데이터 구조
 */
export interface VectorEmbeddingInput {
    /** 소스 유형 (예: 'document', 'conversation') */
    sourceType: string;
    /** 소스 식별자 (예: docId, conversationId) */
    sourceId: string;
    /** 청크 순서 인덱스 */
    chunkIndex: number;
    /** 청크 텍스트 내용 */
    content: string;
    /** 임베딩 벡터 */
    embedding: number[];
    /** 추가 메타데이터 (JSON) */
    metadata?: Record<string, unknown>;
}

/**
 * 벡터 검색 결과
 */
export interface VectorSearchResult {
    /** 레코드 ID */
    id: number;
    /** 소스 유형 */
    sourceType: string;
    /** 소스 식별자 */
    sourceId: string;
    /** 청크 인덱스 */
    chunkIndex: number;
    /** 청크 텍스트 내용 */
    content: string;
    /** 메타데이터 */
    metadata: Record<string, unknown>;
    /** 코사인 유사도 점수 (0.0~1.0) */
    similarity: number;
    /** 생성 시각 */
    createdAt: string;
}

/**
 * 벡터 검색 옵션
 */
export interface VectorSearchOptions {
    /** 반환할 최대 결과 수 */
    topK?: number;
    /** 최소 유사도 임계값 (0.0~1.0) */
    threshold?: number;
    /** 소스 유형 필터 */
    sourceType?: string;
    /** 소스 ID 필터 */
    sourceId?: string;
    /** 사용자 ID 필터 (metadata.userId) */
    userId?: string;
}

/**
 * 벡터 임베딩 저장 및 유사도 검색 리포지토리
 */
export class VectorRepository extends BaseRepository {
    /** pgvector 확장 사용 가능 여부 (null = 미확인) */
    private pgvectorAvailable: boolean | null = null;

    constructor(pool: Pool) {
        super(pool);
    }

    /**
     * pgvector 확장 사용 가능 여부를 확인합니다.
     */
    private async checkPgvectorAvailable(): Promise<boolean> {
        if (this.pgvectorAvailable !== null) {
            return this.pgvectorAvailable;
        }

        try {
            const result = await this.query<{ exists: boolean }>(
                `SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') as exists`
            );
            this.pgvectorAvailable = result.rows[0]?.exists ?? false;
            if (this.pgvectorAvailable) {
                logger.info('pgvector 확장: 사용 가능');
            } else {
                logger.error('pgvector 확장: 미설치 (필수 의존성 누락 상태)');
            }
        } catch {
            this.pgvectorAvailable = false;
            logger.error('pgvector 확장 확인 실패 — 필수 의존성 상태 확인 필요');
        }

        return this.pgvectorAvailable;
    }

    /**
     * 벡터 임베딩을 저장합니다.
     *
     * @param embeddings - 저장할 임베딩 데이터 배열
     * @returns 저장된 레코드 수
     */
    async storeEmbeddings(embeddings: VectorEmbeddingInput[]): Promise<number> {
        if (embeddings.length === 0) return 0;

        let storedCount = 0;
        const BATCH_SIZE = 200;
        const COLUMNS_PER_ROW = 6;

        for (let i = 0; i < embeddings.length; i += BATCH_SIZE) {
            const batch = embeddings.slice(i, i + BATCH_SIZE);

            try {
                // 배치 VALUES 절 생성: ($1, $2, $3, $4, $5, $6::jsonb), ($7, $8, ...)
                const valueClauses = batch.map((_, j) => {
                    const base = j * COLUMNS_PER_ROW;
                    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::jsonb)`;
                }).join(', ');

                const params: QueryParam[] = batch.flatMap(item => [
                    item.sourceType,
                    item.sourceId,
                    item.chunkIndex,
                    item.content,
                    `[${item.embedding.join(',')}]`,
                    JSON.stringify(item.metadata ?? {}),
                ]);

                const result = await this.query(
                    `INSERT INTO vector_embeddings (source_type, source_id, chunk_index, content, embedding, metadata)
                     VALUES ${valueClauses}`,
                    params
                );
                storedCount += result.rowCount ?? batch.length;
            } catch (error) {
                // 배치 실패 시 개별 INSERT로 fallback (부분 저장 보장)
                logger.warn(`배치 INSERT 실패 (offset=${i}, size=${batch.length}) — 개별 INSERT로 fallback:`, error);
                for (const item of batch) {
                    try {
                        const embeddingValue = `[${item.embedding.join(',')}]`;
                        await this.query(
                            `INSERT INTO vector_embeddings (source_type, source_id, chunk_index, content, embedding, metadata)
                             VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
                            [item.sourceType, item.sourceId, item.chunkIndex, item.content, embeddingValue, JSON.stringify(item.metadata ?? {})]
                        );
                        storedCount++;
                    } catch (innerError) {
                        logger.error(`임베딩 저장 실패 (source=${item.sourceType}/${item.sourceId}, chunk=${item.chunkIndex}):`, innerError);
                    }
                }
            }
        }

        logger.info(`임베딩 저장 완료: ${storedCount}/${embeddings.length}개 (배치 크기=${BATCH_SIZE})`);
        return storedCount;
    }

    /**
     * 쿼리 벡터와 유사한 임베딩을 검색합니다.
     *
     * pgvector가 설치된 경우 코사인 유사도(`<=>`)를 사용하고,
     * 미설치 시에는 빈 결과를 반환합니다 (TEXT 컬럼은 벡터 검색 불가).
     *
     * @param queryEmbedding - 검색 쿼리 임베딩 벡터
     * @param options - 검색 옵션
     * @returns 유사도 순으로 정렬된 검색 결과
     */
    async searchSimilar(queryEmbedding: number[], options?: VectorSearchOptions): Promise<VectorSearchResult[]> {
        const hasPgvector = await this.checkPgvectorAvailable();

        if (!hasPgvector) {
            logger.warn('pgvector 미설치 — 벡터 검색 불가, 빈 결과 반환');
            return [];
        }

        const topK = options?.topK ?? 5;
        const threshold = options?.threshold ?? 0.3;
        const embeddingStr = `[${queryEmbedding.join(',')}]`;

        // 동적 WHERE 절 구성
        const conditions: string[] = [];
        const params: QueryParam[] = [embeddingStr];
        let paramIndex = 2;

        if (options?.sourceType) {
            conditions.push(`source_type = $${paramIndex++}`);
            params.push(options.sourceType);
        }
        if (options?.sourceId) {
            conditions.push(`source_id = $${paramIndex++}`);
            params.push(options.sourceId);
        }
        if (options?.userId) {
            conditions.push(`(metadata->>'userId' = $${paramIndex} OR metadata->>'userId' IS NULL)`);
            params.push(options.userId);
            paramIndex++;
        }

        const whereClause = conditions.length > 0
            ? `WHERE ${conditions.join(' AND ')}`
            : '';

        // pgvector 코사인 거리: <=> 연산자는 거리(0=동일, 2=반대)를 반환
        // 유사도 = 1 - 거리
        params.push(threshold);
        params.push(topK);

        const thresholdParamIdx = paramIndex++;
        const limitParamIdx = paramIndex;

        const sql = `
            SELECT * FROM (
                SELECT
                    id,
                    source_type,
                    source_id,
                    chunk_index,
                    content,
                    metadata,
                    created_at,
                    1 - (embedding <=> $1::vector) as similarity
                FROM vector_embeddings
                ${whereClause}
                ORDER BY embedding <=> $1::vector ASC
            ) ranked
            WHERE similarity >= $${thresholdParamIdx}
            LIMIT $${limitParamIdx}
        `;

        try {
            const result = await this.query<{
                id: number;
                source_type: string;
                source_id: string;
                chunk_index: number;
                content: string;
                metadata: Record<string, unknown>;
                created_at: string;
                similarity: number;
            }>(sql, params);

            return result.rows.map(row => ({
                id: row.id,
                sourceType: row.source_type,
                sourceId: row.source_id,
                chunkIndex: row.chunk_index,
                content: row.content,
                metadata: row.metadata ?? {},
                similarity: Number(row.similarity),
                createdAt: row.created_at,
            }));
        } catch (error) {
            logger.error('벡터 유사도 검색 실패:', error);
            return [];
        }
    }

    /**
     * FTS(BM25) 렉시컬 검색을 수행합니다.
     *
     * content_tsv (tsvector) 컬럼에 대해 plainto_tsquery를 사용합니다.
     * Migration 003에서 추가된 GIN 인덱스를 활용합니다.
     *
     * @param queryText - 검색 쿼리 텍스트
     * @param options - 검색 옵션
     * @returns ts_rank 점수 순으로 정렬된 검색 결과
     */
    async searchLexical(queryText: string, options?: VectorSearchOptions): Promise<VectorSearchResult[]> {
        const topK = options?.topK ?? 10;

        // 동적 WHERE 절 구성
        const conditions: string[] = ['content_tsv @@ plainto_tsquery(\'simple\', $1)'];
        const params: QueryParam[] = [queryText];
        let paramIndex = 2;

        if (options?.sourceType) {
            conditions.push(`source_type = $${paramIndex++}`);
            params.push(options.sourceType);
        }
        if (options?.sourceId) {
            conditions.push(`source_id = $${paramIndex++}`);
            params.push(options.sourceId);
        }
        if (options?.userId) {
            conditions.push(`(metadata->>'userId' = $${paramIndex} OR metadata->>'userId' IS NULL)`);
            params.push(options.userId);
            paramIndex++;
        }

        params.push(topK);
        const limitParamIdx = paramIndex;

        const whereClause = conditions.join(' AND ');

        const sql = `
            SELECT
                id,
                source_type,
                source_id,
                chunk_index,
                content,
                metadata,
                created_at,
                ts_rank(content_tsv, plainto_tsquery('simple', $1)) as similarity
            FROM vector_embeddings
            WHERE ${whereClause}
            ORDER BY similarity DESC
            LIMIT $${limitParamIdx}
        `;

        try {
            const result = await this.query<{
                id: number;
                source_type: string;
                source_id: string;
                chunk_index: number;
                content: string;
                metadata: Record<string, unknown>;
                created_at: string;
                similarity: number;
            }>(sql, params);

            return result.rows.map(row => ({
                id: row.id,
                sourceType: row.source_type,
                sourceId: row.source_id,
                chunkIndex: row.chunk_index,
                content: row.content,
                metadata: row.metadata ?? {},
                similarity: Number(row.similarity),
                createdAt: row.created_at,
            }));
        } catch (error) {
            logger.error('FTS 렉시컬 검색 실패:', error);
            return [];
        }
    }

    /**
     * 특정 소스의 임베딩을 모두 삭제합니다.
     *
     * @param sourceType - 소스 유형
     * @param sourceId - 소스 식별자
     * @returns 삭제된 레코드 수
     */
    async deleteBySource(sourceType: string, sourceId: string): Promise<number> {
        try {
            const result = await this.query(
                `DELETE FROM vector_embeddings WHERE source_type = $1 AND source_id = $2`,
                [sourceType, sourceId]
            );
            const deletedCount = result.rowCount ?? 0;
            logger.info(`임베딩 삭제: ${sourceType}/${sourceId} → ${deletedCount}개`);
            return deletedCount;
        } catch (error) {
            logger.error(`임베딩 삭제 실패 (${sourceType}/${sourceId}):`, error);
            return 0;
        }
    }

    /**
     * 특정 소스 유형의 임베딩을 전체 삭제합니다.
     *
     * @param sourceType - 소스 유형 (예: 'document')
     * @returns 삭제된 레코드 수
     */
    async deleteBySourceType(sourceType: string): Promise<number> {
        try {
            const result = await this.query(
                `DELETE FROM vector_embeddings WHERE source_type = $1`,
                [sourceType]
            );
            const deletedCount = result.rowCount ?? 0;
            logger.info(`임베딩 소스 유형 전체 삭제: ${sourceType} → ${deletedCount}개`);
            return deletedCount;
        } catch (error) {
            logger.error(`임베딩 소스 유형 전체 삭제 실패 (${sourceType}):`, error);
            return 0;
        }
    }

    /**
     * 특정 소스에 임베딩이 존재하는지 확인합니다.
     */
    async hasEmbeddings(sourceType: string, sourceId: string): Promise<boolean> {
        try {
            const result = await this.query<{ exists: boolean }>(
                `SELECT EXISTS(
                    SELECT 1 FROM vector_embeddings
                    WHERE source_type = $1 AND source_id = $2
                ) as exists`,
                [sourceType, sourceId]
            );
            return result.rows[0]?.exists ?? false;
        } catch (error) {
            logger.error(`임베딩 존재 확인 실패 (${sourceType}/${sourceId}):`, error);
            return false;
        }
    }

    /**
     * 특정 소스의 임베딩 개수를 반환합니다.
     */
    async countBySource(sourceType: string, sourceId: string): Promise<number> {
        try {
            const result = await this.query<{ count: string }>(
                `SELECT COUNT(*) as count FROM vector_embeddings
                 WHERE source_type = $1 AND source_id = $2`,
                [sourceType, sourceId]
            );
            return parseInt(result.rows[0]?.count ?? '0', 10);
        } catch (error) {
            logger.error(`임베딩 카운트 실패 (${sourceType}/${sourceId}):`, error);
            return 0;
        }
    }

    /**
     * 전체 임베딩 통계를 반환합니다.
     */
    async getStats(): Promise<{
        totalEmbeddings: number;
        uniqueSources: number;
        sourceTypes: Record<string, number>;
    }> {
        try {
            const totalResult = await this.query<{ count: string }>(
                `SELECT COUNT(*) as count FROM vector_embeddings`
            );
            const sourceResult = await this.query<{ count: string }>(
                `SELECT COUNT(DISTINCT source_type || '/' || source_id) as count FROM vector_embeddings`
            );
            const typeResult = await this.query<{ source_type: string; count: string }>(
                `SELECT source_type, COUNT(*) as count FROM vector_embeddings GROUP BY source_type`
            );

            const sourceTypes: Record<string, number> = {};
            for (const row of typeResult.rows) {
                sourceTypes[row.source_type] = parseInt(row.count, 10);
            }

            return {
                totalEmbeddings: parseInt(totalResult.rows[0]?.count ?? '0', 10),
                uniqueSources: parseInt(sourceResult.rows[0]?.count ?? '0', 10),
                sourceTypes,
            };
        } catch (error) {
            logger.error('임베딩 통계 조회 실패:', error);
            return { totalEmbeddings: 0, uniqueSources: 0, sourceTypes: {} };
        }
    }
}
