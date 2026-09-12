/**
 * @module services/orchestrator/executors/video
 * @description video.generate — OpenAI `/v1/videos`(게이트웨이) 또는 jobs-v1 어댑터(hasa, provider 직결 예외).
 *  - 제출 → 상태 폴링(VIDEO_WAIT_MS 상한) → 산출물 다운로드(SSRF 고정·origin 일치 시에만 자격증명) → /generated 저장
 *  - 상한 안에 안 끝나면 **pending**(ok=false, 실패 아님) — job 을 orchestrator_jobs 에 보존해 후속 턴이 새 제출 없이
 *    같은 job 만 재조회한다(task.attachments 의 kind=job). 완료 전엔 의존 자식이 실행되지 않는다.
 */
import { CAPABILITY_LIMITS, VIDEO_DONE_STATUSES, VIDEO_GEN_DEFAULT_SECONDS, VIDEO_GEN_DEFAULT_SIZE, VIDEO_TERMINAL_STATUSES, videoAdapterFor, type VideoProviderAdapter } from '../../../config/capabilities';
import { getPool } from '../../../data/models/unified-database';
import { OrchestratorJobsRepository } from '../../../data/repositories/orchestrator-jobs-repo';
import { resolveCapabilityTarget, type CapabilityTarget } from '../capability-resolver';
import { callJson, downloadProviderUrl } from '../http-call';
import { saveVideo } from '../media-io';
import { refsRawText, type CapabilityExecutor, type ExecutorOutput, type OrchestratorAttachment, type TaskMedia } from '../types';
import { resolveGeneratedPath } from '../../../mcp/generated-media';
import { createLogger } from '../../../utils/logger';

const logger = createLogger('VideoExecutor');

interface JobView { id: string; status: string; progress?: number; artifactUrl?: string; raw: Record<string, unknown> }

function toJobView(json: Record<string, unknown>, adapter: VideoProviderAdapter): JobView {
    const artifactField = adapter.artifactField ?? 'artifact_url';
    return {
        id: String(json.id ?? json.job_id ?? ''),
        status: String(json.status ?? '').toLowerCase(),
        progress: typeof json.progress === 'number' ? json.progress : undefined,
        artifactUrl: typeof json[artifactField] === 'string' ? String(json[artifactField]) : undefined,
        raw: json,
    };
}
const lower = (xs?: readonly string[]) => (xs ?? []).map((s) => s.toLowerCase());
function isDone(v: JobView, a: VideoProviderAdapter): boolean { return new Set([...lower(a.doneStatuses), ...VIDEO_DONE_STATUSES]).has(v.status); }
function isTerminal(v: JobView, a: VideoProviderAdapter): boolean {
    return new Set([...lower(a.doneStatuses), ...lower(a.failStatuses), ...VIDEO_TERMINAL_STATUSES]).has(v.status);
}
function statusUrl(t: CapabilityTarget, a: VideoProviderAdapter, id: string): string {
    const path = a.kind === 'jobs-v1' && a.statusPath ? a.statusPath.replace('{id}', encodeURIComponent(id)) : `/v1/videos/${encodeURIComponent(id)}`;
    return `${t.baseUrl}${path}`;
}
function contentUrl(t: CapabilityTarget, a: VideoProviderAdapter, v: JobView): string | null {
    if (a.kind === 'jobs-v1') return v.artifactUrl ? new URL(v.artifactUrl, `${t.baseUrl}/`).toString() : null; // 루트 상대 → origin 기준
    return `${t.baseUrl}/v1/videos/${encodeURIComponent(v.id)}/content`;
}
function sameOrigin(a: string, b: string): boolean { try { return new URL(a).origin === new URL(b).origin; } catch { return false; } }

