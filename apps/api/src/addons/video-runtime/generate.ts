/**
 * video-runtime — video.generate handler (Base·Add-on 통합 P08, 2026-09-23).
 *
 * 종전 `services/orchestrator/executors/video.ts` 의 의미를 보존하되 작업 상태를 Base Job Runtime 에 맡긴다:
 *  - 저장본이 있는 job 첨부 → 자격증명 해석 없이 그 파일 반환(키 삭제·배정 변경이 보유 파일 열람을 막지 않는다 — T15)
 *  - 미완료 job 첨부 → **같은 job 만** 재조회(새 제출 없음). 제출 당시 provider 와 현재 배정이 다르면 명시 실패(원래 identity 유지)
 *  - 새 요청 → `ctx.jobs.submit`(의도 선저장·응답 유실 submission_unknown·같은 턴 재시도 중복 제출 방지)
 *  - 대기 상한 안에 끝나면 수집 → 저장 → completed. 다운로드 실패는 생성 실패가 아니다 — collecting 으로 남겨 다음 요청이
 *    **같은 externalJobId** 를 다시 수집한다(T12). 상한을 넘기면 pending(다음 요청·백그라운드 poller 가 이어 간다)
 * @module addons/video-runtime/generate
 */
import { CAPABILITY_LIMITS } from '../../config/capabilities';
import {
    VIDEO_GEN_DEFAULT_NEGATIVE_PROMPT, VIDEO_GEN_DEFAULT_SECONDS, VIDEO_GEN_DEFAULT_SIZE,
    VIDEO_JOB_FOLLOWUP_PATTERN, VIDEO_NEGATABLE_TERM_PATTERN, VIDEO_PROMPT_NEGATION_PATTERN,
} from './constants';
import type { CapabilityContext, CapabilityHandler } from '../../capability-contract/types';
import type { JobRecord } from '../../data/repositories/job-runtime-repo';
import { savedJobResultPath } from '../../services/orchestrator/media-io';
import type { PlanTask } from '../../services/orchestrator/plan-schema';
import { refsRawText, type ExecutorOutput, type TaskMedia } from '../../services/orchestrator/types';
import { createLogger } from '../../utils/logger';
import { toJobView, videoJobDriver } from './driver';
import { normalizeVideoPlanInput } from './plan-input';
import { VIDEO_OPERATIONS, videoAdapterFor } from './providers/adapters';

const logger = createLogger('VideoRuntime');

function negativePrompt(extra: unknown, excluded: string[]): string {
    const terms = [VIDEO_GEN_DEFAULT_NEGATIVE_PROMPT, typeof extra === 'string' ? extra : '', ...excluded]
        .flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
    return [...new Set(terms.map((s) => s.toLowerCase()))].join(', ');
}

/** 프롬프트의 "no text" 류 부정 표현을 걷어내고 그 대상을 돌려준다 — 부정어가 오히려 글자를 불러온다 */
export function splitVideoNegations(prompt: string): { prompt: string; excluded: string[] } {
    const excluded: string[] = [];
    const cleaned = prompt
        .replace(VIDEO_PROMPT_NEGATION_PATTERN, (_m, target: string) => { excluded.push(...(target.match(VIDEO_NEGATABLE_TERM_PATTERN) ?? [])); return ''; })
        .replace(/\s{2,}/g, ' ').replace(/\s+([,.;])/g, '$1').replace(/^[\s,;]+|[\s,;]+$/g, '');
    return { prompt: cleaned || prompt, excluded };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) { reject(new Error('취소됨')); return; }
        const onAbort = () => { clearTimeout(t); reject(new Error('취소됨')); };
        const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

const watchLabel = (ko: boolean) => (ko ? '영상 보기' : 'Watch');
const pending = (ko: boolean, jobId: string, persisted: boolean, pct = ''): string => {
    const keep = persisted
        ? (ko ? `작업 id ${jobId} 는 보존되어 있어 다음 요청에서 같은 작업의 결과만 확인합니다(새로 제출하지 않음).` : `Job ${jobId} is saved; the next request will re-check the same job (no new submission).`)
        : (ko ? `⚠️ 작업 id ${jobId} 를 서버에 저장하지 못했습니다 — 이 id 를 사용자에게 그대로 알려 보관하게 하세요(새로 만들지 않음).` : `⚠️ Job ${jobId} could not be saved server-side — tell the user to keep this id (do not regenerate).`);
    return ko ? `영상 생성이 아직 진행 중입니다${pct}. ${keep}` : `Video generation still in progress${pct}. ${keep}`;
};

