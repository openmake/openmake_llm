/**
 * ============================================================
 * VectorRepository - 청크 저장 및 FTS 검색 리포지토리
 * ============================================================
 *
 * vector_embeddings 테이블에 대한 CRUD 및 FTS(전문검색) 기능을 제공합니다.
 * 임베딩 없이 content 기반 텍스트 검색만 수행합니다.
 *
 * @module data/repositories/vector-repository
 * @extends BaseRepository
 */

import { Pool } from 'pg';
import { BaseRepository, QueryParam } from './base-repository';
import { createLogger } from '../../utils/logger';
import { withRetry } from '../retry-wrapper';

const logger = createLogger('VectorRepository');

/**
 * 청크 저장용 데이터 구조
 */
export interface ChunkInput {
    /** 소스 유형 (예: 'document', 'conversation') */
    sourceType: string;
    /** 소스 식별자 (예: docId, conversationId) */
    sourceId: string;
    /** 청크 순서 인덱스 */
    chunkIndex: number;
    /** 청크 텍스트 내용 */
    content: string;
    /** 추가 메타데이터 (JSON) */
    metadata?: Record<string, unknown>;
}

/**
 * 검색 결과
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
    /** 유사도/관련도 점수 */
    similarity: number;
    /** 생성 시각 */
    createdAt: string;
}

/**
 * 검색 옵션
 */
export interface VectorSearchOptions {
    /** 반환할 최대 결과 수 */
    topK?: number;
    /** 소스 유형 필터 */
    sourceType?: string;
    /** 소스 ID 필터 */
    sourceId?: string;
    /** 사용자 ID 필터 (metadata.userId) */
    userId?: string;
}

/**
 * 청크 저장 및 FTS 검색 리포지토리
 */
export class VectorRepository extends BaseRepository {
    constructor(pool: Pool) {
        super(pool);
    }

    /**
     * 청크를 저장합니다 (임베딩 없음, FTS용).
     *
     * @param chunks - 저장할 청크 배열
     * @returns 저장된 레코드 수
     */
    async storeChunks(chunks: ChunkInput[]): Promise<number> {
        if (chunks.length === 0) return 0;

        let storedCount = 0;
        const BATCH_SIZE = 200;
        const COLUMNS_PER_ROW = 5;

        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batch = chunks.slice(i, i + BATCH_SIZE);

            try {
                const valueClauses = batch.map((_, j) => {
                    const base = j * COLUMNS_PER_ROW;
                    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb)`;
                }).join(', ');

                const params: QueryParam[] = batch.flatMap(item => [
                    item.sourceType,
                    item.sourceId,
                    item.chunkIndex,
                    item.content,
                    JSON.stringify(item.metadata ?? {}),
                ]);

                // ⚙️ P2-7: 배치 INSERT 실패 시 개별 INSERT 폴백 제거 — 재시도만 수행
                const result = await withRetry(
                    () => this.query(
                        `INSERT INTO vector_embeddings (source_type, source_id, chunk_index, content, metadata)
                         VALUES ${valueClauses}`,
                        params
                    ),
                    { operation: `storeChunksBatch(offset=${i}, size=${batch.length})`, maxRetries: 2 }
                );
                storedCount += result.rowCount ?? batch.length;
            } catch (error) {
                logger.error(`청크 배치 저장 최종 실패 (offset=${i}):`, error);
                // 개별 폴백 삭제 (성능 저하 방지) — 다음 배치로 진행
            }
        }

        logger.info(`청크 저장 완료: ${storedCount}/${chunks.length}개`);
        return storedCount;
    }

    /**
     * FTS(BM25) 렉시컬 검색을 수행합니다.
     *
     * @param queryText - 검색 쿼리 텍스트
     * @param options - 검색 옵션
     * @returns ts_rank 점수 순으로 정렬된 검색 결과
     */
    async searchLexical(queryText: string, options?: VectorSearchOptions): Promise<VectorSearchResult[]> {
        const topK = options?.topK ?? 10;

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
     * 특정 소스의 청크를 모두 삭제합니다.
     */
    async deleteBySource(sourceType: string, sourceId: string): Promise<number> {
        try {
            const result = await this.query(
                `DELETE FROM vector_embeddings WHERE source_type = $1 AND source_id = $2`,
                [sourceType, sourceId]
            );
            const deletedCount = result.rowCount ?? 0;
            logger.info(`청크 삭제: ${sourceType}/${sourceId} → ${deletedCount}개`);
            return deletedCount;
        } catch (error) {
            logger.error(`청크 삭제 실패 (${sourceType}/${sourceId}):`, error);
            return 0;
        }
    }

    /**
     * 특정 소스 유형의 청크를 전체 삭제합니다.
     */
    async deleteBySourceType(sourceType: string): Promise<number> {
        try {
            const result = await this.query(
                `DELETE FROM vector_embeddings WHERE source_type = $1`,
                [sourceType]
            );
            const deletedCount = result.rowCount ?? 0;
            logger.info(`청크 소스 유형 전체 삭제: ${sourceType} → ${deletedCount}개`);
            return deletedCount;
        } catch (error) {
            logger.error(`청크 소스 유형 전체 삭제 실패 (${sourceType}):`, error);
            return 0;
        }
    }

    /**
     * 특정 소스에 청크가 존재하는지 확인합니다.
     */
    async hasChunks(sourceType: string, sourceId: string): Promise<boolean> {
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
            logger.error(`청크 존재 확인 실패 (${sourceType}/${sourceId}):`, error);
            return false;
        }
    }

    /**
     * 특정 소스의 청크 개수를 반환합니다.
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
            logger.error(`청크 카운트 실패 (${sourceType}/${sourceId}):`, error);
            return 0;
        }
    }

    /**
     * 전체 청크 통계를 반환합니다.
     */
    async getStats(): Promise<{
        totalChunks: number;
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
                totalChunks: parseInt(totalResult.rows[0]?.count ?? '0', 10),
                uniqueSources: parseInt(sourceResult.rows[0]?.count ?? '0', 10),
                sourceTypes,
            };
        } catch (error) {
            logger.error('청크 통계 조회 실패:', error);
            return { totalChunks: 0, uniqueSources: 0, sourceTypes: {} };
        }
    }
}
