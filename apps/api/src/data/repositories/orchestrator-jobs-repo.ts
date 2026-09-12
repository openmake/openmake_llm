/**
 * @module data/repositories/orchestrator-jobs-repo
 * @description 비동기 capability 작업(영상 생성) 재조회용 저장소 — 미완료 job 을 사용자별로 보존한다.
 * @see db/migrations/119_orchestrator_planner.sql
 */
import { BaseRepository } from './base-repository';

export interface OrchestratorJobRow {
    userId: string;
    capability: string;
    providerId: string;
    jobId: string;
    status: 'pending' | 'completed' | 'failed';
    resultPath: string | null;
    createdAt: Date;
    /** job 을 만든 대화 id (121) — 대화 없는 호출은 null */
    sessionId: string | null;
}

export class OrchestratorJobsRepository extends BaseRepository {
    async upsertPending(userId: string, capability: string, providerId: string, jobId: string, sessionId?: string | null): Promise<void> {
        await this.query(
            `INSERT INTO orchestrator_jobs (user_id, capability, provider_id, job_id, status, session_id)
             VALUES ($1, $2, $3, $4, 'pending', $5)
             ON CONFLICT (user_id, provider_id, job_id) DO UPDATE SET updated_at = NOW(), session_id = COALESCE(orchestrator_jobs.session_id, EXCLUDED.session_id)`,
            [userId, capability, providerId, jobId, sessionId ?? null],
        );
    }

    async markDone(userId: string, providerId: string, jobId: string, status: 'completed' | 'failed', resultPath: string | null): Promise<void> {
        await this.query(
            `UPDATE orchestrator_jobs SET status = $4, result_path = $5, updated_at = NOW()
             WHERE user_id = $1 AND provider_id = $2 AND job_id = $3`,
            [userId, providerId, jobId, status, resultPath],
        );
    }

    /**
     * 최근 job (Planner 첨부 목록용) — pending 과 **이미 받아둔 completed(result_path 있음)** 둘 다.
     * completed 를 함께 주는 이유: "아까 영상 보여줘" 를 provider 재조회·재다운로드 없이 저장된 파일로 답하기 위해
     * (hasa 파일 서버가 3.7MB 를 3~10분에 주는 실측, 2026-09-12). failed 는 제외.
     */
    async listRecent(userId: string, withinHours: number, limit: number, sessionId?: string | null): Promise<OrchestratorJobRow[]> {
        // 같은 대화(session_id 일치, 둘 다 NULL 포함)의 job 을 먼저, 그다음 최신순 — 첨부 목록 상한(limit) 안에 같은 대화 job 이 먼저 들어간다
        const r = await this.query<{ user_id: string; capability: string; provider_id: string; job_id: string; status: 'pending' | 'completed' | 'failed'; result_path: string | null; created_at: Date; session_id: string | null }>(
            `SELECT * FROM orchestrator_jobs
             WHERE user_id = $1 AND created_at > NOW() - ($2 || ' hours')::interval
               AND (status = 'pending' OR (status = 'completed' AND result_path IS NOT NULL))
             ORDER BY (session_id IS NOT DISTINCT FROM $4) DESC, created_at DESC LIMIT $3`,
            [userId, String(withinHours), limit, sessionId ?? null],
        );
        return r.rows.map((x) => ({ userId: x.user_id, capability: x.capability, providerId: x.provider_id, jobId: x.job_id, status: x.status, resultPath: x.result_path, createdAt: x.created_at, sessionId: x.session_id }));
    }
}
