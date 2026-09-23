/**
 * 공통 Job 백그라운드 poller (Base·Add-on 통합 P07b, 2026-09-23) — `CAPABILITY_JOB_POLLER_ENABLED=true` 일 때만.
 *
 * 한 tick: `claimDue`(lease + fencing token, SKIP LOCKED) → job 별로
 *   ① 실행 승인 재발급(job scope): 소유 add-on 이 꺼졌거나 상태를 알 수 없으면 네트워크 호출 없이 다음 주기로 미룬다
 *   ② driver 조회: capability 소유 handler 의 `jobDriver`. 없거나 소유 add-on 이 제출 당시와 다르면 blocked_runtime(보존, 재제출 없음)
 *   ③ 자격증명: 현재 배정을 해석하되 provider 가 제출 당시와 다르면 reauth_required 로 미룬다(원래 provider identity 유지)
 *   ④ poll → running(진행률)·collecting→completed(결과 저장)·failed·취소 처리
 * 모든 확정 쓰기는 이 tick 이 받은 fencing token 조건부다 — lease 가 만료된 뒤 돌아온 이전 실행자의 완료는 거절된다(T26).
 * 종료 상태는 단조다(전이표). 취소 요청과 provider 완료가 경합하면 완료를 남긴다(성공을 취소로 덮지 않는다).
 *
 * @module services/job-poller
 */
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import { JOB_RUNTIME } from '../config/runtime-limits';
import { getPool } from '../data/models/unified-database';
import { JobRuntimeRepository, type JobRecord } from '../data/repositories/job-runtime-repo';
import { getCapabilityRegistry } from '../runtime-ports/capability-runtime';
import { admitCapability, type ApprovedInvocationHandle } from '../capability-contract/admission';
import { createRestrictedInvoker, type RestrictedModelInvoker } from '../runtime-ports/model-invoker';
import { saveGeneratedArtifact } from '../runtime-ports/artifact-store';
import type { JobDriver } from '../runtime-ports/job-runtime';
import { createLogger } from '../utils/logger';

const logger = createLogger('JobPoller');

export interface PollerDeps {
    repo: Pick<JobRuntimeRepository, 'claimDue' | 'transition' | 'renewLease'>;
    owner: string;
    /** job scope 의 실행 대상 해석 — 현재 배정·키로 포트를 만든다. 해석 불가·provider 불일치는 사유 문자열 */
    invokerFor(job: JobRecord, handle: ApprovedInvocationHandle): Promise<RestrictedModelInvoker | string>;
    driverFor(job: JobRecord): { driver: JobDriver; addonId: string; addonVersion: string } | null;
    admit(capability: string): Promise<{ ok: boolean; reason?: string }>;
    saveResult(job: JobRecord, file: { bytes: Buffer; ext: string; mime: string }): Promise<{ id: string; urlPath: string }>;
    now(): number;
}

const later = (deps: PollerDeps) => new Date(deps.now() + JOB_RUNTIME.POLL_INTERVAL_MS);

