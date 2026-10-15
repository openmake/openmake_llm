/**
 * 수집 작업 worker — `knowledge_ingestion_jobs` 를 lease + fencing token(SKIP LOCKED)으로 집어 처리한다.
 * kind 별 핸들러는 `Record` 맵으로 분기한다(switch 금지). 실패는 백오프 재시도, 상한 초과는 failed.
 * claim 이 받은 fencing token 은 `JobLease` 로 핸들러까지 간다(`deps.lease`) — job 행 갱신(finish·retry·heartbeat)과
 * 핸들러의 확정 쓰기(청크·임베딩·ready·index 전환) 모두 그 token 조건부라 lease 를 잃은 옛 실행자의 결과는 거절된다.
 * heartbeat 갱신이 0행이면 lease 상실로 표시하고, 상실로 끝난 작업의 행은 건드리지 않는다(새 실행자의 것).
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
import { createJobLease, LeaseLostError, type JobLease } from './lease';

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


/**
 * PURE: 실패한 작업의 다음 처리 — `attempts` 는 claim 이 이미 +1 해 돌려준 "이번이 몇 번째 시도" 값이다(다시 더하지 않는다).
 * 시도 수가 상한에 닿으면 최종 실패, 아니면 지수 백오프(상한 있음)로 재시도한다.
 */
