/**
 * cleanup 작업 — 논리 삭제(tombstone) 대상의 물리 정리: 원본 파일 + 행.
 *  - 삭제된 문서(deleted_at): 버전 원본 파일 삭제 후 문서 행 삭제(cascade 로 버전·청크·임베딩까지)
 *  - tombstoned Space: 소속 문서 원본·행 삭제 후 Space 를 purged 로(감사 흔적은 남긴다)
 * 삭제 커밋이 곧 검색 제외이므로 이 작업은 저장공간 회수만 한다(검색 정합성과 무관).
 *
 * @module addons/knowledge-runtime/jobs/cleanup
 */
import { createLogger } from '../../../utils/logger';
import { kdb } from '../db';
import { KNOWLEDGE_RUNTIME } from '../constants';

const logger = createLogger('KnowledgeCleanup');

export interface CleanupDeps {
    deleteStoredFile: (storageRef: string) => Promise<void>;
}

/** 대상 문서들의 원본 파일을 지우고 문서 행을 삭제한다(cascade) */
async function purgeDocuments(documentIds: string[], deps: CleanupDeps): Promise<void> {
    if (documentIds.length === 0) return;
    const refs = (await kdb().query<{ storage_ref: string }>(
        `SELECT storage_ref FROM knowledge_document_versions WHERE document_id = ANY($1::text[])`,
        [documentIds],
    )).rows;
    for (const r of refs) await deps.deleteStoredFile(r.storage_ref).catch(() => undefined);
    await kdb().query(`DELETE FROM knowledge_documents WHERE id = ANY($1::text[])`, [documentIds]);
}

/**
 * 정리 실행. spaceId 가 있으면 그 Space(및 그 안의 삭제 문서)만, 없으면 전역 스윕(배치 상한).
 */
export async function runCleanup(spaceId: string | null, deps: CleanupDeps): Promise<void> {
    const batch = KNOWLEDGE_RUNTIME.CLEANUP_BATCH;

    // ① 삭제된 문서 회수
    const delDocs = (await kdb().query<{ id: string }>(
        spaceId
            ? `SELECT id FROM knowledge_documents WHERE space_id = $1 AND deleted_at IS NOT NULL LIMIT $2`
            : `SELECT id FROM knowledge_documents WHERE deleted_at IS NOT NULL ORDER BY deleted_at LIMIT $1`,
        spaceId ? [spaceId, batch] : [batch],
    )).rows.map((r) => r.id);
    await purgeDocuments(delDocs, deps);

    // ② tombstoned Space 회수 → purged
    const spaces = (await kdb().query<{ id: string }>(
        spaceId
            ? `SELECT id FROM knowledge_spaces WHERE id = $1 AND status = 'tombstoned'`
            : `SELECT id FROM knowledge_spaces WHERE status = 'tombstoned' ORDER BY updated_at LIMIT $1`,
        spaceId ? [spaceId] : [batch],
    )).rows.map((r) => r.id);

    for (const sid of spaces) {
        const docs = (await kdb().query<{ id: string }>(
            `SELECT id FROM knowledge_documents WHERE space_id = $1`,
            [sid],
        )).rows.map((r) => r.id);
        await purgeDocuments(docs, deps);
        await kdb().query(`UPDATE knowledge_spaces SET status = 'purged', updated_at = NOW() WHERE id = $1`, [sid]);
        logger.info(`Space 정리 완료(purged): ${sid} docs=${docs.length}`);
    }
    if (delDocs.length > 0 || spaces.length > 0) {
        logger.info(`cleanup: 삭제문서 ${delDocs.length} · tombstone space ${spaces.length}`);
    }
}