/** 한 job 을 한 걸음 진행한다 — 결과 상태 이름을 돌려준다(테스트·로그용) */
export async function advanceJob(job: JobRecord, token: number, deps: PollerDeps): Promise<string> {
    const t = (to: Parameters<PollerDeps['repo']['transition']>[1], patch: Parameters<PollerDeps['repo']['transition']>[2] = {}) =>
        deps.repo.transition(job.id, to, { releaseLease: true, ...patch }, token);

    if (job.deadline && job.deadline.getTime() < deps.now()) {
        await t('failed', { errorCode: 'deadline_exceeded', stage: job.stage });
        return 'deadline_exceeded';
    }
    const admission = await deps.admit(job.capability);
    if (!admission.ok) {
        // 중지·상태 불명 — 새 네트워크 호출을 하지 않고 상태를 보존한다(다음 주기에 다시 판정)
        await t(job.state, { stage: 'admission_blocked', nextPollAt: later(deps) });
        return 'admission_blocked';
    }
    const found = deps.driverFor(job);
    if (!found || (job.addonId && job.addonId !== 'legacy' && job.addonId !== found.addonId)) {
        await t('blocked_runtime', { errorCode: 'driver_missing', stage: found ? `owner_changed:${found.addonId}` : 'no_driver' });
        return 'blocked_runtime';
    }
    const handle: ApprovedInvocationHandle = {
        taskId: `job:${job.id}`, capability: job.capability, userId: job.userId, sessionId: job.sessionId ?? undefined,
        owner: { addonId: found.addonId, addonVersion: found.addonVersion, source: 'builtin' }, registryRevision: 0, stateRevision: 0,
        issuedAt: deps.now(), deadline: deps.now() + JOB_RUNTIME.LEASE_TTL_MS,
    };
    const invoker = await deps.invokerFor(job, handle);
    if (typeof invoker === 'string') {
        await t(job.state, { stage: 'reauth_required', errorCode: 'credential_unavailable', nextPollAt: later(deps) });
        return 'reauth_required';
    }
    const io = { externalJobId: job.externalJobId ?? '', model: invoker };

    if (job.state === 'cancel_requested') {
        const cancelled = found.driver.cancel ? await found.driver.cancel(io).catch(() => false) : false;
        if (cancelled) { await t('cancelled', { stage: 'provider_cancelled' }); return 'cancelled'; }
        // 취소 미지원·거절 — 실행으로 되돌리되 사유를 남긴다(아래에서 이어서 poll)
        await deps.repo.transition(job.id, 'running', { stage: 'cancel_unsupported' }, token);
    }

    let result;
    if (job.state === 'collecting') result = { status: 'done' as const };
    else {
        try { result = await found.driver.poll(io); } catch (err) {
            await t(job.state === 'cancel_requested' ? 'running' : job.state, { stage: 'poll_failed', errorCode: 'poll_error', incrementRetry: true, nextPollAt: later(deps) });
            logger.warn(`job ${job.id} 상태 조회 실패: ${err instanceof Error ? err.message : String(err)}`);
            return 'poll_failed';
        }
    }
    if (result.status === 'running') {
        await t('running', { progress: result.progress ?? null, stage: 'running', nextPollAt: later(deps) });
        return 'running';
    }
    if (result.status === 'failed') {
        await t('failed', { errorCode: 'provider_failed', stage: result.reason.slice(0, 40) });
        return 'failed';
    }
    // done → collecting(같은 token) → 결과 저장 → completed. 수집 실패는 생성 실패가 아니다
    // 수집 재시도 예산은 수집 단계 것만 센다 — 진입 시 폴링 단계의 실패 횟수를 비운다(일시 장애 동안 쌓인 폴링 실패가 수집을 곧바로 소진시켰다)
    const collectRetries = job.state === 'collecting' ? job.retryCount : 0;
    if (job.state !== 'collecting') await deps.repo.transition(job.id, 'collecting', { stage: 'collect', resetRetry: true }, token);
    try {
        const file = await found.driver.collect(io, result);
        const saved = await deps.saveResult(job, file);
        const done = await t('completed', { stage: 'done', resultPath: saved.urlPath, artifactIds: [saved.id], errorCode: null });
        if (!done) { logger.warn(`job ${job.id} 완료 쓰기 거절(fencing) — 다른 실행자가 이미 처리`); return 'fenced'; }
        return 'completed';
    } catch (err) {
        const exhausted = collectRetries + 1 >= JOB_RUNTIME.COLLECT_MAX_RETRIES;
        await t('collecting', { stage: exhausted ? 'collect_exhausted' : 'collect_failed', errorCode: 'collect_failed', incrementRetry: true, nextPollAt: exhausted ? null : later(deps) });
        logger.warn(`job ${job.id} 결과 수집 실패(${collectRetries + 1}회): ${err instanceof Error ? err.message : String(err)}`);
        return 'collect_failed';
    }
}

