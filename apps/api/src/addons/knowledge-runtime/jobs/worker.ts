/**
 * 수집 작업 worker — `knowledge_ingestion_jobs` 를 lease + fencing token(SKIP LOCKED)으로 집어 처리한다.
 * kind 별 핸들러는 `Record` 맵으로 분기한다(switch 금지). 실패는 백오프 재시도, 상한 초과는 failed.
 * 모든 확정 쓰기는 이 tick 이 받은 fencing token 조건부라 lease 가 만료된 옛 실행자의 완료는 거절된다.
 *
 * @module addons/knowledge-runtime/jobs/worker
 */
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../../../utils/logger';
import { kdb } from '../db';
import { KNOWLEDGE_RUNTIME } from '../constants';
import { getDefaultLimits } from '../config/profiles';
import { ingestVersion, type IngestDeps } from '../ingestion/pipeline';
import { runReindexJob } from '../embedding/index-manager';
import { FAILURE_CODES, type FailureCode } from '../ingestion/errors';
import { deleteStoredFile } from '../documents/storage';
import { rechunkSpace } from './rechunk';
import { runCleanup } from './cleanup';

const logger = createLogger('KnowledgeWorker');

/** 재시도해 볼 수 있는 수집 실패(인프라성) — 검증·형식 실패는 영구라 재시도하지 않는다 */
const RETRYABLE_FAILURES: ReadonlySet<FailureCode> = new Set([FAILURE_CODES.EMBEDDING, FAILURE_CODES.VERIFICATION]);

export interface JobRow {
    id: string;
    kind: 'ingest' | 'reindex' | 'rechunk' | 'cleanup';
    document_version_id: string | null;
    space_id: string | null;
    embedding_index_id: string | null;
    attempts: number;
    fencing_token: string;
}

export interface WorkerDeps extends IngestDeps {
    now?: () => number;
}

type Handler = (job: JobRow, deps: WorkerDeps) => Promise<void>;

/** kind → 핸들러. 새 작업 종류는 여기 항목을 더한다. */
const HANDLERS: Readonly<Record<JobRow['kind'], Handler>> = {
    ingest: async (job, deps) => {
        if (!job.document_version_id) throw new Error('ingest 작업에 document_version_id 없음');
        const res = await ingestVersion(job.document_version_id, deps);
        if (res.status === 'failed' && res.failureCode && RETRYABLE_FAILURES.has(res.failureCode)) {
            throw new Error(`재시도 가능한 수집 실패: ${res.failureCode}`);
        }
    },
    reindex: async (job, deps) => {
        if (!job.embedding_index_id) throw new Error('reindex 작업에 embedding_index_id 없음');
        await runReindexJob(job.embedding_index_id, deps);
    },
    rechunk: async (job, deps) => {
        if (!job.space_id) throw new Error('rechunk 작업에 space_id 없음');
        await rechunkSpace(job.space_id, deps);
    },
    cleanup: async (job, deps) => {
        await runCleanup(job.space_id, { deleteStoredFile, ...deps });
    },
};

export class KnowledgeWorker {
    private readonly owner = `${hostname()}#${process.pid}#${randomUUID().slice(0, 8)}`;
    private running = false;

    constructor(private readonly deps: WorkerDeps = {}) {}

    private now(): number {
        return this.deps.now ? this.deps.now() : Date.now();
    }

    /** 한 tick — 처리한 작업 수를 돌려준다(테스트·로그용). 겹쳐 돌지 않게 재진입 방지 */
    async tick(): Promise<number> {
        if (this.running) return 0;
        this.running = true;
        try {
            const limits = await getDefaultLimits();
            const jobs = await this.claim(limits.ingestConcurrency, limits.jobLeaseMs);
            if (jobs.length === 0) return 0;
            await Promise.all(jobs.map((j) => this.runOne(j, limits.jobLeaseMs, limits.jobMaxAttempts)));
            return jobs.length;
        } finally {
            this.running = false;
        }
    }

