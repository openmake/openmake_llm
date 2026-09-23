/**
 * Knowledge 문서·버전 리포지토리 — raw SQL. 문서는 항상 인가된 Space 안에서만 다룬다(서비스가 Space 인가를 먼저 한다).
 *
 * @module addons/knowledge-runtime/documents/repository
 */
import type { PoolClient } from 'pg';
import type { KnowledgeVersionStatus } from '@openmake/shared-types';
import { kdb } from '../db';

export interface DocumentDetailRow {
    id: string;
    logical_name: string;
    mime_type: string;
    source_size: string;
    status: KnowledgeVersionStatus;
    failure_code: string | null;
    progress: number;
    page_count: number | null;
    created_at: string;
}

/** Space 의 문서 목록(현재 버전 조인). 삭제 문서 제외. 최신 생성 순. */
export async function listDocumentRowsForSpace(spaceId: string): Promise<DocumentDetailRow[]> {
    const r = await kdb().query<DocumentDetailRow>(
        `SELECT d.id, d.logical_name, v.mime_type, v.source_size, v.status, v.failure_code, v.progress, v.page_count, d.created_at
         FROM knowledge_documents d
         JOIN knowledge_document_versions v ON v.id = d.current_version_id
         WHERE d.space_id = $1 AND d.deleted_at IS NULL AND d.status <> 'deleted'
         ORDER BY d.created_at DESC`,
        [spaceId],
    );
    return r.rows;
}

/** 같은 Space 안에 같은 content_hash 의 살아있는 문서가 있으면 true(파일명이 아니라 내용으로 중복 판정). */
export async function hasLiveHash(spaceId: string, contentHash: string): Promise<boolean> {
    const r = await kdb().query(
        `SELECT 1 FROM knowledge_document_versions v
         JOIN knowledge_documents d ON d.id = v.document_id
         WHERE d.space_id = $1 AND d.deleted_at IS NULL AND d.status <> 'deleted' AND v.content_hash = $2
         LIMIT 1`,
        [spaceId, contentHash],
    );
    return (r.rowCount ?? 0) > 0;
}

/** Space 의 살아있는 문서 수 — maxDocumentsPerSpace 검사용 */
export async function countLiveDocuments(spaceId: string): Promise<number> {
    const r = await kdb().query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM knowledge_documents WHERE space_id = $1 AND deleted_at IS NULL AND status <> 'deleted'`,
        [spaceId],
    );
    return parseInt(r.rows[0]?.n ?? '0', 10);
}

export interface InsertDocumentInput {
    spaceId: string;
    createdBy: string;
    logicalName: string;
    contentHash: string;
    mimeType: string;
    originalFilename: string;
    storageRef: string;
    sourceSize: number;
    chunkerProfileId: string;
}

/**
 * 문서(processing) + 첫 버전(uploaded) 을 한 트랜잭션에 넣고 current_version_id 를 연결한다.
 * id 는 호출부가 미리 만들어 넘긴다 — versionId 가 곧 storage_ref 라 저장 경로와 버전 행을 일치시키기 위함.
 */
export async function insertDocumentWithVersion(
    client: PoolClient,
    documentId: string,
    versionId: string,
    input: InsertDocumentInput,
): Promise<void> {
    await client.query(
        `INSERT INTO knowledge_documents (id, space_id, logical_name, current_version_id, source_type, status, created_by)
         VALUES ($1, $2, $3, $4, 'upload', 'processing', $5)`,
        [documentId, input.spaceId, input.logicalName, versionId, input.createdBy],
    );
    await client.query(
        `INSERT INTO knowledge_document_versions
             (id, document_id, content_hash, mime_type, original_filename, storage_ref, source_size, chunker_profile_id, status, progress)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'uploaded', 0)`,
        [versionId, documentId, input.contentHash, input.mimeType, input.originalFilename, input.storageRef, input.sourceSize, input.chunkerProfileId],
    );
}

/** 소프트 삭제(트랜잭션) — deleted_at + status 'deleted'. 이미 삭제/부재면 false. */
export async function softDeleteDocument(client: PoolClient, spaceId: string, documentId: string): Promise<boolean> {
    const r = await client.query(
        `UPDATE knowledge_documents SET status = 'deleted', deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND space_id = $2 AND deleted_at IS NULL RETURNING id`,
        [documentId, spaceId],
    );
    return (r.rowCount ?? 0) > 0;
}

export interface RetryTargetRow { documentId: string; versionId: string; status: KnowledgeVersionStatus }

/** 재시도 대상 — Space 안의 살아있는 문서의 현재 버전. 없으면 null. */
export async function getRetryTarget(spaceId: string, documentId: string): Promise<RetryTargetRow | null> {
    const r = await kdb().query<{ document_id: string; version_id: string; status: KnowledgeVersionStatus }>(
        `SELECT d.id AS document_id, v.id AS version_id, v.status
         FROM knowledge_documents d
         JOIN knowledge_document_versions v ON v.id = d.current_version_id
         WHERE d.id = $1 AND d.space_id = $2 AND d.deleted_at IS NULL AND d.status <> 'deleted'`,
        [documentId, spaceId],
    );
    const row = r.rows[0];
    return row ? { documentId: row.document_id, versionId: row.version_id, status: row.status } : null;
}

/** 재시도 초기화(트랜잭션) — 버전 status 'uploaded'·failure_code null·progress 0, 문서 status 'processing'. */
export async function resetVersionForRetry(client: PoolClient, documentId: string, versionId: string): Promise<void> {
    await client.query(
        `UPDATE knowledge_document_versions SET status = 'uploaded', failure_code = NULL, progress = 0, updated_at = NOW() WHERE id = $1`,
        [versionId],
    );
    await client.query(
        `UPDATE knowledge_documents SET status = 'processing', updated_at = NOW() WHERE id = $1`,
        [documentId],
    );
}