export function retryPlan(attempts: number, maxAttempts: number): { attempts: number; final: boolean; backoffMs: number } {
    const final = attempts >= maxAttempts;
    const backoffMs = Math.min(KNOWLEDGE_RUNTIME.JOB_BACKOFF_MAX_MS, KNOWLEDGE_RUNTIME.JOB_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
    return { attempts, final, backoffMs };
}

export class KnowledgeWorker {
    private readonly owner = `${hostname()}#${process.pid}#${randomUUID().slice(0, 8)}`;
    private running = false;
    /** stop-admission — false 면 tick 이 새 작업을 집지 않는다(진행 중 작업은 계속). add-on 정지·재개가 바꾼다 */
    private admitting = true;
    /** 진행 중 tick — drain 이 기다린다 */
    private current: Promise<number> | null = null;
    /** 진행 중 작업의 lease — drain 시간 초과·즉시 정지 때 상실 처리하고 반납한다 */
    private readonly inflight = new Set<JobLease>();

    constructor(private readonly deps: WorkerDeps = {}) {}

    private now(): number {
        return this.deps.now ? this.deps.now() : Date.now();
    }

    /** 한 tick — 처리한 작업 수를 돌려준다(테스트·로그용). 겹쳐 돌지 않게 재진입 방지, 정지(stop-admission) 중이면 집지 않는다 */
    async tick(): Promise<number> {
        if (this.running || !this.admitting) return 0;
        this.running = true;
        const work = this.runTick();
        this.current = work;
        try {
            return await work;
        } finally {
            this.running = false;
            this.current = null;
        }
    }

    private async runTick(): Promise<number> {
        const limits = await getDefaultLimits();
        if (!this.admitting) return 0; // 한도를 읽는 사이 정지됐으면 집지 않는다
        const jobs = await this.claim(limits.ingestConcurrency, limits.jobLeaseMs);
        if (jobs.length === 0) return 0;
        if (!this.admitting) {
            // claim 이 도는 사이 정지됐다 — 정지 요청 뒤에는 새 작업을 실행하지 않는다. 집은 lease 를 바로 반납(상태 쓰기 없음)
            await this.releaseLeases(jobs.map((j) => ({ jobId: j.id, token: j.fencing_token, owner: this.owner })));
            logger.warn(`수집 worker 정지 — claim 진행 중 정지되어 집은 작업 ${jobs.length}건을 실행하지 않고 lease 반납`);
            return 0;
        }
        await Promise.all(jobs.map((j) => (Number(j.attempts) > limits.jobMaxAttempts
            ? this.failOverClaimed(j, limits.jobMaxAttempts)
            : this.runOne(j, limits.jobLeaseMs, limits.jobMaxAttempts))));
        return jobs.length;
    }

    /**
     * 정지 — 새 claim 을 멈춘다(stop-admission). drain 이면 진행 중 tick(집은 작업 전부)이 끝나기를 signal 이 끊길 때까지 기다린다.
     * 기다리지 않거나(drain=false) 시간이 넘으면 진행 중 작업의 lease 를 상실 처리해 핸들러를 단계 경계에서 멈추게 하고
     * (job 행·문서 상태 쓰기 없음) lease 를 반납한다. 폴링 타이머는 그대로 두고 tick 이 claim 을 건너뛴다.
     */
    async stop(opts: { drain: boolean; signal: AbortSignal }): Promise<void> {
        this.admitting = false;
        const current = this.current;
        if (current && opts.drain && !opts.signal.aborted) {
            const finished = await new Promise<boolean>((resolve) => {
                const onAbort = (): void => resolve(false);
                opts.signal.addEventListener('abort', onAbort, { once: true });
                void current.then(() => true, () => true).then((done) => {
                    opts.signal.removeEventListener('abort', onAbort);
                    resolve(done);
                });
            });
            if (finished) return;
        }
        await this.releaseInflight(opts.drain ? 'drain 시간 초과' : '즉시 정지');
    }

    /** 재개 — 다음 tick 부터 다시 집는다 */
    resume(): void {
        this.admitting = true;
    }

    /** 관리 화면·종료 로그용 상태 — 정지 뒤 진행 중 tick(claim 대기 포함)이나 작업이 남아 있으면 draining */
    health(): { status: 'running' | 'draining' | 'stopped'; inflight: number } {
        const inflight = this.inflight.size;
        if (this.admitting) return { status: 'running', inflight };
        return { status: inflight > 0 || this.current ? 'draining' : 'stopped', inflight };
    }

    /**
     * 진행 중 lease 를 끊고 반납한다 — `lease_expires_at` 을 지금으로 당겨 재개·재시작 뒤 바로 다시 집히게 한다.
     * 같은 token·owner 의 running 행만 바꾸므로 이미 다른 실행자가 집은 행은 건드리지 않는다. 옛 실행자의 늦은 확정 쓰기는
     * `assertLeaseHeld`(lease.throwIfLost) 가 막는다.
     */
    private async releaseInflight(reason: string): Promise<void> {
        const leases = [...this.inflight];
        if (leases.length === 0) return;
        for (const lease of leases) lease.markLost(`add-on 정지 — ${reason}`);
        await this.releaseLeases(leases);
        logger.warn(`수집 worker 정지 — 진행 중 작업 ${leases.length}건 중단(${reason}), lease 반납`);
    }

    /** lease 반납 SQL — `lease_expires_at` 을 지금으로 당긴다. job 행 상태·문서 상태는 쓰지 않는다 */
    private async releaseLeases(leases: ReadonlyArray<Pick<JobLease, 'jobId' | 'token' | 'owner'>>): Promise<void> {
        await Promise.all(leases.map(async (lease) => {
            try {
                await kdb().query(
                    `UPDATE knowledge_ingestion_jobs SET lease_expires_at = NOW(), updated_at = NOW()
                      WHERE id = $1 AND fencing_token = $2 AND lease_owner = $3 AND state = 'running'`,
                    [lease.jobId, lease.token, lease.owner],
                );
            } catch (err) {
                logger.warn(`lease 반납 실패(만료 뒤 다시 집힌다): ${lease.jobId} — ${err instanceof Error ? err.message : String(err)}`);
            }
        }));
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

    /**
     * lease 상실로 끝난 실행은 failOrRetry 를 거치지 않아 상한이 적용되지 않는다 — 재선점이 끝없이 이어지지 않게
     * 다시 집었을 때 이미 상한을 넘긴 작업은 핸들러 없이 최종 실패로 기록한다.
     * 비교가 `>` 인 이유: 정상 경로(retryPlan 의 `>=`)는 "이번 시도가 실패한 뒤" 판단하고, 이 경로는
     * "다시 집었는데 이번 시도 번호가 이미 상한을 넘김"을 본다 — 상한과 같은 번호의 시도는 아직 돌려 볼 몫이다.
     */
    private async failOverClaimed(job: JobRow, maxAttempts: number): Promise<void> {
        const token = job.fencing_token; // BIGINT 문자열 그대로
        const error = `재선점 상한 초과(attempts=${job.attempts} > max=${maxAttempts}) — lease 상실이 반복됨`;
        await kdb().query(
            `UPDATE knowledge_ingestion_jobs SET state = 'failed', lease_owner = NULL, lease_expires_at = NULL, last_error = $3, updated_at = NOW()
              WHERE id = $1 AND fencing_token = $2`,
            [job.id, token, error],
        );
        logger.warn(`작업 최종 실패(재선점 상한): ${job.kind} ${job.id} token=${token} — ${error}`);
    }

    private async runOne(job: JobRow, leaseMs: number, maxAttempts: number): Promise<void> {
        const token = job.fencing_token; // BIGINT 문자열 그대로 — Number 로 바꾸지 않는다
        const lease = createJobLease({ jobId: job.id, token, owner: this.owner, now: this.now() });
        this.inflight.add(lease);
        const beat = setInterval(() => { void this.renew(lease, leaseMs); }, Math.max(1_000, leaseMs * KNOWLEDGE_RUNTIME.JOB_HEARTBEAT_RATIO));
        beat.unref();
        // lease 를 잃으면(정지 반납·heartbeat 0행) 갱신을 멈춘다 — 반납한 lease 를 다시 늘리면 아무도 바로 집지 못한다
        const stopBeat = (): void => clearInterval(beat);
        lease.signal.addEventListener('abort', stopBeat, { once: true });
        try {
            await HANDLERS[job.kind](job, { ...this.deps, lease });
            // 핸들러가 끝난 뒤에도 그 사이 lease 를 잃었으면(정지 시간 초과·heartbeat 0행) done 을 쓰지 않는다 — 반납한 행은 다음 실행자의 것
            lease.throwIfLost();
            await this.finish(job.id, token);
        } catch (err) {
            if (err instanceof LeaseLostError || lease.signal.aborted) {
                // 행은 이미 다른 실행자의 것 — finish·retry 로 건드리면 그쪽 상태를 덮는다
                logger.warn(`작업 중단(lease 상실 — 결과 쓰기 거절): ${job.kind} ${job.id} token=${token} — ${err instanceof Error ? err.message : String(err)}`);
                return;
            }
            await this.failOrRetry(job, token, maxAttempts, err instanceof Error ? err.message : String(err));
        } finally {
            clearInterval(beat);
            lease.signal.removeEventListener('abort', stopBeat);
            this.inflight.delete(lease);
        }
    }

    /**
     * heartbeat — 내 token·owner 의 running 행만 늘린다. 0행이면 다른 실행자가 집은 것이라 lease 상실로 표시한다.
     * 조회 오류는 삼키지 않고 지속 시간을 잰다: 마지막 성공(renewedAt) 뒤 lease 기간(leaseMs)을 넘기면 DB 에서 lease 가
     * 이미 만료돼 누구든 집을 수 있는 상태라 상실로 표시한다(종전엔 오류를 조용히 무시해 옛 실행자가 계속 썼다).
     */
    private async renew(lease: JobLease, leaseMs: number): Promise<void> {
        if (lease.signal.aborted) return; // 잃은(반납한) lease 는 늘리지 않는다
        try {
            const r = await kdb().query(
                `UPDATE knowledge_ingestion_jobs SET lease_expires_at = NOW() + ($3::bigint * INTERVAL '1 millisecond'), updated_at = NOW()
                  WHERE id = $1 AND fencing_token = $2 AND lease_owner = $4 AND state = 'running'`,
                [lease.jobId, lease.token, leaseMs, lease.owner],
            );
            if ((r.rowCount ?? 0) === 0) { lease.markLost('heartbeat 갱신 0행 — 다른 실행자가 집었거나 작업이 끝났음'); return; }
            // 갱신이 나가 있는 사이 정지 반납이 먼저 커밋됐을 수 있다 — 방금 늘린 lease 를 다시 반납한다
            if (lease.signal.aborted) { await this.releaseLeases([lease]); return; }
            lease.touch(this.now());
        } catch (err) {
            const silentMs = this.now() - lease.renewedAt;
            if (silentMs > leaseMs) {
                lease.markLost(`heartbeat 갱신 오류가 lease 기간을 넘겨 이어짐(${silentMs}ms > ${leaseMs}ms) — ${err instanceof Error ? err.message : String(err)}`);
                return;
            }
            logger.debug(`heartbeat 갱신 실패(다음 주기 재시도, ${silentMs}ms 경과): ${lease.jobId} — ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    private async finish(id: string, token: string): Promise<void> {
        await kdb().query(
            `UPDATE knowledge_ingestion_jobs SET state = 'done', lease_owner = NULL, lease_expires_at = NULL, last_error = NULL, updated_at = NOW()
              WHERE id = $1 AND fencing_token = $2`,
            [id, token],
        );
    }

    private async failOrRetry(job: JobRow, token: string, maxAttempts: number, error: string): Promise<void> {
        const plan = retryPlan(Number(job.attempts), maxAttempts);
        const attempts = plan.attempts;
        if (plan.final) {
            await kdb().query(
                `UPDATE knowledge_ingestion_jobs SET state = 'failed', lease_owner = NULL, lease_expires_at = NULL, last_error = $3, updated_at = NOW()
                  WHERE id = $1 AND fencing_token = $2`,
                [job.id, token, error.slice(0, 2000)],
            );
            logger.warn(`작업 최종 실패: ${job.kind} ${job.id} (${attempts}회) — ${error}`);
            return;
        }
        const backoff = plan.backoffMs;
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
