/**
 * @module data/repositories/artifact-repository
 * @description Artifact CRUD — claude.ai-style 산출물 패널의 영속화 layer.
 *
 * 도입 (2026-05-26): LLM 응답 중 self-contained 산출물을 채팅 본문에서 분리해
 * 우측 패널에 표시. 메시지 본문에는 [[artifact:id:vN]] placeholder 만 저장.
 *
 * 핵심 동작:
 *   - insertArtifact: 같은 session + id 가 있으면 version 자동 증가 (1, 2, 3...)
 *   - listLatestBySession: id 별 최신 버전만 그룹 (패널 초기 로드)
 *   - listVersionsByArtifactId: 특정 id 의 전체 버전 (←/→ 화살표 history 탐색)
 *
 * @see db/migrations/035_artifacts.sql
 */
import { BaseRepository, type QueryParam } from './base-repository';

export type ArtifactKind =
    | 'markdown'
    | 'code'
    | 'html'
    | 'svg'
    | 'mermaid'
    // Phase 2 종류 — Phase 1 단계에서는 미지원이지만 schema 는 미리 허용
    | 'react'
    | 'chart'
    | 'csv'
    | 'slide'
    | 'excalidraw';

export const ARTIFACT_MAX_BYTES = 20 * 1024 * 1024; // 20MB — Anthropic 공식 한도와 동일
// Phase 3 보완 F.2 (2026-05-26): 사용자당 row 누적 한도. 초과 시 가장 오래된 row 자동 archive.
// 무한 grow 방지 — 운영 모니터링 항목. env 로 override 가능.
export const ARTIFACT_MAX_PER_USER = parseInt(process.env.ARTIFACT_MAX_PER_USER || '500', 10);

export interface ArtifactRow {
    pk_id: number;
    artifact_id: string;
    version: number;
    session_id: string;
    message_id: string | null;
    user_id: string | null;
    kind: ArtifactKind;
    title: string;
    language: string | null;
    content: string;
    deps: Record<string, unknown> | null;
    created_at: string;
}

export interface InsertArtifactInput {
    artifactId: string;
    sessionId: string;
    messageId?: string | null;
    userId?: string | null;
    kind: ArtifactKind;
    title: string;
    language?: string | null;
    content: string;
    deps?: Record<string, unknown> | null;
}

export class ArtifactSizeError extends Error {
    constructor(bytes: number) {
        super(`Artifact content exceeds 20MB limit (${bytes} bytes)`);
        this.name = 'ArtifactSizeError';
    }
}

export class ArtifactRepository extends BaseRepository {
    /**
     * Artifact 삽입. 같은 (sessionId, artifactId) 가 이미 있으면 자동으로 version+1.
     *
     * 20MB 초과 시 ArtifactSizeError throw — 호출자가 사용자 toast 로 안내.
     */
    async insertArtifact(input: InsertArtifactInput): Promise<ArtifactRow> {
        const contentBytes = Buffer.byteLength(input.content, 'utf-8');
        if (contentBytes > ARTIFACT_MAX_BYTES) {
            throw new ArtifactSizeError(contentBytes);
        }

        // Phase 3 보완 F.2 (2026-05-26): 사용자당 누적 한도 초과 시 가장 오래된 row pk_id 자동 삭제.
        // 운영 측면 — 무한 grow 방지. userId null (anon/system) 은 skip.
        if (input.userId) {
            const cnt = await this.query<{ total: string }>(
                'SELECT COUNT(*)::text AS total FROM artifacts WHERE user_id = $1',
                [input.userId]
            );
            const total = parseInt(cnt.rows[0]?.total ?? '0', 10);
            if (total >= ARTIFACT_MAX_PER_USER) {
                // 가장 오래된 N 개 삭제 (한 번에 정리)
                const excess = total - ARTIFACT_MAX_PER_USER + 1;
                await this.query(
                    `DELETE FROM artifacts WHERE pk_id IN (
                        SELECT pk_id FROM artifacts WHERE user_id = $1
                        ORDER BY created_at ASC LIMIT $2
                    )`,
                    [input.userId, excess]
                );
            }
        }

        // 같은 session + artifact_id 의 최신 version 조회
        const existing = await this.query<{ max_version: number | null }>(
            `SELECT MAX(version) AS max_version FROM artifacts
              WHERE session_id = $1 AND artifact_id = $2`,
            [input.sessionId, input.artifactId]
        );
        const nextVersion = (existing.rows[0]?.max_version ?? 0) + 1;

        const params: QueryParam[] = [
            input.artifactId,
            nextVersion,
            input.sessionId,
            input.messageId ?? null,
            input.userId ?? null,
            input.kind,
            input.title,
            input.language ?? null,
            input.content,
            input.deps ? JSON.stringify(input.deps) : null,
        ];
        const r = await this.query<ArtifactRow>(
            `INSERT INTO artifacts
                (artifact_id, version, session_id, message_id, user_id,
                 kind, title, language, content, deps)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING pk_id, artifact_id, version, session_id, message_id, user_id,
                       kind, title, language, content, deps, created_at`,
            params
        );
        return r.rows[0];
    }

    /**
     * 세션의 모든 artifact — id 별 최신 버전만 반환 (패널 초기 로드).
     * 본문은 메타데이터 응답이라 content 도 포함 (개별 fetch 줄임).
     */
    async listLatestBySession(sessionId: string): Promise<ArtifactRow[]> {
        const r = await this.query<ArtifactRow>(
            `SELECT DISTINCT ON (artifact_id)
                pk_id, artifact_id, version, session_id, message_id, user_id,
                kind, title, language, content, deps, created_at
             FROM artifacts
             WHERE session_id = $1
             ORDER BY artifact_id, version DESC`,
            [sessionId]
        );
        return r.rows;
    }

    /**
     * 특정 artifact 의 모든 버전 — 좌우 화살표 history 탐색용.
     */
    async listVersionsByArtifactId(sessionId: string, artifactId: string): Promise<ArtifactRow[]> {
        const r = await this.query<ArtifactRow>(
            `SELECT pk_id, artifact_id, version, session_id, message_id, user_id,
                    kind, title, language, content, deps, created_at
             FROM artifacts
             WHERE session_id = $1 AND artifact_id = $2
             ORDER BY version ASC`,
            [sessionId, artifactId]
        );
        return r.rows;
    }

    async getVersion(sessionId: string, artifactId: string, version: number): Promise<ArtifactRow | null> {
        const r = await this.query<ArtifactRow>(
            `SELECT pk_id, artifact_id, version, session_id, message_id, user_id,
                    kind, title, language, content, deps, created_at
             FROM artifacts
             WHERE session_id = $1 AND artifact_id = $2 AND version = $3`,
            [sessionId, artifactId, version]
        );
        return r.rows[0] ?? null;
    }

    async deleteByArtifactId(sessionId: string, artifactId: string): Promise<number> {
        const r = await this.query(
            `DELETE FROM artifacts WHERE session_id = $1 AND artifact_id = $2`,
            [sessionId, artifactId]
        );
        return r.rowCount ?? 0;
    }
}
