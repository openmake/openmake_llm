/**
 * 공통 Job 저장소 (마이그레이션 169, P07/P07b 2026-09-23) — `orchestrator_jobs` 의 확장 컬럼을 다룬다.
 * 모든 상태 쓰기는 **조건부 UPDATE**(예상 이전 상태 · 선택적으로 fencing token)다 — 동시 실행자가 서로의 결과를 덮지 못한다.
 * 종전 `OrchestratorJobsRepository`(upsertPending·markDone·listRecent)는 그대로 두고, 상태를 바꿀 때 legacy `status` 도 함께 쓴다.
 *
 * @module data/repositories/job-runtime-repo
 */
import { BaseRepository } from './base-repository';
import { legacyStatusFor, sourcesFor, type JobState } from '../../capability-contract/job-state';

export interface JobRecord {
    id: string;
    userId: string;
    orgId: string | null;
    sessionId: string | null;
    capability: string;
    addonId: string | null;
    addonVersion: string | null;
    contractVersion: number | null;
    providerId: string;
    modelId: string | null;
    externalJobId: string | null;
    idempotencyKey: string | null;
    requestDigest: string | null;
    state: JobState;
    stage: string | null;
    progress: number | null;
    retryCount: number;
    nextPollAt: Date | null;
    deadline: Date | null;
    leaseOwner: string | null;
    leaseExpiresAt: Date | null;
    fencingToken: number;
    artifactIds: string[];
    resultPath: string | null;
    errorCode: string | null;
    traceId: string | null;
    credentialRef: string | null;
    createdAt: Date;
    updatedAt: Date;
}

type Raw = Record<string, unknown>;
function map(r: Raw): JobRecord {
    return {
        id: String(r.id), userId: String(r.user_id), orgId: (r.org_id as string) ?? null, sessionId: (r.session_id as string) ?? null,
        capability: String(r.capability), addonId: (r.addon_id as string) ?? null, addonVersion: (r.addon_version as string) ?? null,
        contractVersion: r.contract_version === null || r.contract_version === undefined ? null : Number(r.contract_version),
        providerId: String(r.provider_id), modelId: (r.model_id as string) ?? null, externalJobId: (r.job_id as string) ?? null,
        idempotencyKey: (r.idempotency_key as string) ?? null, requestDigest: (r.request_digest as string) ?? null,
        state: ((r.state as JobState) ?? 'manual_review'), stage: (r.stage as string) ?? null,
        progress: r.progress === null || r.progress === undefined ? null : Number(r.progress),
        retryCount: Number(r.retry_count ?? 0), nextPollAt: (r.next_poll_at as Date) ?? null, deadline: (r.deadline as Date) ?? null,
        leaseOwner: (r.lease_owner as string) ?? null, leaseExpiresAt: (r.lease_expires_at as Date) ?? null,
        fencingToken: Number(r.fencing_token ?? 0), artifactIds: (r.artifact_ids as string[]) ?? [], resultPath: (r.result_path as string) ?? null,
        errorCode: (r.error_code as string) ?? null, traceId: (r.trace_id as string) ?? null, credentialRef: (r.credential_ref as string) ?? null,
        createdAt: r.created_at as Date, updatedAt: r.updated_at as Date,
    };
}

export interface CreateIntentInput {
    userId: string;
    orgId?: string | null;
    sessionId?: string | null;
    capability: string;
    addonId: string;
    addonVersion: string;
    contractVersion: number;
    providerId: string;
    modelId: string;
    idempotencyKey: string;
    requestDigest: string;
    credentialRef: string;
    traceId?: string | null;
    deadline?: Date | null;
}

export type IntentOutcome =
    | { kind: 'created'; job: JobRecord }
    | { kind: 'existing'; job: JobRecord }
    | { kind: 'conflict'; job: JobRecord };

/** 상태 전이 옵션 — 쓸 필드만. `fencingToken` 이 있으면 현재 lease 보유자만 쓴다(P07b) */
export interface TransitionPatch {
    stage?: string | null;
    progress?: number | null;
    externalJobId?: string;
    resultPath?: string | null;
    artifactIds?: string[];
    errorCode?: string | null;
    nextPollAt?: Date | null;
    incrementRetry?: boolean;
    /** 재시도 횟수를 0 으로 — 단계가 바뀔 때(running→collecting) 앞 단계의 폴링 실패가 수집 예산을 먹지 않게 */
    resetRetry?: boolean;
    releaseLease?: boolean;
}

