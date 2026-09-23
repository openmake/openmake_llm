/**
 * 생성 산출물 소유 레코드 저장소 (마이그레이션 168, P04 2026-09-23).
 * 파일 자체는 `tools/generated-media`(비공개 디렉토리), 판정은 `runtime-ports/artifact-store`.
 *
 * @module data/repositories/generated-artifacts-repo
 */
import { BaseRepository } from './base-repository';

export type ArtifactStorage = 'private' | 'legacy_public';

export interface GeneratedArtifactRow {
    id: number;
    fileName: string;
    ownerUserId: string | null;
    sessionId: string | null;
    mime: string;
    sizeBytes: number;
    sha256: string | null;
    storage: ArtifactStorage;
    capability: string | null;
    createdAt: Date;
    deletedAt: Date | null;
}

interface RawRow {
    id: string; file_name: string; owner_user_id: string | null; session_id: string | null; mime: string; size_bytes: string;
    sha256: string | null; storage: ArtifactStorage; capability: string | null; created_at: Date; deleted_at: Date | null;
}

function map(r: RawRow): GeneratedArtifactRow {
    return {
        id: Number(r.id), fileName: r.file_name, ownerUserId: r.owner_user_id, sessionId: r.session_id, mime: r.mime,
        sizeBytes: Number(r.size_bytes), sha256: r.sha256, storage: r.storage, capability: r.capability, createdAt: r.created_at, deletedAt: r.deleted_at,
    };
}

export class GeneratedArtifactsRepository extends BaseRepository {
    async insert(input: { fileName: string; ownerUserId: string | null; sessionId: string | null; mime: string; sizeBytes: number; sha256: string; storage: ArtifactStorage; capability: string | null }): Promise<GeneratedArtifactRow> {
        const r = await this.query<RawRow>(
            `INSERT INTO generated_artifacts (file_name, owner_user_id, session_id, mime, size_bytes, sha256, storage, capability)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [input.fileName, input.ownerUserId, input.sessionId, input.mime, input.sizeBytes, input.sha256, input.storage, input.capability],
        );
        return map(r.rows[0]);
    }

    async getByFileName(fileName: string): Promise<GeneratedArtifactRow | null> {
        const r = await this.query<RawRow>('SELECT * FROM generated_artifacts WHERE file_name = $1', [fileName]);
        return r.rows[0] ? map(r.rows[0]) : null;
    }

    /** 보존 스윕이 지운 파일 — 행은 남기고 삭제 시각만 적는다(삭제된 파일은 반환하지 않는다) */
    async markDeleted(fileNames: string[]): Promise<number> {
        if (fileNames.length === 0) return 0;
        const r = await this.query('UPDATE generated_artifacts SET deleted_at = NOW() WHERE file_name = ANY($1) AND deleted_at IS NULL', [fileNames]);
        return r.rowCount ?? 0;
    }
}
