/**
 * @module data/repositories/canvas-repository
 * @description `canvas_documents` / `canvas_versions` 테이블 데이터 접근 계층
 *
 * 캔버스 문서(CanvasDocument)와 버전(CanvasVersion) 엔티티의 CRUD를 담당합니다.
 * - 문서 생성/조회/수정/삭제, 사용자별 문서 목록
 * - 버전 관리 (트랜잭션 기반 버전 생성)
 * - 공유 토큰 기반 문서 공유/해제
 */
import { withTransaction } from '../retry-wrapper';
import { BaseRepository, QueryParam } from './base-repository';
import type { CanvasDocType, CanvasDocument, CanvasVersion } from '../models/unified-database';

export class CanvasRepository extends BaseRepository {
    async createCanvasDocument(params: {
        id: string;
        userId: string;
        sessionId?: string;
        title: string;
        docType?: CanvasDocType;
        content?: string;
        language?: string;
    }): Promise<void> {
        await this.query(
            `INSERT INTO canvas_documents (id, user_id, session_id, title, doc_type, content, language)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                params.id,
                params.userId,
                params.sessionId,
                params.title,
                params.docType || 'document',
                params.content,
                params.language
            ]
        );
    }

    async getCanvasDocument(documentId: string): Promise<CanvasDocument | undefined> {
        const result = await this.query<CanvasDocument>('SELECT * FROM canvas_documents WHERE id = $1', [documentId]);
        const row = result.rows[0];
        if (!row) return undefined;

        return {
            ...row,
            is_shared: !!row.is_shared
        };
    }

    async updateCanvasDocument(documentId: string, updates: {
        title?: string;
        content?: string;
        changeSummary?: string;
        updatedBy?: string;
    }): Promise<void> {
        await withTransaction(this.pool, async (client) => {
            const currentResult = await client.query('SELECT * FROM canvas_documents WHERE id = $1', [documentId]);
            const currentRow = currentResult.rows[0] as (Partial<CanvasDocument> & { is_shared?: unknown }) | undefined;
            const current = currentRow ? {
                ...currentRow,
                is_shared: !!currentRow.is_shared
            } as CanvasDocument : undefined;

            if (current && updates.content !== undefined && updates.content !== current.content) {
                await client.query(
                    `INSERT INTO canvas_versions (document_id, version, content, change_summary, created_by)
                    VALUES ($1, $2, $3, $4, $5)`,
                    [
                        documentId,
                        current.version,
                        current.content || '',
                        updates.changeSummary || 'Auto-saved version',
                        updates.updatedBy
                    ]
                );
            }

            const sets: string[] = ['updated_at = NOW()'];
            const params: QueryParam[] = [];
            let paramIdx = 1;

            if (updates.title !== undefined) {
                sets.push(`title = $${paramIdx++}`);
                params.push(updates.title);
            }
            if (updates.content !== undefined) {
                sets.push(`content = $${paramIdx++}`);
                sets.push('version = version + 1');
                params.push(updates.content);
            }

            params.push(documentId);
            await client.query(`UPDATE canvas_documents SET ${sets.join(', ')} WHERE id = $${paramIdx}`, params);
        });
    }

    async getCanvasVersions(documentId: string): Promise<CanvasVersion[]> {
        const result = await this.query<CanvasVersion>(
            'SELECT * FROM canvas_versions WHERE document_id = $1 ORDER BY version DESC',
            [documentId]
        );
        return result.rows as CanvasVersion[];
    }

    async getUserCanvasDocuments(userId: string, limit: number = 50): Promise<CanvasDocument[]> {
        const result = await this.query<CanvasDocument>(
            'SELECT * FROM canvas_documents WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2',
            [userId, limit]
        );
        return result.rows.map((row) => ({
            ...row,
            is_shared: !!row.is_shared
        }));
    }

    async shareCanvasDocument(documentId: string, shareToken: string): Promise<void> {
        await this.query(
            'UPDATE canvas_documents SET is_shared = TRUE, share_token = $1, updated_at = NOW() WHERE id = $2',
            [shareToken, documentId]
        );
    }

    async getCanvasDocumentByShareToken(shareToken: string): Promise<CanvasDocument | undefined> {
        const result = await this.query<CanvasDocument>(
            'SELECT * FROM canvas_documents WHERE share_token = $1 AND is_shared = TRUE',
            [shareToken]
        );
        const row = result.rows[0];
        if (!row) return undefined;

        return {
            ...row,
            is_shared: !!row.is_shared
        };
    }

    async deleteCanvasDocument(documentId: string): Promise<void> {
        await this.query('DELETE FROM canvas_documents WHERE id = $1', [documentId]);
    }
}