export class JobRuntimeRepository extends BaseRepository {
    /**
     * 제출 의도를 **먼저** 영속화한다(state=submitting). 같은 (user, capability, idempotency key) 가 이미 있으면
     * digest 가 같을 때 existing, 다르면 conflict — 새 행을 만들지 않는다(중복 생성 방지).
     */
    async createIntent(input: CreateIntentInput): Promise<IntentOutcome> {
        const r = await this.query(
            `INSERT INTO orchestrator_jobs (user_id, org_id, session_id, capability, addon_id, addon_version, contract_version, provider_id, model_id,
                                            idempotency_key, request_digest, credential_ref, trace_id, deadline, state, stage, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'submitting','submit','pending')
             ON CONFLICT (user_id, capability, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
             RETURNING *`,
            [input.userId, input.orgId ?? null, input.sessionId ?? null, input.capability, input.addonId, input.addonVersion, input.contractVersion,
                input.providerId, input.modelId, input.idempotencyKey, input.requestDigest, input.credentialRef, input.traceId ?? null, input.deadline ? input.deadline.toISOString() : null],
        );
        if (r.rows[0]) return { kind: 'created', job: map(r.rows[0]) };
        const existing = await this.query('SELECT * FROM orchestrator_jobs WHERE user_id = $1 AND capability = $2 AND idempotency_key = $3', [input.userId, input.capability, input.idempotencyKey]);
        const job = map(existing.rows[0]);
        return job.requestDigest === input.requestDigest ? { kind: 'existing', job } : { kind: 'conflict', job };
    }

    /** 조건부 전이 — 출발 상태가 전이표에 맞고(그리고 fencing token 이 맞을 때만) 쓴다. 못 쓰면 null */
    async transition(id: string, to: JobState, patch: TransitionPatch = {}, fencingToken?: number): Promise<JobRecord | null> {
        const from = sourcesFor(to);
        const r = await this.query(
            `UPDATE orchestrator_jobs SET
                state = $2, status = $3,
                stage = CASE WHEN $4::boolean THEN $5 ELSE stage END,
                progress = CASE WHEN $6::boolean THEN $7::smallint ELSE progress END,
                job_id = COALESCE($8, job_id),
                result_path = CASE WHEN $9::boolean THEN $10 ELSE result_path END,
                artifact_ids = COALESCE($11, artifact_ids),
                error_code = CASE WHEN $12::boolean THEN $13 ELSE error_code END,
                next_poll_at = CASE WHEN $14::boolean THEN $15::timestamptz ELSE next_poll_at END,
                retry_count = CASE WHEN $20::boolean THEN 0 ELSE retry_count END + CASE WHEN $16::boolean THEN 1 ELSE 0 END,
                lease_owner = CASE WHEN $17::boolean THEN NULL ELSE lease_owner END,
                lease_expires_at = CASE WHEN $17::boolean THEN NULL ELSE lease_expires_at END,
                updated_at = NOW()
              WHERE id = $1 AND state = ANY($18::text[]) AND ($19::bigint IS NULL OR fencing_token = $19::bigint)
              RETURNING *`,
            [id, to, legacyStatusFor(to),
                'stage' in patch, patch.stage ?? null,
                'progress' in patch, patch.progress ?? null,
                patch.externalJobId ?? null,
                'resultPath' in patch, patch.resultPath ?? null,
                patch.artifactIds ?? null,
                'errorCode' in patch, patch.errorCode ?? null,
                'nextPollAt' in patch, patch.nextPollAt ? patch.nextPollAt.toISOString() : null,
                patch.incrementRetry === true, patch.releaseLease === true,
                from, fencingToken ?? null, patch.resetRetry === true],
        );
        return r.rows[0] ? map(r.rows[0]) : null;
    }

    /** 소유자 scope 조회 — 다른 사용자의 job 은 없는 것과 같다(T11) */
    async getForOwner(userId: string, id: string): Promise<JobRecord | null> {
        const r = await this.query('SELECT * FROM orchestrator_jobs WHERE id = $1 AND user_id = $2', [id, userId]);
        return r.rows[0] ? map(r.rows[0]) : null;
    }

    async getByExternal(userId: string, providerId: string, externalJobId: string): Promise<JobRecord | null> {
        const r = await this.query('SELECT * FROM orchestrator_jobs WHERE user_id = $1 AND provider_id = $2 AND job_id = $3', [userId, providerId, externalJobId]);
        return r.rows[0] ? map(r.rows[0]) : null;
    }

    async getById(id: string): Promise<JobRecord | null> {
        const r = await this.query('SELECT * FROM orchestrator_jobs WHERE id = $1', [id]);
        return r.rows[0] ? map(r.rows[0]) : null;
    }

