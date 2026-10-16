/**
 * 작업 취소 요청 — 소유자(user·org 작업의 접수자) 또는 관리자만(설계 §5 C4).
 *  - queued: 바로 cancelled 로 끝낸다(수집이면 문서 버전 CANCELLED).
 *  - running: cancel_requested_at 만 찍는다 — 실행자의 heartbeat 가 읽고 lease 신호를 끊어 다음 단계 경계에서 멈춘 뒤
 *    lease 를 쥔 채 cancelled 를 쓴다(jobs/worker.ts). 이미 시작한 DB 밖 호출(임베딩·파일 삭제)은 멈출 뿐 되돌리지 않는다.
 *  - done·failed·cancelled: 409.
 * 남의 작업·시스템 작업·004 이전 작업(actor 없음)은 관리자가 아니면 404(존재를 드러내지 않는다). 성공하면 감사 knowledge.job_cancelled.
 *
 * @module addons/knowledge-runtime/jobs/cancel
 */
import type { PoolClient } from 'pg';
import { AppError } from '../../../utils/error-handler';
import { createLogger } from '../../../utils/logger';
import { recordAddonAudit } from '../../../runtime-ports/audit-port';
import { inTransaction } from '../db';
import { FAILURE_CODES } from '../ingestion/errors';
import { KNOWLEDGE_JOB_CANCELLED_AUDIT_ACTION } from '../contributions';
import { markVersionTerminal } from './terminal';
import type { JobActorKind, KnowledgeJobState } from './job-schema';

const logger = createLogger('KnowledgeJobCancel');

export interface JobCancelRequest {
    jobId: string;
    userId: string;
    isAdmin: boolean;
}

export interface JobCancelOutcome {
    jobId: string;
    /** cancelled: 이미 끝냄(대기 중이었음) · cancelling: 실행 중 — 다음 단계 경계에서 멈춘다 */
    state: 'cancelled' | 'cancelling';
}

interface CancelTarget {
    state: KnowledgeJobState;
    kind: string;
    actor_kind: JobActorKind | null;
    actor_user_id: string | null;
    document_version_id: string | null;
}

type CancelAction = (client: Pick<PoolClient, 'query'>, jobId: string, job: CancelTarget) => Promise<JobCancelOutcome>;

/** 상태 → 취소 동작. 표에 없는 상태(done·failed·cancelled)는 이미 끝난 작업이라 409 */
const CANCEL_BY_STATE: Readonly<Partial<Record<KnowledgeJobState, CancelAction>>> = {
    queued: async (client, jobId, job) => {
        await client.query(
            `UPDATE knowledge_ingestion_jobs
                SET state = 'cancelled', cancel_requested_at = NOW(), lease_owner = NULL, lease_expires_at = NULL,
                    last_error = '취소됨 — 실행 전', updated_at = NOW()
              WHERE id = $1 AND state = 'queued'`,
            [jobId],
        );
        if (job.kind === 'ingest' && job.document_version_id) await markVersionTerminal(client, job.document_version_id, FAILURE_CODES.CANCELLED);
        return { jobId, state: 'cancelled' };
    },
    running: async (client, jobId) => {
        await client.query(
            `UPDATE knowledge_ingestion_jobs SET cancel_requested_at = COALESCE(cancel_requested_at, NOW()), updated_at = NOW()
              WHERE id = $1 AND state = 'running'`,
            [jobId],
        );
        return { jobId, state: 'cancelling' };
    },
};

/** 본인 작업(사용자·조직 Space 작업의 접수자)이거나 관리자 */
function mayCancel(job: CancelTarget, req: JobCancelRequest): boolean {
    if (req.isAdmin) return true;
    return (job.actor_kind === 'user' || job.actor_kind === 'org') && job.actor_user_id === req.userId;
}

export async function requestJobCancel(req: JobCancelRequest): Promise<JobCancelOutcome> {
    const outcome = await inTransaction(async (client) => {
        const r = await client.query<CancelTarget>(
            `SELECT state, kind, actor_kind, actor_user_id, document_version_id
               FROM knowledge_ingestion_jobs WHERE id = $1 FOR UPDATE`,
            [req.jobId],
        );
        const job = r.rows[0];
        if (!job || !mayCancel(job, req)) throw new AppError('작업', 404, true, 'NOT_FOUND');
        const action = CANCEL_BY_STATE[job.state];
        if (!action) throw new AppError('이미 끝난 작업은 취소할 수 없습니다', 409, true, 'JOB_NOT_CANCELLABLE');
        return action(client, req.jobId, job);
    });
    await recordAddonAudit({
        action: KNOWLEDGE_JOB_CANCELLED_AUDIT_ACTION,
        userId: req.userId,
        resourceType: 'knowledge_job',
        resourceId: req.jobId,
        details: { outcome: outcome.state, byAdmin: req.isAdmin },
    }).catch((err: unknown) => logger.warn(`취소 감사 기록 실패(취소는 반영됨): ${err instanceof Error ? err.message : String(err)}`));
    return outcome;
}