/** abort 시 즉시 reject, 정상 종료 시 리스너 정리 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) { reject(new Error('취소됨')); return; }
        const onAbort = () => { clearTimeout(t); reject(new Error('취소됨')); };
        const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

async function fetchJob(t: CapabilityTarget, a: VideoProviderAdapter, id: string, signal?: AbortSignal): Promise<JobView> {
    const json = await callJson<Record<string, unknown>>(t, { method: 'GET', url: statusUrl(t, a, id), timeoutMs: CAPABILITY_LIMITS.VIDEO_SUBMIT_TIMEOUT_MS, signal });
    return toJobView(json, a);
}

function jobsRepo(): OrchestratorJobsRepository | null {
    try { return new OrchestratorJobsRepository(getPool()); } catch { return null; }
}

/** 내려받기를 VIDEO_DOWNLOAD_ATTEMPTS 회까지 시도 — 턴 취소(signal)면 즉시 중단 */
async function downloadWithRetry(url: string, target: CapabilityTarget, signal: AbortSignal | undefined): Promise<Awaited<ReturnType<typeof downloadProviderUrl>>> {
    const attempts = Math.max(1, CAPABILITY_LIMITS.VIDEO_DOWNLOAD_ATTEMPTS);
    let lastErr: unknown;
    for (let i = 1; i <= attempts; i++) {
        try {
            return await downloadProviderUrl(url, {
                timeoutMs: CAPABILITY_LIMITS.VIDEO_DOWNLOAD_TIMEOUT_MS, signal, allowTypes: ['video/', 'application/octet-stream'],
                headers: sameOrigin(url, target.baseUrl) ? target.headers : undefined,
            });
        } catch (err) {
            lastErr = err;
            if (signal?.aborted || i === attempts) break;
            logger.warn(`[Video] 내려받기 ${i}/${attempts} 실패 — 재시도: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    throw lastErr;
}

/** 이 job 첨부에 이미 받아둔 산출물이 실재하면 그 경로 — 사용자 소유 job(listRecent 가 user_id 로 조회)만 첨부에 실리므로 소유 검증은 수집 단계에서 끝난다 */
export function savedVideoPath(att: OrchestratorAttachment | undefined): string | null {
    const p = att?.job?.resultPath;
    return p && resolveGeneratedPath(p) ? p : null;
}

export const videoGenerateExecutor: CapabilityExecutor = async (task, ctx) => {
    // 재조회 경로 — 첨부에 kind=job 이 있으면 새로 제출하지 않고 그 job 만 확인한다(같은 provider 인 경우)
    const jobAtt = task.attachments.map((id) => ctx.attachments.get(id)).find((a) => a?.kind === 'job' && a.job?.capability === 'video.generate');
    // 완료·저장본은 **자격증명 해석 전에** 반환 — 키 삭제·비활성·배정 변경이 이미 보유한 파일 열람을 막지 않는다(Codex 검토 4).
    // 미완료 job 의 재조회는 현재 자격증명을 요구한다(제출 당시 키를 스냅샷하지 않는다).
    const saved = savedVideoPath(jobAtt);
    if (jobAtt?.job && saved) {
        logger.info(`[Video] 기존 job 저장본 반환 ${jobAtt.job.jobId} ${saved}`);
        const media: TaskMedia = { kind: 'video', urlPath: saved, markdown: `[🎬 ${ctx.lang === 'ko' ? '영상 보기' : 'Watch'}](${saved})` };
        return { ok: true, status: 'completed', text: ctx.lang === 'ko' ? `영상(이미 완성): ${saved}` : `Video (already generated): ${saved}`, media: [media], model: `${jobAtt.job.providerId}:saved`, job: { providerId: jobAtt.job.providerId, jobId: jobAtt.job.jobId } } satisfies ExecutorOutput;
    }
    const target = ctx.targets?.get(task.id) ?? await resolveCapabilityTarget('video.generate', ctx.userId);
    const adapter = videoAdapterFor(target.providerId);
    const repo = ctx.userId ? jobsRepo() : null;

    let view: JobView;
    let jobId: string;
    let persisted = true;
    if (jobAtt?.job) {
        if (jobAtt.job.providerId !== target.providerId) {
            throw new Error(`이전 영상 작업(${jobAtt.job.providerId})과 현재 배정 provider(${target.providerId})가 달라 재조회할 수 없습니다`);
        }
        jobId = jobAtt.job.jobId;
        view = await fetchJob(target, adapter, jobId, ctx.signal);
        logger.info(`[Video] 기존 job 재조회 ${jobId} status=${view.status}`);
    } else {
        const refs = refsRawText(task, ctx, 600);
        const prompt = [task.text || task.instruction, refs ? `Context: ${refs}` : ''].filter(Boolean).join('\n').trim();
        if (!prompt) throw new Error('video.generate: instruction(프롬프트)이 비어 있습니다');
        const seconds = String(task.extra.seconds || target.params.seconds || VIDEO_GEN_DEFAULT_SECONDS);
        const size = String(task.extra.size || target.params.size || VIDEO_GEN_DEFAULT_SIZE);
        view = toJobView(await callJson<Record<string, unknown>>(target, {
            body: { model: target.model, prompt, seconds, size }, timeoutMs: CAPABILITY_LIMITS.VIDEO_SUBMIT_TIMEOUT_MS, signal: ctx.signal,
        }), adapter);
        if (!view.id) throw new Error('영상 생성 응답에 작업 id 가 없습니다');
        jobId = view.id;
        logger.info(`[Video] 제출 ${jobId} (${target.fullId})`);
        // 유료 job 의 재조회 연결은 telemetry 가 아니다 — 저장을 기다리고 실패하면 사용자 안내를 바꾼다(재제출은 하지 않는다: 중복 과금)
        if (repo && ctx.userId) {
            try { await repo.upsertPending(ctx.userId, 'video.generate', target.providerId, jobId, ctx.sessionId ?? null); }
            catch (err) { persisted = false; logger.error(`[Video] job 저장 실패 ${jobId}: ${err instanceof Error ? err.message : String(err)}`); }
        } else {
            persisted = false;
        }
    }

    const deadline = Date.now() + CAPABILITY_LIMITS.VIDEO_WAIT_MS;
    while (!isTerminal(view, adapter) && Date.now() < deadline) {
        await sleep(Math.min(CAPABILITY_LIMITS.VIDEO_POLL_INTERVAL_MS, Math.max(1000, deadline - Date.now())), ctx.signal);
        view = await fetchJob(target, adapter, jobId, ctx.signal);
    }

    const job = { providerId: target.providerId, jobId };
    if (isDone(view, adapter)) {
        const url = contentUrl(target, adapter, view);
        if (!url) throw new Error('완료됐지만 산출물 URL 이 없습니다');
        let downloaded: Awaited<ReturnType<typeof downloadProviderUrl>>;
        try {
            downloaded = await downloadWithRetry(url, target, ctx.signal);
        } catch (err) {
            // provider 는 완성했는데 내려받기만 실패(느린 파일 서버·타임아웃) — 실패로 닫지 않고 job 을 pending 으로 남겨
            // 다음 요청에서 같은 job 을 다시 내려받게 한다(2026-09-12 실측: hasa 3.7MB 173s > 종전 120s 상한).
            if (ctx.signal?.aborted) throw err; // 턴 자체 취소는 그대로 전파(다운로드 자체 타임아웃은 ctx.signal 이 살아 있다)
            const reason = err instanceof Error ? err.message : String(err);
            logger.warn(`[Video] 완성된 산출물 내려받기 실패 ${jobId}: ${reason}`);
            return {
                ok: false, status: 'pending', media: [], model: target.fullId, job,
                text: ctx.lang === 'ko'
                    ? `영상은 완성됐지만 파일 내려받기가 실패했습니다(${reason}). 작업 id ${jobId} 는 보존되어 있으니 잠시 후 다시 요청하면 같은 영상을 다시 내려받습니다(새로 만들지 않음).`
                    : `The video is finished but downloading it failed (${reason}). Job ${jobId} is saved; ask again shortly and the same video will be fetched (no new generation).`,
            } satisfies ExecutorOutput;
        }
        const { bytes, contentType } = downloaded;
        const ext = contentType.includes('webm') || url.toLowerCase().endsWith('.webm') ? 'webm' : 'mp4';
        const media = saveVideo(bytes, ext, ctx.lang === 'ko' ? '영상 보기' : 'Watch');
        if (repo && ctx.userId) await repo.markDone(ctx.userId, target.providerId, jobId, 'completed', media.urlPath).catch((err) => logger.warn(`[Video] 완료 저장 실패 ${jobId}(다음 요청은 재다운로드): ${err instanceof Error ? err.message : String(err)}`));
        return { ok: true, status: 'completed', text: ctx.lang === 'ko' ? `영상 생성 완료: ${media.urlPath}` : `Video generated: ${media.urlPath}`, media: [media], model: target.fullId, job, usage: { units: { kind: 'video_seconds', count: Number(view.raw.seconds ?? 0) || 0 } } } satisfies ExecutorOutput;
    }
    if (isTerminal(view, adapter)) {
        if (repo && ctx.userId) await repo.markDone(ctx.userId, target.providerId, jobId, 'failed', null).catch(() => undefined);
        throw new Error(`영상 생성 실패 (status=${view.status}) ${JSON.stringify(view.raw).slice(0, 160)}`);
    }
    const pct = view.progress !== undefined ? ` (${view.progress}%)` : '';
    const keep = persisted
        ? (ctx.lang === 'ko' ? `작업 id ${jobId} 는 보존되어 있어 다음 요청에서 같은 작업의 결과만 확인합니다(새로 제출하지 않음).` : `Job ${jobId} is saved; the next request will re-check the same job (no new submission).`)
        : (ctx.lang === 'ko' ? `⚠️ 작업 id ${jobId} 를 서버에 저장하지 못했습니다 — 이 id 를 사용자에게 그대로 알려 보관하게 하세요(새로 만들지 않음).` : `⚠️ Job ${jobId} could not be saved server-side — tell the user to keep this id (do not regenerate).`);
    return {
        ok: false, status: 'pending', media: [], model: target.fullId, job,
        text: ctx.lang === 'ko' ? `영상 생성이 아직 진행 중입니다${pct}. ${keep}` : `Video generation still in progress${pct}. ${keep}`,
    } satisfies ExecutorOutput;
};
