/**
 * @module data/repositories/artifact-publication-repository
 * @description Artifact Publication CRUD — Claude Code Artifacts 동등 공유 모델.
 *
 * 도입 (2026-06-23): 채팅 내 artifact 를 독립 뷰어 URL 로 publish + 공유.
 * 논리적 artifact(session_id + artifact_id) 당 publication 1건 (upsert).
 *
 * visibility:
 *   - private       : 소유자 본인만
 *   - authenticated : 인증된 모든 사용자
 *   - link          : share_token 보유자 (비인증 허용)
 *
 * @see db/migrations/047_artifact_publications.sql
 */
import { randomBytes } from 'crypto';
import { BaseRepository } from './base-repository';

export type ArtifactVisibility = 'private' | 'authenticated' | 'link';

export interface ArtifactPublicationRow {
    publication_id: string;
    session_id: string;
    artifact_id: string;
    owner_user_id: string;
    visibility: ArtifactVisibility;
    share_token: string | null;
    shared_version: number | null;
    icon: string | null;
    title: string | null;
    created_at: string;
    updated_at: string;
}

export interface UpsertPublicationInput {
    sessionId: string;
    artifactId: string;
    ownerUserId: string;
    visibility: ArtifactVisibility;
    sharedVersion?: number | null;
    icon?: string | null;
    title?: string | null;
}

/** link 공유용 불추측 토큰 (URL-safe, 32바이트 → 43자 base64url). */
function generateShareToken(): string {
    return randomBytes(32).toString('base64url');
}

/** UUID 형식 검증 — 비-UUID pubId 가 UUID 컬럼 쿼리에 들어가 DB 에러(500) 나는 것 방지. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(s: string): boolean {
    return UUID_RE.test(s);
}

export class ArtifactPublicationRepository extends BaseRepository {
    /**
     * publication upsert — 논리적 artifact 당 1건. 같은 (session_id, artifact_id) 가 있으면 UPDATE.
     * visibility='link' 이고 기존 토큰이 없으면 새 share_token 생성(멱등 재사용).
     */
    async upsert(input: UpsertPublicationInput): Promise<ArtifactPublicationRow> {
        const existing = await this.getByArtifact(input.sessionId, input.artifactId);
        // link 면 토큰 유지/생성, 그 외 visibility 면 토큰 보존(나중에 다시 link 전환 시 재사용).
        let shareToken = existing?.share_token ?? null;
        if (input.visibility === 'link' && !shareToken) {
            shareToken = generateShareToken();
        }

        const r = await this.query<ArtifactPublicationRow>(
            `INSERT INTO artifact_publications
                (session_id, artifact_id, owner_user_id, visibility, share_token, shared_version, icon, title)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (session_id, artifact_id) DO UPDATE SET
                visibility    = EXCLUDED.visibility,
                share_token   = EXCLUDED.share_token,
                shared_version = EXCLUDED.shared_version,
                icon          = COALESCE(EXCLUDED.icon, artifact_publications.icon),
                title         = COALESCE(EXCLUDED.title, artifact_publications.title),
                updated_at    = CURRENT_TIMESTAMP
             RETURNING *`,
            [
                input.sessionId,
                input.artifactId,
                input.ownerUserId,
                input.visibility,
                shareToken,
                input.sharedVersion ?? null,
                input.icon ?? null,
                input.title ?? null,
            ]
        );
        return r.rows[0];
    }

    async getByPublicationId(pubId: string): Promise<ArtifactPublicationRow | null> {
        if (!isUuid(pubId)) return null; // 비-UUID → DB 에러(500) 대신 not-found
        const r = await this.query<ArtifactPublicationRow>(
            'SELECT * FROM artifact_publications WHERE publication_id = $1',
            [pubId]
        );
        return r.rows[0] ?? null;
    }

    async getByShareToken(token: string): Promise<ArtifactPublicationRow | null> {
        const r = await this.query<ArtifactPublicationRow>(
            'SELECT * FROM artifact_publications WHERE share_token = $1',
            [token]
        );
        return r.rows[0] ?? null;
    }

    async getByArtifact(sessionId: string, artifactId: string): Promise<ArtifactPublicationRow | null> {
        const r = await this.query<ArtifactPublicationRow>(
            'SELECT * FROM artifact_publications WHERE session_id = $1 AND artifact_id = $2',
            [sessionId, artifactId]
        );
        return r.rows[0] ?? null;
    }

    /** gallery — 소유자의 모든 publication (최근 수정순). */
    async listByOwner(ownerUserId: string): Promise<ArtifactPublicationRow[]> {
        const r = await this.query<ArtifactPublicationRow>(
            'SELECT * FROM artifact_publications WHERE owner_user_id = $1 ORDER BY updated_at DESC',
            [ownerUserId]
        );
        return r.rows;
    }

    async deleteByArtifact(sessionId: string, artifactId: string): Promise<number> {
        const r = await this.query(
            'DELETE FROM artifact_publications WHERE session_id = $1 AND artifact_id = $2',
            [sessionId, artifactId]
        );
        return r.rowCount ?? 0;
    }
}