export const videoGenerateHandler: CapabilityHandler = {
    operations: VIDEO_OPERATIONS,
    jobDriver: videoJobDriver,
    jobFollowupTopic: VIDEO_JOB_FOLLOWUP_PATTERN,
    normalizePlanInput: normalizeVideoPlanInput,
    describeProviderSupport(model) {
        const direct = model.isExternal ? videoAdapterFor(model.providerId).directEndpoint : undefined;
        return direct ? { supported: true, direct: { endpoint: direct } } : { supported: true };
    },
    async execute(task: PlanTask, ctx: CapabilityContext): Promise<ExecutorOutput> {
        const ko = ctx.lang === 'ko';
        const jobAtt = task.attachments.map((id) => ctx.attachments.get(id)).find((a) => a?.kind === 'job' && a.job?.capability === 'video.generate');
        // ① 완료·저장본 — 자격증명(ctx.model) 해석 전에 반환한다
        const saved = savedJobResultPath(jobAtt, 'video.generate');
        if (jobAtt?.job && saved) {
            logger.info(`[Video] 기존 job 저장본 반환 ${jobAtt.job.jobId} ${saved}`);
            const media: TaskMedia = { kind: 'video', urlPath: saved, markdown: `[🎬 ${watchLabel(ko)}](${saved})` };
            return { ok: true, status: 'completed', text: ko ? `영상(이미 완성): ${saved}` : `Video (already generated): ${saved}`, media: [media], model: `${jobAtt.job.providerId}:saved`, job: { providerId: jobAtt.job.providerId, jobId: jobAtt.job.jobId } };
        }
        const target = ctx.model.describe();
        const adapter = videoAdapterFor(target.providerId);
        let externalJobId: string;
        let record: JobRecord | null = null;
        let persisted = true;

        if (jobAtt?.job) {
            // ② 미완료 job 재조회 — 원래 provider identity 유지
            if (jobAtt.job.providerId !== target.providerId) {
                throw new Error(`이전 영상 작업(${jobAtt.job.providerId})과 현재 배정 provider(${target.providerId})가 달라 재조회할 수 없습니다`);
            }
            externalJobId = jobAtt.job.jobId;
            record = await ctx.jobs.findByExternal(target.providerId, externalJobId);
            logger.info(`[Video] 기존 job 재조회 ${externalJobId}${record ? ` (state=${record.state})` : ''}`);
        } else {
            // ③ 새 제출 — Base Job Runtime 이 의도를 먼저 저장한다
            const refs = refsRawText(task, ctx, 600);
            const scene = adapter.negativePrompt ? splitVideoNegations(task.text || task.instruction) : { prompt: task.text || task.instruction, excluded: [] };
            const prompt = [scene.prompt, refs ? `Context: ${refs}` : ''].filter(Boolean).join('\n').trim();
            if (!prompt) throw new Error('video.generate: instruction(프롬프트)이 비어 있습니다');
            const body: Record<string, unknown> = {
                model: target.model, prompt,
                seconds: String(task.extra.seconds || target.params.seconds || VIDEO_GEN_DEFAULT_SECONDS),
                size: String(task.extra.size || target.params.size || VIDEO_GEN_DEFAULT_SIZE),
            };
            if (adapter.negativePrompt) body.negative_prompt = negativePrompt(task.extra.negative_prompt, scene.excluded);
            const out = await ctx.jobs.submit(
                { providerId: target.providerId, modelId: target.model, credentialRef: `${target.source}:${target.providerId}`, request: body },
                async () => {
                    const v = toJobView(await ctx.model.invokeJson<Record<string, unknown>>({ operation: adapter.submitOp, payload: body, timeoutMs: CAPABILITY_LIMITS.VIDEO_SUBMIT_TIMEOUT_MS, signal: ctx.signal }), adapter);
                    if (!v.id) throw new Error('영상 생성 응답에 작업 id 가 없습니다');
                    return { externalJobId: v.id };
                },
            );
            switch (out.kind) {
                case 'submitted': externalJobId = out.externalJobId; record = out.job; break;
                case 'unpersisted': externalJobId = out.externalJobId; persisted = false; break;
                case 'rejected': throw new Error(`영상 생성 요청이 거절되었습니다: ${out.error}`);
                case 'conflict': throw new Error('같은 요청 키로 다른 내용의 영상 작업이 이미 있습니다 — 새로 제출하지 않았습니다');
                case 'unknown':
                    return { ok: false, status: 'pending', media: [], model: target.fullId, text: ko
                        ? `영상 생성 요청은 보냈지만 응답을 받지 못해 제출 여부를 확인할 수 없습니다(${out.error}). 중복 과금을 막기 위해 다시 제출하지 않았습니다 — 잠시 후 결과를 다시 물어봐 주세요.`
                        : `The video request was sent but no response arrived (${out.error}); to avoid double billing it was not resubmitted.` };
                case 'existing':
                    if (!out.job.externalJobId) {
                        return { ok: false, status: 'pending', media: [], model: target.fullId, text: ko ? '같은 영상 요청이 이미 제출 처리 중입니다 — 다시 제출하지 않았습니다.' : 'The same video request is already being submitted — not resubmitted.' };
                    }
                    externalJobId = out.job.externalJobId; record = out.job; break;
            }
            logger.info(`[Video] 제출 ${externalJobId} (${target.fullId})`);
        }

        const io = { externalJobId, model: ctx.model, signal: ctx.signal };
        const job = { providerId: target.providerId, jobId: externalJobId };
        const advance = async (to: Parameters<typeof ctx.jobs.advance>[1], patch?: Parameters<typeof ctx.jobs.advance>[2]) => {
            if (record) await ctx.jobs.advance(record.id, to, patch).catch((err: unknown) => logger.warn(`[Video] 상태 기록 실패 ${externalJobId}: ${err instanceof Error ? err.message : String(err)}`));
        };

        // ④ 턴 안 대기 — 수집만 남은 job(collecting)은 곧장 수집
        let result = record?.state === 'collecting' ? { status: 'done' as const } : await videoJobDriver.poll(io);
        const deadline = Date.now() + CAPABILITY_LIMITS.VIDEO_WAIT_MS;
        while (result.status === 'running' && Date.now() < deadline) {
            await sleep(Math.min(CAPABILITY_LIMITS.VIDEO_POLL_INTERVAL_MS, Math.max(1000, deadline - Date.now())), ctx.signal);
            result = await videoJobDriver.poll(io);
        }
        if (result.status === 'failed') {
            await advance('failed', { errorCode: 'provider_failed' });
            throw new Error(`영상 생성 실패 (${result.reason})`);
        }
        if (result.status === 'running') {
            await advance('running', { progress: result.progress ?? null, stage: 'running' });
            return { ok: false, status: 'pending', media: [], model: target.fullId, job, text: pending(ko, externalJobId, persisted, result.progress !== undefined ? ` (${result.progress}%)` : '') };
        }
        await advance('collecting', { stage: 'collect' });
        let file;
        try {
            file = await videoJobDriver.collect(io, result);
        } catch (err) {
            if (ctx.signal?.aborted) throw err;
            const reason = err instanceof Error ? err.message : String(err);
            logger.warn(`[Video] 완성된 산출물 내려받기 실패 ${externalJobId}: ${reason}`);
            await advance('collecting', { errorCode: 'collect_failed', stage: 'collect_failed', incrementRetry: true });
            return {
                ok: false, status: 'pending', media: [], model: target.fullId, job,
                text: ko
                    ? `영상은 완성됐지만 파일 내려받기가 실패했습니다(${reason}). 작업 id ${externalJobId} 는 보존되어 있으니 잠시 후 다시 요청하면 같은 영상을 다시 내려받습니다(새로 만들지 않음).`
                    : `The video is finished but downloading it failed (${reason}). Job ${externalJobId} is saved; ask again shortly and the same video will be fetched (no new generation).`,
            };
        }
        const ref = await ctx.artifacts.save({ kind: 'video', prefix: 'video', ext: file.ext, bytes: file.bytes, mime: file.mime });
        await advance('completed', { resultPath: ref.urlPath, artifactIds: [ref.id], stage: 'done', errorCode: null });
        const media: TaskMedia = { kind: 'video', urlPath: ref.urlPath, markdown: `[🎬 ${watchLabel(ko)}](${ref.urlPath})` };
        return {
            ok: true, status: 'completed', text: ko ? `영상 생성 완료: ${ref.urlPath}` : `Video generated: ${ref.urlPath}`,
            media: [media], model: target.fullId, job, usage: { units: { kind: 'video_seconds', count: result.units ?? 0 } },
        };
    },
};