export async function runPollerTick(deps: PollerDeps): Promise<string[]> {
    const claimed = await deps.repo.claimDue(deps.owner, JOB_RUNTIME.LEASE_TTL_MS, JOB_RUNTIME.BATCH);
    // job 끼리는 독립이라 병렬로 진행한다 — 한 job 의 긴 결과 내려받기(최대 수 분)가 다른 job 의 폴링을 막지 않게.
    // 진행 중엔 TTL 의 1/3 마다 lease 를 연장한다(연장이 없으면 긴 수집 도중 lease 가 만료된다, 2026-09-24 운영 관측).
    return Promise.all(claimed.map(async ({ job, token }) => {
        const heartbeat = setInterval(() => {
            void deps.repo.renewLease(job.id, deps.owner, token, JOB_RUNTIME.LEASE_TTL_MS)
                .then((ok) => { if (!ok) logger.warn(`job ${job.id} lease 연장 실패 — 다른 실행자가 선점했을 수 있음`); })
                .catch((err: unknown) => logger.warn(`job ${job.id} lease 연장 오류: ${err instanceof Error ? err.message : String(err)}`));
        }, Math.max(1_000, Math.floor(JOB_RUNTIME.LEASE_TTL_MS / 3)));
        heartbeat.unref();
        try { return await advanceJob(job, token, deps); } catch (err) {
            logger.error(`job ${job.id} 진행 실패: ${err instanceof Error ? err.message : String(err)}`);
            return 'error';
        } finally {
            clearInterval(heartbeat);
        }
    }));
}

function defaultDeps(): PollerDeps {
    const repo = new JobRuntimeRepository(getPool());
    return {
        repo,
        owner: `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`,
        async invokerFor(job, handle) {
            const { resolveCapabilityTarget } = await import('./orchestrator/capability-resolver');
            try {
                const target = await resolveCapabilityTarget(job.capability as never, job.userId);
                if (target.providerId !== job.providerId) return `배정 provider 변경(${job.providerId} → ${target.providerId})`;
                return createRestrictedInvoker(handle, target, getCapabilityRegistry().get(job.capability)?.handler.operations);
            } catch (err) {
                return err instanceof Error ? err.message : String(err);
            }
        },
        driverFor(job) {
            const reg = getCapabilityRegistry().get(job.capability);
            return reg?.handler.jobDriver ? { driver: reg.handler.jobDriver, addonId: reg.owner.addonId, addonVersion: reg.owner.addonVersion } : null;
        },
        async admit(capability) { const v = await admitCapability(capability); return v.ok ? { ok: true } : { ok: false, reason: v.reason }; },
        async saveResult(job, file) {
            const ref = await saveGeneratedArtifact({ userId: job.userId, sessionId: job.sessionId ?? undefined, capability: job.capability }, { kind: 'video', prefix: 'video', ext: file.ext, bytes: file.bytes, mime: file.mime });
            return { id: ref.id, urlPath: ref.urlPath };
        },
        now: () => Date.now(),
    };
}

/** 부팅: 중단된 제출 복구(항상) + poller(플래그 ON 일 때만) */
export async function startJobRuntime(): Promise<void> {
    try {
        const n = await new JobRuntimeRepository(getPool()).recoverInterruptedSubmissions(JOB_RUNTIME.SUBMIT_RECOVERY_GRACE_MS);
        if (n > 0) logger.warn(`중단된 제출 ${n}건을 submission_unknown 으로 표시 — 자동 재제출하지 않습니다`);
    } catch (err) {
        logger.warn(`제출 복구 실패(계속): ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!JOB_RUNTIME.POLLER_ENABLED) return;
    const deps = defaultDeps();
    let running = false;
    setInterval(() => {
        if (running) return;
        running = true;
        void runPollerTick(deps).catch((err: unknown) => logger.warn(`poller tick 실패: ${err instanceof Error ? err.message : String(err)}`)).finally(() => { running = false; });
    }, JOB_RUNTIME.POLL_INTERVAL_MS).unref();
    logger.info(`Job poller 시작 (owner ${deps.owner}, ${JOB_RUNTIME.POLL_INTERVAL_MS}ms)`);
}
