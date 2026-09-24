/**
 * video-runtime — provider job driver (P08). `submit` 는 handler 가 Base Job Runtime 으로 감싸 부르고, `poll`/`collect` 는
 * handler 의 턴 안 대기와 Base 백그라운드 poller(P07b) 가 **같은 함수**를 쓴다. 소유·저장·재시도·중복 제출 방지는 모른다.
 * @module addons/video-runtime/driver
 */
import { CAPABILITY_LIMITS } from '../../config/capabilities';
import type { JobDriver, JobDriverIo, JobPollResult } from '../../runtime-ports/job-runtime';
import type { RestrictedModelInvoker } from '../../runtime-ports/model-invoker';
import { createLogger } from '../../utils/logger';
import { videoAdapterFor, type VideoAdapter } from './providers/adapters';

const logger = createLogger('VideoDriver');

export interface JobView { id: string; status: string; progress?: number; artifactUrl?: string; raw: Record<string, unknown> }

export function toJobView(json: Record<string, unknown>, adapter: VideoAdapter): JobView {
    const field = adapter.artifactField ?? 'artifact_url';
    return {
        id: String(json.id ?? json.job_id ?? ''),
        status: String(json.status ?? '').toLowerCase(),
        progress: typeof json.progress === 'number' ? json.progress : undefined,
        artifactUrl: typeof json[field] === 'string' ? String(json[field]) : undefined,
        raw: json,
    };
}

function classify(v: JobView, a: VideoAdapter): JobPollResult {
    if (a.doneStatuses.includes(v.status)) return { status: 'done', units: Number(v.raw.seconds ?? 0) || 0, raw: v.raw };
    if (a.failStatuses.includes(v.status)) return { status: 'failed', reason: `status=${v.status} ${JSON.stringify(v.raw).slice(0, 160)}` };
    return { status: 'running', ...(v.progress !== undefined ? { progress: v.progress } : {}) };
}

async function fetchView(model: RestrictedModelInvoker, id: string, signal?: AbortSignal): Promise<JobView> {
    const adapter = videoAdapterFor(model.describe().providerId);
    const json = await model.invokeJson<Record<string, unknown>>({ operation: adapter.statusOp, pathParams: { id }, timeoutMs: CAPABILITY_LIMITS.VIDEO_SUBMIT_TIMEOUT_MS, signal });
    return toJobView(json, adapter);
}

/** 결과 위치 — jobs-v1 은 응답의 artifact URL(루트 상대면 provider origin 기준), openai 는 content 경로 */
function contentLocation(adapter: VideoAdapter, id: string, raw: Record<string, unknown> | undefined): string | null {
    if (adapter.kind === 'jobs-v1') {
        const url = raw?.[adapter.artifactField ?? 'artifact_url'];
        return typeof url === 'string' && url ? url : null;
    }
    return `/v1/videos/${encodeURIComponent(id)}/content`;
}

export const videoJobDriver: JobDriver = {
    async poll(io: JobDriverIo): Promise<JobPollResult> {
        const adapter = videoAdapterFor(io.model.describe().providerId);
        return classify(await fetchView(io.model, io.externalJobId, io.signal), adapter);
    },
    async collect(io, done) {
        const adapter = videoAdapterFor(io.model.describe().providerId);
        // 수집만 재시도하는 경로(poller 의 collecting)는 상태 응답이 없으니 한 번 더 묻는다 — 재제출이 아니라 조회다
        const raw = done.raw ?? (await fetchView(io.model, io.externalJobId, io.signal)).raw;
        const location = contentLocation(adapter, io.externalJobId, raw);
        if (!location) throw new Error('완료됐지만 산출물 URL 이 없습니다');
        const attempts = Math.max(1, CAPABILITY_LIMITS.VIDEO_DOWNLOAD_ATTEMPTS);
        let lastErr: unknown;
        for (let i = 1; i <= attempts; i++) {
            try {
                const { bytes, contentType } = await io.model.download(location, {
                    allowTypes: ['video/', 'application/octet-stream'], timeoutMs: CAPABILITY_LIMITS.VIDEO_DOWNLOAD_TIMEOUT_MS, signal: io.signal,
                });
                const ext = contentType.includes('webm') || location.toLowerCase().endsWith('.webm') ? 'webm' : 'mp4';
                return { bytes, ext, mime: `video/${ext}` };
            } catch (err) {
                lastErr = err;
                if (io.signal?.aborted || i === attempts) break;
                logger.warn(`[Video] 내려받기 ${i}/${attempts} 실패 — 재시도: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        throw lastErr;
    },
};
