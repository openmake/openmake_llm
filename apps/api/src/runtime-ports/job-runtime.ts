/**
 * Job Runtime 포트 — 장시간 provider 작업의 소유·상태·중복 제출 방지 (Base·Add-on 통합 P07, 2026-09-23, 계획서 11).
 *
 * Base 가 갖는 것: 작업 소유권·영속화·상태 전이·재시도·재시작 복구·취소 상태·중복 제출 방지.
 * Add-on driver 가 갖는 것: provider 별 제출 형식·완료 조건·결과 위치(`JobDriver`).
 *
 * 제출 절차(`submit`): ① 제출 의도를 **먼저** 저장(state=submitting, idempotency key) → ② provider 로 전송 →
 *   ③ 외부 job id 수신 시 running. 전송 결과가 불명확하면(연결 끊김·타임아웃·취소) **submission_unknown** — 자동 재제출하지 않는다
 *   (provider 가 이미 과금했을 수 있다). provider 가 응답으로 거절했으면(HTTP 4xx·5xx 본문 수신) 실제 생성이 없으므로 failed.
 *   같은 key·같은 digest 는 existing(새 제출 없음), 같은 key·다른 digest 는 conflict.
 * 저장소를 못 쓰면(게스트·DB 장애) 종전처럼 제출은 하되 `persisted:false` 로 알린다 — 사용자 안내가 바뀐다.
 *
 * @module runtime-ports/job-runtime
 */
import * as crypto from 'node:crypto';
import { getPool } from '../data/models/unified-database';
import { JobRuntimeRepository, type JobRecord, type TransitionPatch } from '../data/repositories/job-runtime-repo';
import type { JobState } from '../capability-contract/job-state';
import type { ApprovedInvocationHandle } from '../capability-contract/admission';
import type { RestrictedModelInvoker } from './model-invoker';
import { HttpCallError } from '../services/orchestrator/http-call';
import { createLogger } from '../utils/logger';

const logger = createLogger('JobRuntime');

/** driver 의 상태 조회 결과 */
export type JobPollResult =
    | { status: 'running'; progress?: number }
    | { status: 'done'; units?: number; raw?: Record<string, unknown> }
    | { status: 'failed'; reason: string };

export interface JobDriverIo {
    externalJobId: string;
    model: RestrictedModelInvoker;
    signal?: AbortSignal;
}

/** Add-on 이 구현하는 provider 작업 driver — 소유·저장·재시도는 모른다 */
export interface JobDriver {
    poll(io: JobDriverIo): Promise<JobPollResult>;
    /** 완료된 결과 바이트를 받아 온다 — 실패는 throw(생성 실패와 구분되는 수집 실패) */
    collect(io: JobDriverIo, done: Extract<JobPollResult, { status: 'done' }>): Promise<{ bytes: Buffer; ext: string; mime: string }>;
    /** provider 작업 취소 — 없으면 취소 미지원(사용자 취소 요청은 running 으로 되돌린다) */
    cancel?(io: JobDriverIo): Promise<boolean>;
}

export type SubmitOutcome =
    | { kind: 'submitted'; job: JobRecord; externalJobId: string; persisted: true }
    | { kind: 'existing'; job: JobRecord }
    | { kind: 'conflict'; job: JobRecord }
    | { kind: 'unknown'; job: JobRecord; error: string }
    | { kind: 'rejected'; error: string }
    | { kind: 'unpersisted'; externalJobId: string; persisted: false };

export interface ScopedJobRuntime {
    /** 제출 — 의도 선저장 → send → 결과 분류. `send` 는 한 번만 부른다 */
    submit(input: { providerId: string; modelId: string; credentialRef: string; request: unknown }, send: () => Promise<{ externalJobId: string }>): Promise<SubmitOutcome>;
    /** 이 사용자 소유의 job(없거나 남의 것이면 null) */
    get(jobId: string): Promise<JobRecord | null>;
    /** 이 사용자 소유 job 의 조건부 전이 — 전이표 밖이면 null */
    advance(jobId: string, to: JobState, patch?: TransitionPatch): Promise<JobRecord | null>;
}

/** HttpCallError 중 provider 가 **응답을 준** 실패 — 생성이 일어나지 않았다고 판정할 수 있는 것만 */
export function isDefinitelyNotSubmitted(err: unknown): boolean {
    return err instanceof HttpCallError && err.kind === 'http' && typeof err.status === 'number' && err.status >= 400;
}

export function requestDigest(value: unknown): string {
    return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function repo(): JobRuntimeRepository {
    return new JobRuntimeRepository(getPool());
}

export function scopedJobRuntime(handle: ApprovedInvocationHandle, deps: { repo?: () => JobRuntimeRepository } = {}): ScopedJobRuntime {
    const r = deps.repo ?? repo;
    const userId = handle.userId;
    return {
        async submit(input, send) {
            const digest = requestDigest({ capability: handle.capability, provider: input.providerId, model: input.modelId, request: input.request });
            // 같은 턴의 같은 작업이 재시도돼도 새 제출이 생기지 않게 — key 는 승인 handle 단위
            const idempotencyKey = `${handle.sessionId ?? '-'}:${handle.issuedAt}:${handle.taskId}`;
            if (!userId) {
                const { externalJobId } = await send();
                return { kind: 'unpersisted', externalJobId, persisted: false };
            }
            let intent;
            try {
                intent = await r().createIntent({
                    userId, sessionId: handle.sessionId ?? null, capability: handle.capability, addonId: handle.owner.addonId,
                    addonVersion: handle.owner.addonVersion, contractVersion: 1, providerId: input.providerId, modelId: input.modelId,
                    idempotencyKey, requestDigest: digest, credentialRef: input.credentialRef,
                });
            } catch (err) {
                // 의도를 저장하지 못했다 — 종전 동작(제출 후 안내 변경)을 유지한다. 재제출 방지 보장은 없다고 알린다
                logger.error(`제출 의도 저장 실패(${handle.capability}) — 저장 없이 제출: ${err instanceof Error ? err.message : String(err)}`);
                const { externalJobId } = await send();
                return { kind: 'unpersisted', externalJobId, persisted: false };
            }
            if (intent.kind !== 'created') return intent;
            try {
                const { externalJobId } = await send();
                const job = await r().transition(intent.job.id, 'running', { externalJobId, stage: 'submitted', nextPollAt: null });
                return { kind: 'submitted', job: job ?? intent.job, externalJobId, persisted: true };
            } catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                if (isDefinitelyNotSubmitted(err)) {
                    await r().transition(intent.job.id, 'failed', { errorCode: 'provider_rejected', stage: 'submit' }).catch(() => undefined);
                    return { kind: 'rejected', error };
                }
                const job = await r().transition(intent.job.id, 'submission_unknown', { errorCode: 'submit_response_lost', stage: 'submit' }).catch(() => null);
                return { kind: 'unknown', job: job ?? intent.job, error };
            }
        },
        async get(jobId) {
            return userId ? r().getForOwner(userId, jobId) : null;
        },
        async advance(jobId, to, patch) {
            if (!userId) return null;
            const job = await r().getForOwner(userId, jobId);
            if (!job) return null;
            return r().transition(jobId, to, patch);
        },
    };
}
