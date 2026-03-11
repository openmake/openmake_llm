/**
 * ============================================================
 * KBRepository - Knowledge Base (지식 컬렉션) 리포지토리
 * ============================================================
 *
 * knowledge_collections 및 knowledge_collection_documents 테이블에 대한
 * CRUD와 N:M 관계 관리를 제공합니다.
 *
 * @module data/repositories/kb-repository
 * @extends BaseRepository
 */

import { Pool } from 'pg';
import { BaseRepository, QueryParam } from './base-repository';
import { createLogger } from '../../utils/logger';

const logger = createLogger('KBRepository');

/**
 * 지식 컬렉션 데이터 구조
 */
export interface KnowledgeCollection {
    id: string;
    ownerUserId: string;
    name: string;
    description: string | null;
    visibility: 'private' | 'team' | 'public';
    createdAt: string;
    updatedAt: string;
}

/**
 * 컬렉션 생성 입력
 */
export interface CreateCollectionInput {
    name: string;
    description?: string;
    visibility?: 'private' | 'team' | 'public';
}

/**
 * 컬렉션 업데이트 입력
 */
export interface UpdateCollectionInput {
    name?: string;
    description?: string;
    visibility?: 'private' | 'team' | 'public';
}

/**
 * Knowledge Base 리포지토리
 */
export class KBRepository extends BaseRepository {
    constructor(pool: Pool) {
        super(pool);
    }

    /**
     * 새 컬렉션을 생성합니다.
     */
    async createCollection(
        ownerUserId: string,
        input: CreateCollectionInput,
    ): Promise<KnowledgeCollection> {
        const result = await this.query<{
            id: string;
            owner_user_id: string;
            name: string;
            description: string | null;
            visibility: string;
            created_at: string;
            updated_at: string;
        }>(
            `INSERT INTO knowledge_collections (owner_user_id, name, description, visibility)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [ownerUserId, input.name, input.description ?? null, input.visibility ?? 'private']
        );

        const row = result.rows[0];
        logger.info(`[KB] 컬렉션 생성: ${row.name} (id=${row.id})`);
        return this.mapCollection(row);
    }

    /**
     * 컬렉션을 ID로 조회합니다.
     */
    async getCollection(id: string): Promise<KnowledgeCollection | null> {
        const result = await this.query<{
            id: string;
            owner_user_id: string;
            name: string;
            description: string | null;
            visibility: string;
            created_at: string;
            updated_at: string;
        }>(
            `SELECT * FROM knowledge_collections WHERE id = $1`,
            [id]
        );

        if (result.rows.length === 0) return null;
        return this.mapCollection(result.rows[0]);
    }

    /**
     * 사용자의 모든 컬렉션을 조회합니다.
     */
    async listCollections(userId: string): Promise<KnowledgeCollection[]> {
        const result = await this.query<{
            id: string;
            owner_user_id: string;
            name: string;
            description: string | null;
            visibility: string;
            created_at: string;
            updated_at: string;
        }>(
            `SELECT * FROM knowledge_collections
             WHERE owner_user_id = $1 OR visibility = 'public'
             ORDER BY updated_at DESC`,
            [userId]
        );

        return result.rows.map(row => this.mapCollection(row));
    }

    /**
     * 컬렉션을 업데이트합니다.
     */
    async updateCollection(
        id: string,
        input: UpdateCollectionInput,
    ): Promise<KnowledgeCollection | null> {
        const setClauses: string[] = [];
        const params: QueryParam[] = [];
        let paramIndex = 1;

        if (input.name !== undefined) {
            setClauses.push(`name = $${paramIndex++}`);
            params.push(input.name);
        }
        if (input.description !== undefined) {
            setClauses.push(`description = $${paramIndex++}`);
            params.push(input.description);
        }
        if (input.visibility !== undefined) {
            setClauses.push(`visibility = $${paramIndex++}`);
            params.push(input.visibility);
        }

        if (setClauses.length === 0) {
            return this.getCollection(id);
        }

        setClauses.push(`updated_at = NOW()`);
        params.push(id);

        const result = await this.query<{
            id: string;
            owner_user_id: string;
            name: string;
            description: string | null;
            visibility: string;
            created_at: string;
            updated_at: string;
        }>(
            `UPDATE knowledge_collections SET ${setClauses.join(', ')}
             WHERE id = $${paramIndex}
             RETURNING *`,
            params
        );

        if (result.rows.length === 0) return null;
        return this.mapCollection(result.rows[0]);
    }

    /**
     * 컬렉션을 삭제합니다.
     * 매핑만 CASCADE 삭제되고, 문서/임베딩은 보존됩니다.
     */
    async deleteCollection(id: string): Promise<boolean> {
        const result = await this.query(
            `DELETE FROM knowledge_collections WHERE id = $1`,
            [id]
        );
        const deleted = (result.rowCount ?? 0) > 0;
        if (deleted) {
            logger.info(`[KB] 컬렉션 삭제: id=${id}`);
        }
        return deleted;
    }

    // ────────────────────────────────────────
    // N:M 문서 연결 관리
    // ────────────────────────────────────────

    /**
     * 컬렉션에 문서를 추가합니다.
     */
    async addDocument(collectionId: string, documentId: string): Promise<void> {
        await this.query(
            `INSERT INTO knowledge_collection_documents (collection_id, document_id)
             VALUES ($1, $2)
             ON CONFLICT (collection_id, document_id) DO NOTHING`,
            [collectionId, documentId]
        );
        logger.info(`[KB] 문서 추가: collection=${collectionId}, doc=${documentId}`);
    }

    /**
     * 컬렉션에서 문서를 제거합니다.
     */
    async removeDocument(collectionId: string, documentId: string): Promise<boolean> {
        const result = await this.query(
            `DELETE FROM knowledge_collection_documents
             WHERE collection_id = $1 AND document_id = $2`,
            [collectionId, documentId]
        );
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * 컬렉션에 속한 문서 ID 목록을 조회합니다.
     */
    async listDocuments(collectionId: string): Promise<string[]> {
        const result = await this.query<{ document_id: string }>(
            `SELECT document_id FROM knowledge_collection_documents
             WHERE collection_id = $1
             ORDER BY added_at DESC`,
            [collectionId]
        );
        return result.rows.map(r => r.document_id);
    }

    /**
     * 문서가 속한 컬렉션 ID 목록을 조회합니다.
     */
    async getCollectionsForDocument(documentId: string): Promise<string[]> {
        const result = await this.query<{ collection_id: string }>(
            `SELECT collection_id FROM knowledge_collection_documents
             WHERE document_id = $1`,
            [documentId]
        );
        return result.rows.map(r => r.collection_id);
    }

    /**
     * DB 행 → KnowledgeCollection 매핑
     */
    private mapCollection(row: {
        id: string;
        owner_user_id: string;
        name: string;
        description: string | null;
        visibility: string;
        created_at: string;
        updated_at: string;
    }): KnowledgeCollection {
        return {
            id: row.id,
            ownerUserId: row.owner_user_id,
            name: row.name,
            description: row.description,
            visibility: row.visibility as 'private' | 'team' | 'public',
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}
