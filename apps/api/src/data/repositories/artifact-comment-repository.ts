/**
 * @module data/repositories/artifact-comment-repository
 * @description `artifact_comments`(147) — 논리적 아티팩트(session_id+artifact_id)에 귀속하는 댓글.
 * 작성 시점 버전을 기록하고, 삭제는 soft delete(답글 스레드·감사 보존). 접근권 판정은 라우트.
 */
import { BaseRepository } from './base-repository';

export interface ArtifactCommentRow {
    id: string;
    session_id: string;
    artifact_id: string;
    version: number;
    user_id: string;
    parent_id: string | null;
    /** 삭제된 댓글은 null(답글 자리 표시용으로 행은 돌려준다) */
    body: string | null;
    resolved_at: string | null;
    resolved_by: string | null;
    deleted: boolean;
    created_at: string;
    updated_at: string;
}

const COLUMNS = `id::text AS id, session_id, artifact_id, version, user_id, parent_id::text AS parent_id,
    CASE WHEN deleted_at IS NULL THEN body END AS body, resolved_at, resolved_by, (deleted_at IS NOT NULL) AS deleted, created_at, updated_at`;

export class ArtifactCommentRepository extends BaseRepository {
    /** 목록 — 삭제된 댓글은 답글이 있을 때만 자리 표시로 남긴다. */
    async list(sessionId: string, artifactId: string, limit: number): Promise<ArtifactCommentRow[]> {
        const r = await this.query<ArtifactCommentRow>(
            `SELECT ${COLUMNS} FROM artifact_comments c
              WHERE session_id = $1 AND artifact_id = $2
                AND (deleted_at IS NULL OR EXISTS (SELECT 1 FROM artifact_comments r WHERE r.parent_id = c.id AND r.deleted_at IS NULL))
              ORDER BY created_at ASC LIMIT $3`,
            [sessionId, artifactId, limit],
        );
        return r.rows;
    }

    async get(id: string): Promise<ArtifactCommentRow | undefined> {
        const r = await this.query<ArtifactCommentRow>(`SELECT ${COLUMNS} FROM artifact_comments WHERE id = $1`, [id]);
        return r.rows[0];
    }

    async create(p: { sessionId: string; artifactId: string; version: number; userId: string; parentId?: string | null; body: string }): Promise<ArtifactCommentRow> {
        const r = await this.query<ArtifactCommentRow>(
            `INSERT INTO artifact_comments (session_id, artifact_id, version, user_id, parent_id, body)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
            [p.sessionId, p.artifactId, p.version, p.userId, p.parentId ?? null, p.body],
        );
        return r.rows[0];
    }

    async updateBody(id: string, body: string): Promise<ArtifactCommentRow | undefined> {
        const r = await this.query<ArtifactCommentRow>(
            `UPDATE artifact_comments SET body = $2, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING ${COLUMNS}`,
            [id, body],
        );
        return r.rows[0];
    }

    /** 해결 표시/해제 — 답글이 아니라 스레드(최상위) 단위로 쓴다(검증은 라우트). */
    async setResolved(id: string, resolved: boolean, actorId: string): Promise<ArtifactCommentRow | undefined> {
        const r = await this.query<ArtifactCommentRow>(
            `UPDATE artifact_comments SET resolved_at = CASE WHEN $2 THEN NOW() END, resolved_by = CASE WHEN $2 THEN $3 END, updated_at = NOW()
              WHERE id = $1 AND deleted_at IS NULL RETURNING ${COLUMNS}`,
            [id, resolved, actorId],
        );
        return r.rows[0];
    }

    async softDelete(id: string): Promise<boolean> {
        const r = await this.query('UPDATE artifact_comments SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL', [id]);
        return (r.rowCount ?? 0) > 0;
    }
}