    /** 사용자 취소 요청 — 소유자만. queued 는 즉시 cancelled, running 은 cancel_requested(공급자 취소 확인 전) */
    async requestCancel(userId: string, id: string): Promise<JobRecord | null> {
        const r = await this.query(
            `UPDATE orchestrator_jobs SET state = CASE state WHEN 'queued' THEN 'cancelled' ELSE 'cancel_requested' END,
                    status = CASE state WHEN 'queued' THEN 'failed' ELSE status END, updated_at = NOW()
              WHERE id = $1 AND user_id = $2 AND state IN ('queued', 'running')
              RETURNING *`,
            [id, userId],
        );
        return r.rows[0] ? map(r.rows[0]) : null;
    }

    /**
     * 부팅 복구 — provider 응답을 받기 전에 프로세스가 죽은 제출은 submission_unknown 으로 둔다(자동 재제출 없음).
     * `graceMs` 보다 오래된 submitting 만(다른 프로세스가 지금 보내는 중일 수 있다).
     */
    async recoverInterruptedSubmissions(graceMs: number): Promise<number> {
        const r = await this.query(
            `UPDATE orchestrator_jobs SET state = 'submission_unknown', stage = 'recovered_after_restart', updated_at = NOW()
              WHERE state = 'submitting' AND updated_at < NOW() - ($1 || ' milliseconds')::interval`,
            [String(graceMs)],
        );
        return r.rowCount ?? 0;
    }

    /**
     * lease 획득(P07b) — 원자적 조건부 갱신. 만료됐거나 비어 있을 때만 잡고 fencing token 을 1 올려 돌려준다.
     * 이후 확정 쓰기는 이 token 으로 조건을 건다 — lease 가 만료된 뒤 돌아온 이전 실행자의 쓰기는 거절된다(T26).
     */
    async acquireLease(id: string, owner: string, ttlMs: number): Promise<{ job: JobRecord; token: number } | null> {
        const r = await this.query(
            `UPDATE orchestrator_jobs SET lease_owner = $2, lease_expires_at = NOW() + ($3 || ' milliseconds')::interval,
                    fencing_token = fencing_token + 1, updated_at = NOW()
              WHERE id = $1 AND state IN ('running', 'collecting', 'cancel_requested')
                AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
              RETURNING *`,
            [id, owner, String(ttlMs)],
        );
        if (!r.rows[0]) return null;
        const job = map(r.rows[0]);
        return { job, token: job.fencingToken };
    }

    /**
     * lease 연장(heartbeat) — 같은 실행자·같은 token 일 때만 만료 시각을 민다. 영상 내려받기처럼 한 걸음이 TTL 보다 길 때
     * lease 가 만료돼 다른 실행자가 같은 job 을 잡는(중복 다운로드·완료 거절) 것을 막는다. 연장 실패(false)는 lease 를 잃었다는 뜻.
     */
    async renewLease(id: string, owner: string, token: number, ttlMs: number): Promise<boolean> {
        const r = await this.query(
            `UPDATE orchestrator_jobs SET lease_expires_at = NOW() + ($4 || ' milliseconds')::interval
              WHERE id = $1 AND lease_owner = $2 AND fencing_token = $3::bigint`,
            [id, owner, token, String(ttlMs)],
        );
        return (r.rowCount ?? 0) > 0;
    }

    /** 폴링 대상 선점(P07b) — 기한이 된 실행 중 job 을 lease 와 함께 가져온다(다중 실행자 SKIP LOCKED) */
    async claimDue(owner: string, ttlMs: number, limit: number): Promise<Array<{ job: JobRecord; token: number }>> {
        const r = await this.query(
            `UPDATE orchestrator_jobs SET lease_owner = $1, lease_expires_at = NOW() + ($2 || ' milliseconds')::interval,
                    fencing_token = fencing_token + 1, updated_at = NOW()
              WHERE id IN (
                    SELECT id FROM orchestrator_jobs
                     WHERE state IN ('running', 'collecting', 'cancel_requested') AND job_id IS NOT NULL
                       AND (next_poll_at IS NULL OR next_poll_at <= NOW())
                       AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
                       -- 수집 재시도를 다 쓴 job 은 보존만 한다(provider 결과는 남아 있을 수 있다) — null next_poll_at 을
                       -- "즉시 기한" 으로 읽어 매 tick 재다운로드하던 루프 방지(2026-09-24 운영 관측)
                       AND stage IS DISTINCT FROM 'collect_exhausted'
                     ORDER BY next_poll_at NULLS FIRST, id
                     LIMIT $3
                     FOR UPDATE SKIP LOCKED)
              RETURNING *`,
            [owner, String(ttlMs), limit],
        );
        return r.rows.map((row) => { const job = map(row); return { job, token: job.fencingToken }; });
    }
}
