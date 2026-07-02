/**
 * @module data/repositories/artifact-execution-repository
 * @description `artifact_executions` — 아티팩트 코드 실행 결과(히스토리) 데이터 접근 계층
 *
 * POST /api/artifacts/execute 의 stateless one-shot 실행 결과를 아티팩트 버전에 연결해
 * 영속한다. 갤러리 상세·패널 재방문 시 최근 실행 결과를 복원하는 데 쓴다.
 * artifact-repository.ts 와 동일한 느슨한 session_id(TEXT) 패턴 — FK 없이 앱/스윕 정리.
 *
 * @see db/migrations/055_artifact_executions.sql
 */
import { BaseRepository } from './base-repository';

export interface ArtifactExecutionRow {
    id: string;
    session_id: string;
    artifact_id: string;
    version: number;
    user_id: string | null;
    runtime: string;
    stdout: string;
    stderr: string;
    exit_code: number | null;
    duration_ms: number;
    timed_out: boolean;
    truncated: boolean;
    created_at: string;
}

export interface InsertExecutionInput {
    sessionId: string;
    artifactId: string;
    version: number;
    userId?: string | null;
    runtime: string;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    durationMs: number;
    timedOut: boolean;
    truncated: boolean;
}

export class ArtifactExecutionRepository extends BaseRepository {
    /** 실행 결과 1건 저장 후 생성 행 반환. */
    async insertExecution(input: InsertExecutionInput): Promise<ArtifactExecutionRow> {
        const r = await this.query<ArtifactExecutionRow>(
            `INSERT INTO artifact_executions
                (session_id, artifact_id, version, user_id, runtime, stdout, stderr, exit_code, duration_ms, timed_out, truncated)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING *`,
            [
                input.sessionId, input.artifactId, input.version, input.userId ?? null,
                input.runtime, input.stdout, input.stderr, input.exitCode,
                input.durationMs, input.timedOut, input.truncated,
            ],
        );
        return r.rows[0];
    }

    /** 특정 아티팩트의 최근 실행 이력 (최신순). */
    async listByArtifact(sessionId: string, artifactId: string, limit = 10): Promise<ArtifactExecutionRow[]> {
        const r = await this.query<ArtifactExecutionRow>(
            `SELECT * FROM artifact_executions
             WHERE session_id = $1 AND artifact_id = $2
             ORDER BY created_at DESC, id DESC
             LIMIT $3`,
            [sessionId, artifactId, limit],
        );
        return r.rows;
    }

    /**
     * 아티팩트별 최근 keep 건만 남기고 오래된 실행 삭제 (저장 시 호출 — 무한 누적 방지).
     * 삭제 건수 반환.
     */
    async pruneToRecent(sessionId: string, artifactId: string, keep: number): Promise<number> {
        const r = await this.query(
            `DELETE FROM artifact_executions
             WHERE session_id = $1 AND artifact_id = $2
               AND id NOT IN (
                   SELECT id FROM artifact_executions
                   WHERE session_id = $1 AND artifact_id = $2
                   ORDER BY created_at DESC, id DESC
                   LIMIT $3
               )`,
            [sessionId, artifactId, keep],
        );
        return r.rowCount ?? 0;
    }

    /** TTL 스윕 — cutoff(ms epoch)보다 오래된 실행 전역 삭제. 삭제 건수 반환. */
    async deleteOlderThan(cutoffMs: number): Promise<number> {
        const r = await this.query(
            `DELETE FROM artifact_executions WHERE created_at < to_timestamp($1 / 1000.0)`,
            [cutoffMs],
        );
        return r.rowCount ?? 0;
    }
}
