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
}

export class OrchestratorJobsRepository extends BaseRepository {
    async upsertPending(userId: string, capability: string, providerId: string, jobId: string): Promise<void> {
        await this.query(
            `INSERT INTO orchestrator_jobs (user_id, capability, provider_id, job_id, status)
             VALUES ($1, $2, $3, $4, 'pending')
             ON CONFLICT (user_id, provider_id, job_id) DO UPDATE SET updated_at = NOW()`,
            [userId, capability, providerId, jobId],
        );
    }

    async markDone(userId: string, providerId: string, jobId: string, status: 'completed' | 'failed', resultPath: string | null): Promise<void> {
        await this.query(
            `UPDATE orchestrator_jobs SET status = $4, result_path = $5, updated_at = NOW()
             WHERE user_id = $1 AND provider_id = $2 AND job_id = $3`,
            [userId, providerId, jobId, status, resultPath],
        );
    }

    /** 최근 pending job (Planner 첨부 목록용) */
    async listPending(userId: string, withinHours: number, limit: number): Promise<OrchestratorJobRow[]> {
        const r = await this.query<{ user_id: string; capability: string; provider_id: string; job_id: string; status: 'pending' | 'completed' | 'failed'; result_path: string | null; created_at: Date }>(
            `SELECT * FROM orchestrator_jobs
             WHERE user_id = $1 AND status = 'pending' AND created_at > NOW() - ($2 || ' hours')::interval
             ORDER BY created_at DESC LIMIT $3`,
            [userId, String(withinHours), limit],
        );
        return r.rows.map((x) => ({ userId: x.user_id, capability: x.capability, providerId: x.provider_id, jobId: x.job_id, status: x.status, resultPath: x.result_path, createdAt: x.created_at }));
    }
}