    /** 만료 lease 포함해 due 작업을 원자적으로 집는다 */
    private async claim(limit: number, leaseMs: number): Promise<JobRow[]> {
        const r = await kdb().query<JobRow>(
            `UPDATE knowledge_ingestion_jobs j
                SET state = 'running', lease_owner = $1,
                    lease_expires_at = NOW() + ($2::bigint * INTERVAL '1 millisecond'),
                    fencing_token = j.fencing_token + 1, attempts = j.attempts + 1, updated_at = NOW()
              WHERE j.id IN (
                    SELECT id FROM knowledge_ingestion_jobs
                     WHERE state IN ('queued', 'running') AND run_after <= NOW()
                       AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
                     ORDER BY run_after
                     FOR UPDATE SKIP LOCKED
                     LIMIT $3)
            RETURNING j.id, j.kind, j.document_version_id, j.space_id, j.embedding_index_id, j.attempts, j.fencing_token`,
            [this.owner, leaseMs, Math.max(1, limit)],
        );
        return r.rows;
    }

    private async runOne(job: JobRow, leaseMs: number, maxAttempts: number): Promise<void> {
        const token = Number(job.fencing_token);
        const beat = setInterval(() => { void this.renew(job.id, token, leaseMs); }, Math.max(1_000, leaseMs * KNOWLEDGE_RUNTIME.JOB_HEARTBEAT_RATIO));
        beat.unref();
        try {
            await HANDLERS[job.kind](job, this.deps);
            await this.finish(job.id, token);
        } catch (err) {
            await this.failOrRetry(job, token, maxAttempts, err instanceof Error ? err.message : String(err));
        } finally {
            clearInterval(beat);
        }
    }

    private async renew(id: string, token: number, leaseMs: number): Promise<void> {
        await kdb().query(
            `UPDATE knowledge_ingestion_jobs SET lease_expires_at = NOW() + ($3::bigint * INTERVAL '1 millisecond'), updated_at = NOW()
              WHERE id = $1 AND fencing_token = $2 AND state = 'running'`,
            [id, token, leaseMs],
        ).catch(() => undefined);
    }

    private async finish(id: string, token: number): Promise<void> {
        await kdb().query(
            `UPDATE knowledge_ingestion_jobs SET state = 'done', lease_owner = NULL, lease_expires_at = NULL, last_error = NULL, updated_at = NOW()
              WHERE id = $1 AND fencing_token = $2`,
            [id, token],
        );
    }

    private async failOrRetry(job: JobRow, token: number, maxAttempts: number, error: string): Promise<void> {
        const attempts = Number(job.attempts) + 1; // claim 에서 이미 +1 된 값
        if (attempts >= maxAttempts) {
            await kdb().query(
                `UPDATE knowledge_ingestion_jobs SET state = 'failed', lease_owner = NULL, lease_expires_at = NULL, last_error = $3, updated_at = NOW()
                  WHERE id = $1 AND fencing_token = $2`,
                [job.id, token, error.slice(0, 2000)],
            );
            logger.warn(`작업 최종 실패: ${job.kind} ${job.id} (${attempts}회) — ${error}`);
            return;
        }
        const backoff = Math.min(KNOWLEDGE_RUNTIME.JOB_BACKOFF_MAX_MS, KNOWLEDGE_RUNTIME.JOB_BACKOFF_BASE_MS * 2 ** (attempts - 1));
        await kdb().query(
            `UPDATE knowledge_ingestion_jobs
                SET state = 'queued', lease_owner = NULL, lease_expires_at = NULL, last_error = $3,
                    run_after = NOW() + ($4::bigint * INTERVAL '1 millisecond'), updated_at = NOW()
              WHERE id = $1 AND fencing_token = $2`,
            [job.id, token, error.slice(0, 2000), backoff],
        );
        logger.info(`작업 재시도 예약: ${job.kind} ${job.id} (${attempts}회, ${backoff}ms 후) — ${error}`);
    }
}
