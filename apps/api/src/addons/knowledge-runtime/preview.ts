/**
 * 인용 미리보기 — 채팅 `[N]` 출처가 가리키는 청크의 원문 조각을 돌려준다.
 * 읽기 가능한 Space·미삭제 문서·ready 버전만(인가는 accessPredicate 를 SQL 로).
 *
 * @module addons/knowledge-runtime/preview
 */
import { AppError } from '../../utils/error-handler';
import { kdb } from './db';
import { actorFor, accessPredicate } from './config/scope-policy';

export interface ChunkPreview {
    documentId: string;
    documentName: string;
    pageStart: number | null;
    pageEnd: number | null;
    content: string;
}

export async function getChunkPreview(userId: string, spaceId: string, chunkId: string): Promise<ChunkPreview> {
    const actor = await actorFor(userId);
    const pred = accessPredicate(actor, 'read', 's', 3);
    const r = await kdb().query<{
        document_id: string; logical_name: string; page_start: number | null; page_end: number | null; content: string;
    }>(
        `SELECT d.id AS document_id, d.logical_name, c.page_start, c.page_end, c.content
         FROM knowledge_chunks c
         JOIN knowledge_document_versions v ON v.id = c.document_version_id
         JOIN knowledge_documents d ON d.id = v.document_id
         JOIN knowledge_spaces s ON s.id = d.space_id
         WHERE c.id = $1 AND d.space_id = $2
           AND d.deleted_at IS NULL AND d.status <> 'deleted'
           AND v.status = 'ready' AND d.current_version_id = v.id
           AND ${pred.sql}`,
        [chunkId, spaceId, ...pred.params],
    );
    const row = r.rows[0];
    if (!row) throw new AppError('청크', 404, true, 'NOT_FOUND');
    return {
        documentId: row.document_id,
        documentName: row.logical_name,
        pageStart: row.page_start,
        pageEnd: row.page_end,
        content: row.content,
    };
}
